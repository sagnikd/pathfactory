import { notFound } from 'next/navigation'
import { db } from '@/db'
import { organizations, tracks, trackAssets, assets, sessions, visitors, leads } from '@/db/schema'
import { eq, and, asc, desc } from 'drizzle-orm'
import { cookies, headers } from 'next/headers'
import TrackViewer from './TrackViewer'
import { lookupIp } from '@/lib/ipLookup'
import type { Metadata } from 'next'

type TrackTheme = {
  seoTitle?: string | null
  faviconUrl?: string | null
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

  const [track] = await db.select().from(tracks)
    .where(and(eq(tracks.organizationId, org.id), eq(tracks.slug, trackSlug)))
  if (!track) return { title: 'Content Track' }

  const theme = (track.themeJson as TrackTheme | null) ?? null
  const trackTitle = theme?.seoTitle?.trim() || `${track.title} | ${org.name}`
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
    ogTitle = `${currentAsset.title} | ${track.title}`
    ogImage = currentAsset.thumbnailUrl ?? undefined
    ogDescription = currentAsset.description ?? undefined
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
  searchParams: Promise<{ asset?: string; assetId?: string }>
}) {
  const { orgSlug, trackSlug } = await params
  const sp = await searchParams
  // ?asset=2  → 1-based position (human-friendly)
  // ?assetId=uuid → direct asset ID lookup (used by ExperienceViewer)
  // Both are resolved to a 0-based index, clamped after assets are loaded.
  const requestedAssetPosition = sp.asset ? Math.max(1, parseInt(sp.asset, 10)) - 1 : null
  const requestedAssetId = sp.assetId ?? null

  // Fetch org
  const orgs = await db.select().from(organizations).where(eq(organizations.slug, orgSlug))
  if (!orgs.length) notFound()
  const org = orgs[0]

  // Fetch track
  const trackResults = await db.select().from(tracks)
    .where(and(eq(tracks.organizationId, org.id), eq(tracks.slug, trackSlug)))
  if (!trackResults.length) notFound()
  const track = trackResults[0]

  // Fetch assets via join
  const trackAssetsData = await db.select({
    asset: assets,
    position: trackAssets.position
  })
  .from(trackAssets)
  .innerJoin(assets, eq(trackAssets.assetId, assets.id))
  .where(eq(trackAssets.trackId, track.id))
  .orderBy(asc(trackAssets.position))

  const sortedAssets = trackAssetsData.map(ta => ta.asset)

  // Visitor & Session Setup
  const cookieStore = await cookies()
  const visitorIdCookie = cookieStore.get('visitorId')?.value
  
  let sessionId = null;
  let visitorId = null;
  let returningVisitorName: string | null = null;
  let returningVisitorCompany: string | null = null;
  let isKnownVisitor = false;

  if (visitorIdCookie) {
    // Check if visitor exists
    const visitorResults = await db.select().from(visitors).where(eq(visitors.fingerprintId, visitorIdCookie))
    let visitor = visitorResults[0]
    const isReturningVisitor = !!visitor

    if (!visitor) {
      // Create visitor
      const [newVisitor] = await db.insert(visitors).values({
        fingerprintId: visitorIdCookie,
      }).returning()
      visitor = newVisitor
    }
    
    visitorId = visitor.id;

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
    }).returning()

    sessionId = newSession.id
  }

  return (
    <div className="w-full min-h-screen bg-background text-foreground" style={{
      // Apply theme variables if any (e.g. from track.themeJson)
    }}>
      <TrackViewer
        track={track}
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
    </div>
  )
}
