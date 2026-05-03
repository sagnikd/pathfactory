import { notFound } from 'next/navigation'
import { db } from '@/db'
import { organizations, tracks, trackAssets, assets, sessions, visitors, leads } from '@/db/schema'
import { eq, and, asc, desc } from 'drizzle-orm'
import { cookies } from 'next/headers'
import TrackViewer from './TrackViewer'
import type { Metadata } from 'next'

type TrackTheme = {
  seoTitle?: string | null
  faviconUrl?: string | null
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ orgSlug: string, trackSlug: string }>
}): Promise<Metadata> {
  const { orgSlug, trackSlug } = await params

  const [org] = await db.select().from(organizations).where(eq(organizations.slug, orgSlug))
  if (!org) return { title: 'Content Track' }

  const [track] = await db.select().from(tracks)
    .where(and(eq(tracks.organizationId, org.id), eq(tracks.slug, trackSlug)))
  if (!track) return { title: 'Content Track' }

  const theme = (track.themeJson as TrackTheme | null) ?? null
  const pageTitle = theme?.seoTitle?.trim() || `${track.title} | ${org.name}`
  const favicon = theme?.faviconUrl?.trim() || undefined

  return {
    title: pageTitle,
    icons: favicon ? { icon: favicon, shortcut: favicon, apple: favicon } : undefined,
  }
}

export default async function PublicTrackPage({
  params
}: {
  params: Promise<{ orgSlug: string, trackSlug: string }>
}) {
  const { orgSlug, trackSlug } = await params;

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

        returningVisitorName = firstName || fallbackName || null
      } else if (visitor.capturedEmail) {
        isKnownVisitor = true
        returningVisitorName =
          visitor.capturedEmail.split('@')[0]?.replace(/[._-]+/g, ' ').trim() || null
      }
    }

    // Create session
    const [newSession] = await db.insert(sessions).values({
      visitorId: visitor.id,
      trackId: track.id,
    }).returning()

    sessionId = newSession.id
  }

  return (
    <div className="w-full min-h-screen bg-background text-foreground" style={{
      // Apply theme variables if any (e.g. from track.themeJson)
    }}>
      <TrackViewer 
        track={track} 
        assets={sortedAssets} 
        org={org} 
        sessionId={sessionId} 
        visitorId={visitorId}
        returningVisitorName={returningVisitorName}
        isKnownVisitor={isKnownVisitor}
      />
    </div>
  )
}
