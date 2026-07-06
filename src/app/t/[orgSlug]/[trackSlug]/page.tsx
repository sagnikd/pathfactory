import { notFound, permanentRedirect } from 'next/navigation'
import { db } from '@/db'
import { organizations, tracks, trackAssets, assets, sessions, visitors, leads, trackSlugRedirects } from '@/db/schema'
import { eq, and, asc, desc } from 'drizzle-orm'
import { cookies, headers } from 'next/headers'
import TrackViewer from './TrackViewer'
import { CookieBanner } from '@/components/CookieBanner'
import { lookupIp } from '@/lib/ipLookup'
import { computeLeadScores } from '@/lib/leadScore'
import { processAbmLeadMatch } from '@/lib/abm'
import type { Metadata } from 'next'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// A campaign link carries `email`/`fname` for a recipient whose identity is
// already known — auto-capture them as a lead the same way the gate form
// would, without making them fill it in. No-ops (doesn't re-insert) if this
// visitor+email combo already has a lead, so repeat clicks/reloads of the
// same link don't spam duplicate lead rows.
async function identifyVisitorFromUrl(
  visitor: { id: string; capturedEmail: string | null },
  email: string,
  fname: string | null,
  trackId: string
) {
  const existing = await db.select({ id: leads.id }).from(leads)
    .where(and(eq(leads.visitorId, visitor.id), eq(leads.email, email))).limit(1)
  if (existing.length) return

  const scoreMap = await computeLeadScores([visitor.id])
  const [lead] = await db.insert(leads).values({
    visitorId: visitor.id,
    trackId,
    email,
    formResponsesJson: fname ? { firstName: fname, source: 'email_campaign' } : { source: 'email_campaign' },
    score: scoreMap[visitor.id]?.total ?? 0,
  }).returning({ id: leads.id })

  if (!visitor.capturedEmail) {
    await db.update(visitors).set({ capturedEmail: email }).where(eq(visitors.id, visitor.id))
  }

  await processAbmLeadMatch({
    trackId,
    visitorId: visitor.id,
    leadId: lead.id,
    email,
    formFields: { firstName: fname },
  })
}

type TrackTheme = {
  seoTitle?: string | null
  faviconUrl?: string | null
  ogImageUrl?: string | null
}

// Visitor-facing name — falls back to the internal-only `title` until an
// admin sets one.
function resolveExternalTitle(track: { title: string; externalTitle: string | null }): string {
  return track.externalTitle?.trim() || track.title
}

// A track's slug changes when its external title changes (see updateTrack in
// dashboard/tracks/actions.ts) — look up the CURRENT slug for a since-renamed
// track so an old shared link still resolves instead of 404ing.
async function findCurrentSlugForOldSlug(orgId: string, oldSlug: string): Promise<string | null> {
  const [redirect] = await db.select({ trackId: trackSlugRedirects.trackId })
    .from(trackSlugRedirects)
    .where(and(eq(trackSlugRedirects.organizationId, orgId), eq(trackSlugRedirects.oldSlug, oldSlug)))
    .limit(1)
  if (!redirect) return null

  const [track] = await db.select({ slug: tracks.slug }).from(tracks).where(eq(tracks.id, redirect.trackId))
  return track?.slug ?? null
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string, trackSlug: string }>
  searchParams: Promise<{ asset?: string }>
}): Promise<Metadata> {
  const { orgSlug, trackSlug } = await params
  const sp = await searchParams

  const [org] = await db.select().from(organizations).where(eq(organizations.slug, orgSlug))
  if (!org) return { title: 'Content Track' }

  let [track] = await db.select().from(tracks)
    .where(and(eq(tracks.organizationId, org.id), eq(tracks.slug, trackSlug)))
  if (!track) {
    // Shared link uses an old (pre-rename) slug — best-effort so the social
    // preview still shows the right title/image before the redirect below fires.
    const currentSlug = await findCurrentSlugForOldSlug(org.id, trackSlug)
    if (currentSlug) {
      ;[track] = await db.select().from(tracks)
        .where(and(eq(tracks.organizationId, org.id), eq(tracks.slug, currentSlug)))
    }
  }
  if (!track) return { title: 'Content Track' }

  const theme = (track.themeJson as TrackTheme | null) ?? null
  const trackTitle = theme?.seoTitle?.trim() || `${resolveExternalTitle(track)} | ${org.name}`
  const favicon = theme?.faviconUrl?.trim() || undefined

  // Resolve specific asset for OG metadata when ?asset=N is present
  let ogTitle = trackTitle
  let ogImage: string | undefined
  let ogDescription: string | undefined

  const assetPosition = sp.asset ? Math.max(1, parseInt(sp.asset, 10)) - 1 : 0
  const trackAssetsData = await db.select({ asset: assets, position: trackAssets.position })
    .from(trackAssets)
    .innerJoin(assets, eq(trackAssets.assetId, assets.id))
    .where(eq(trackAssets.trackId, track.id))
    .orderBy(asc(trackAssets.position))

  const sortedAssets = trackAssetsData.map(ta => ta.asset)
  const currentAsset = sortedAssets[Math.min(assetPosition, sortedAssets.length - 1)]

  if (currentAsset) {
    ogTitle = `${currentAsset.title} | ${resolveExternalTitle(track)}`
    ogImage = currentAsset.thumbnailUrl ?? undefined
    ogDescription = currentAsset.description ?? undefined
  }

  // Fall back to the track-level social image set in the builder
  if (!ogImage && theme?.ogImageUrl) {
    ogImage = theme.ogImageUrl
  }

  // LinkedIn and other crawlers require fully-qualified URLs
  if (ogImage && ogImage.startsWith('/')) {
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
    ogImage = `${base}${ogImage}`
  }

  return {
    title: ogTitle,
    icons: favicon ? { icon: favicon, shortcut: favicon, apple: favicon } : undefined,
    openGraph: {
      title: ogTitle,
      description: ogDescription,
      images: ogImage ? [{ url: ogImage, width: 1200, height: 630 }] : undefined,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description: ogDescription,
      images: ogImage ? [ogImage] : undefined,
    },
  }
}

export default async function PublicTrackPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string, trackSlug: string }>
  searchParams: Promise<{ asset?: string; assetId?: string; utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_term?: string; utm_content?: string; email?: string; fname?: string }>
}) {
  const { orgSlug, trackSlug } = await params
  const sp = await searchParams
  // ?asset=2  → 1-based position (human-friendly)
  // ?assetId=uuid → direct asset ID lookup (used by ExperienceViewer)
  // Both are resolved to a 0-based index, clamped after assets are loaded.
  const requestedAssetPosition = sp.asset ? Math.max(1, parseInt(sp.asset, 10)) - 1 : null
  const requestedAssetId = sp.assetId ?? null

  // Personalized email-campaign link — e.g. &email=s.d@x.com&fname=Sagnik.
  // Some ESPs encode the recipient email in utm_term and first name in utm_content
  // instead of dedicated params (Pardot/Eloqua convention). Accept both forms:
  // explicit email/fname take priority; utm_term/utm_content are fallbacks.
  const rawUrlEmail = sp.email?.trim() || sp.utm_term?.trim() || null
  const urlEmail = rawUrlEmail && EMAIL_RE.test(rawUrlEmail) ? rawUrlEmail : null
  const urlFname = sp.fname?.trim() || sp.utm_content?.trim() || null

  // Fetch org
  const orgs = await db.select().from(organizations).where(eq(organizations.slug, orgSlug))
  if (!orgs.length) notFound()
  const org = orgs[0]

  // Fetch track
  const trackResults = await db.select().from(tracks)
    .where(and(eq(tracks.organizationId, org.id), eq(tracks.slug, trackSlug)))
  if (!trackResults.length) {
    // Slug may have changed (external title renamed) — send old links to the
    // current URL instead of 404ing, query string (utm/email/asset) intact.
    const currentSlug = await findCurrentSlugForOldSlug(org.id, trackSlug)
    if (currentSlug) {
      const qs = new URLSearchParams(
        Object.entries(sp).filter(([, v]) => typeof v === 'string') as [string, string][]
      ).toString()
      permanentRedirect(`/t/${orgSlug}/${currentSlug}${qs ? `?${qs}` : ''}`)
    }
    notFound()
  }
  const track = trackResults[0]

  // Fetch assets via join
  const trackAssetsData = await db.select({
    asset: assets,
    position: trackAssets.position,
    displayTitle: trackAssets.displayTitle,
    subCopy: trackAssets.subCopy,
  })
  .from(trackAssets)
  .innerJoin(assets, eq(trackAssets.assetId, assets.id))
  .where(eq(trackAssets.trackId, track.id))
  .orderBy(asc(trackAssets.position))

  // Strip server-only cached extraction text from metadataJson before it
  // reaches the client — it can contain full PDF / transcript content and
  // must never be exposed on a public (esp. gated) page.
  const sortedAssets = trackAssetsData.map((ta) => {
    const asset = ta.asset
    const meta = asset.metadataJson
    const stripped = (meta && typeof meta === 'object' && !Array.isArray(meta) && 'extractedText' in meta)
      ? (() => { const { extractedText: _d, extractedAt: _d2, ...rest } = meta as Record<string, unknown>; return rest })()
      : meta
    return { ...asset, metadataJson: stripped, displayTitle: ta.displayTitle ?? null, subCopy: ta.subCopy ?? null }
  })

  // Visitor & Session Setup
  const cookieStore = await cookies()
  const visitorIdCookie = cookieStore.get('visitorId')?.value
  
  let sessionId = null;
  let visitorId = null;
  let returningVisitorName: string | null = null;
  let returningVisitorCompany: string | null = null;
  let isKnownVisitor = false;

  if (visitorIdCookie) {
    try {
      // Check if visitor exists
      const visitorResults = await db.select().from(visitors).where(eq(visitors.fingerprintId, visitorIdCookie))
      let visitor = visitorResults[0]
      const isReturningVisitor = !!visitor

      if (!visitor) {
        // Create visitor — may throw on unique constraint race; catch below
        const [newVisitor] = await db.insert(visitors).values({
          fingerprintId: visitorIdCookie,
        }).returning()
        if (!newVisitor) {
          // Lost the race — re-fetch
          const [existing] = await db.select().from(visitors).where(eq(visitors.fingerprintId, visitorIdCookie))
          visitor = existing
        } else {
          visitor = newVisitor
        }
      }

      if (!visitor) throw new Error('visitor unavailable')

      visitorId = visitor.id

      if (isReturningVisitor) {
        const latestLead = await db.select({
          email: leads.email,
          formResponsesJson: leads.formResponsesJson,
        })
        .from(leads)
        .where(eq(leads.visitorId, visitor.id))
        .orderBy(desc(leads.createdAt))
        .limit(1)

        const lead = latestLead[0]
        if (lead) {
          isKnownVisitor = true
          const fields = (lead.formResponsesJson as Record<string, unknown> | null) ?? null
          const firstName =
            typeof fields?.firstName === 'string' ? fields.firstName.trim() : ''
          const fallbackName =
            lead.email?.split('@')[0]?.replace(/[._-]+/g, ' ').trim() ?? ''

          returningVisitorName    = firstName || fallbackName || null
          returningVisitorCompany =
            typeof fields?.company === 'string' && fields.company.trim()
              ? fields.company.trim()
              : null
        } else if (visitor.capturedEmail) {
          isKnownVisitor = true
          returningVisitorName =
            visitor.capturedEmail.split('@')[0]?.replace(/[._-]+/g, ' ').trim() || null
        }
      }

      // Campaign link identified this visitor by URL — auto-capture the lead
      // and let the URL-supplied name win (it's fresher/more specific to this
      // exact click than whatever the DB lookup above produced, if anything).
      if (urlEmail) {
        await identifyVisitorFromUrl(visitor, urlEmail, urlFname, track.id)
        isKnownVisitor = true
        returningVisitorName = urlFname || returningVisitorName
      }

      // Resolve visitor IP → company (best-effort, non-blocking failure)
      const reqHeaders = await headers()
      const rawIp = reqHeaders.get('x-nf-client-connection-ip')           // Netlify edge
                 ?? reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim()
                 ?? reqHeaders.get('x-real-ip')
                 ?? null
      const ipInfo = await lookupIp(rawIp)

      // Create session — store IP/company so the notification bell can show it
      const [newSession] = await db.insert(sessions).values({
        visitorId: visitor.id,
        trackId: track.id,
        deviceJson: {
          ip:      ipInfo.ip,
          company: ipInfo.company,
          country: ipInfo.country,
          city:    ipInfo.city,
        },
        utmSource:   sp.utm_source?.trim()   || null,
        utmMedium:   sp.utm_medium?.trim()   || null,
        utmCampaign: sp.utm_campaign?.trim() || null,
      }).returning()

      if (newSession) sessionId = newSession.id
    } catch (err) {
      // Tracking setup failed — page still renders, just without session/visitor IDs
      console.error('[track] visitor/session setup error:', err)
    }
  }

  return (
    <div className="w-full min-h-screen bg-background text-foreground" style={{
      // Apply theme variables if any (e.g. from track.themeJson)
    }}>
      <TrackViewer
        track={{ ...track, title: resolveExternalTitle(track) }}
        assets={sortedAssets as any[]}
        org={{ id: org.id, name: org.name }}
        sessionId={sessionId}
        visitorId={visitorId}
        returningVisitorName={returningVisitorName}
        returningVisitorCompany={returningVisitorCompany}
        isKnownVisitor={isKnownVisitor}
        initialAssetIndex={(() => {
          if (requestedAssetId) {
            const idx = sortedAssets.findIndex(a => a.id === requestedAssetId)
            return idx >= 0 ? idx : 0
          }
          if (requestedAssetPosition !== null) {
            return Math.min(requestedAssetPosition, Math.max(0, sortedAssets.length - 1))
          }
          return 0
        })()}
      />
      <CookieBanner />
    </div>
  )
}
