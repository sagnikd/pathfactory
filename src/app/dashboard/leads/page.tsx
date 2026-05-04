import { db } from '@/db'
import { leads, visitors, sessions, engagements, assets, tracks } from '@/db/schema'
import { eq, inArray, desc, and, count } from 'drizzle-orm'
import LeadClientList from './LeadClientList'
import { computeLeadScores } from '@/lib/leadScore'
import { getDashboardAuthContext } from '@/lib/auth/impersonation'

export default async function LeadsPage() {
  const { dbUser } = await getDashboardAuthContext()
  const orgId = dbUser.organizationId

  // Find visitors who interacted with this org's assets
  const orgAssets = await db.select({ id: assets.id }).from(assets).where(eq(assets.organizationId, orgId))
  const orgAssetIds = orgAssets.map(a => a.id)

  if (orgAssetIds.length === 0) {
    return <div className="p-8"><h1 className="text-3xl font-bold mb-8">Leads & Visitors</h1><p className="text-muted-foreground">No assets or leads found. Start by creating assets in the Asset Library.</p></div>
  }

  const orgSessions = await db.select({ visitorId: sessions.visitorId }).from(sessions)
    .innerJoin(engagements, eq(sessions.id, engagements.sessionId))
    .where(inArray(engagements.assetId, orgAssetIds))

  const validVisitorIds = Array.from(new Set(orgSessions.map(s => s.visitorId)))

  if (validVisitorIds.length === 0) {
    return <div className="p-8"><h1 className="text-3xl font-bold mb-8">Leads & Visitors</h1><p className="text-muted-foreground">No leads found yet.</p></div>
  }

  const validLeads = await db.select()
    .from(leads)
    .where(inArray(leads.visitorId, validVisitorIds))
    .orderBy(desc(leads.score))

  // Compute live engagement-based scores for every visitor
  const liveScores = await computeLeadScores(validVisitorIds)

  // Fetch timeline data for these valid leads
  const timelineData = await db.select({
    visitorId: visitors.id,
    sessionId: sessions.id,
    eventType: engagements.eventType,
    ts: engagements.ts,
    assetTitle: assets.title
  })
  .from(visitors)
  .innerJoin(sessions, eq(visitors.id, sessions.visitorId))
  .innerJoin(engagements, eq(sessions.id, engagements.sessionId))
  .innerJoin(assets, eq(engagements.assetId, assets.id))
  .where(inArray(visitors.id, validVisitorIds))
  .orderBy(desc(engagements.ts))

  // Group timeline by visitor
  const timelinesByVisitor: Record<string, typeof timelineData> = {}
  for (const event of timelineData) {
    if (!timelinesByVisitor[event.visitorId]) {
      timelinesByVisitor[event.visitorId] = []
    }
    timelinesByVisitor[event.visitorId].push(event)
  }

  // ── Anonymous traffic ──────────────────────────────────────────────────
  // Sessions for this org's tracks where the visitor never submitted a lead
  const knownVisitorIds = new Set(validLeads.map(l => l.visitorId))

  const anonSessions = await db
    .select({
      sessionId:  sessions.id,
      visitorId:  sessions.visitorId,
      startedAt:  sessions.startedAt,
      deviceJson: sessions.deviceJson,
      trackTitle: tracks.title,
    })
    .from(sessions)
    .innerJoin(tracks, eq(sessions.trackId, tracks.id))
    .where(eq(tracks.organizationId, orgId))
    .orderBy(desc(sessions.startedAt))
    .limit(500)

  const anonOnlySessions = anonSessions.filter(s => !knownVisitorIds.has(s.visitorId))
  const anonSessionIds   = anonOnlySessions.map(s => s.sessionId)

  // Dwell ticks per session → seconds watched
  const dwellRows = anonSessionIds.length > 0
    ? await db
        .select({ sessionId: engagements.sessionId, ticks: count() })
        .from(engagements)
        .where(
          and(
            inArray(engagements.sessionId, anonSessionIds),
            eq(engagements.eventType, 'dwell_tick')
          )
        )
        .groupBy(engagements.sessionId)
    : []

  const dwellMap: Record<string, number> = {}
  for (const row of dwellRows) dwellMap[row.sessionId] = Number(row.ticks) * 10

  // Dedupe by visitor — accumulate dwell across sessions, keep latest timestamp
  const anonByVisitor: Record<string, {
    visitorId:   string
    company:     string | null
    country:     string | null
    city:        string | null
    trackTitle:  string
    dwellSeconds: number
    lastSeen:    Date
  }> = {}

  for (const s of anonOnlySessions) {
    const device = (s.deviceJson ?? {}) as Record<string, string | null>
    const existing = anonByVisitor[s.visitorId]
    const dwell = dwellMap[s.sessionId] ?? 0
    if (!existing) {
      anonByVisitor[s.visitorId] = {
        visitorId:   s.visitorId,
        company:     device.company  ?? null,
        country:     device.country  ?? null,
        city:        device.city     ?? null,
        trackTitle:  s.trackTitle,
        dwellSeconds: dwell,
        lastSeen:    s.startedAt,
      }
    } else {
      existing.dwellSeconds += dwell
      if (s.startedAt > existing.lastSeen) existing.lastSeen = s.startedAt
    }
  }

  const anonymousTraffic = Object.values(anonByVisitor)
    .sort((a, b) => b.dwellSeconds - a.dwellSeconds)
  // ────────────────────────────────────────────────────────────────────────

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Leads & Engagement</h1>
          <p className="text-muted-foreground mt-2">View captured leads and their complete journey through your content tracks.</p>
        </div>
      </div>
      <LeadClientList
        leads={validLeads}
        timelines={timelinesByVisitor}
        liveScores={liveScores}
        anonymousTraffic={anonymousTraffic}
      />
    </div>
  )
}
