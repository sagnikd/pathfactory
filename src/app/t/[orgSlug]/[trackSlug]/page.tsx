import { notFound } from 'next/navigation'
import { db } from '@/db'
import { organizations, tracks, trackAssets, assets, sessions, visitors } from '@/db/schema'
import { eq, and, asc } from 'drizzle-orm'
import { cookies } from 'next/headers'
import TrackViewer from './TrackViewer'

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

  if (visitorIdCookie) {
    // Check if visitor exists
    let visitorResults = await db.select().from(visitors).where(eq(visitors.fingerprintId, visitorIdCookie))
    let visitor = visitorResults[0]

    if (!visitor) {
      // Create visitor
      const [newVisitor] = await db.insert(visitors).values({
        fingerprintId: visitorIdCookie,
      }).returning()
      visitor = newVisitor
    }
    
    visitorId = visitor.id;

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
      />
    </div>
  )
}
