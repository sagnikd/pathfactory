import { db } from '@/db'
import { leads, visitors, sessions, engagements, assets, tracks } from '@/db/schema'
import { eq, inArray, desc, asc, and, ne, count, sql, isNotNull } from 'drizzle-orm'
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

  const visitorIdsFromSessions = Array.from(new Set(orgSessions.map(s => s.visitorId)))

  // Also include leads submitted via the gate form by fresh visitors who had no
  // session yet (middleware sets the cookie on the response, so page.tsx can't
  // read it back on first-ever visit — the visitor has no session/engagements
  // but the lead row carries the trackId, which scopes it to this org).
  const orgTracks = await db.select({ id: tracks.id }).from(tracks).where(eq(tracks.organizationId, orgId))
  const orgTrackIds = orgTracks.map(t => t.id)

  const visitorIdsFromLeads = orgTrackIds.length > 0
    ? (await db.select({ visitorId: leads.visitorId }).from(leads)
        .where(and(inArray(leads.trackId, orgTrackIds), isNotNull(leads.trackId))))
        .map(l => l.visitorId)
    : []

  const validVisitorIds = Array.from(new Set([...visitorIdsFromSessions, ...visitorIdsFromLeads]))

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
  // Dwell tick counts per (sessionId, assetId) — each tick ≈ 10s
  const dwelledPairs = await db.select({
    sessionId: engagements.sessionId,
    assetId: engagements.assetId,
    ticks: count(),
  })
  .from(engagements)
  .innerJoin(sessions, eq(engagements.sessionId, sessions.id))
  .where(and(inArray(sessions.visitorId, validVisitorIds), eq(engagements.eventType, 'dwell_tick')))
  .groupBy(engagements.sessionId, engagements.assetId)

  const dwelledMap = new Map(dwelledPairs.map((p) => [`${p.sessionId}:${p.assetId}`, p.ticks * 10]))
  const dwelledSet = new Set(dwelledMap.keys())

  const timelineData = await db.select({
    visitorId: visitors.id,
    sessionId: sessions.id,
    assetId: engagements.assetId,
    eventType: engagements.eventType,
    ts: engagements.ts,
    assetTitle: assets.title
  })
  .from(visitors)
  .innerJoin(sessions, eq(visitors.id, sessions.visitorId))
  .innerJoin(engagements, eq(sessions.id, engagements.sessionId))
  .innerJoin(assets, eq(engagements.assetId, assets.id))
  .where(and(inArray(visitors.id, validVisitorIds), ne(engagements.eventType, 'dwell_tick')))
  .orderBy(asc(engagements.ts))

  // Group timeline by visitor — only assets visitor dwelled on (no hurried clicks)
  const timelinesByVisitor: Record<string, (typeof timelineData[number] & { dwellSeconds: number })[]> = {}
  for (const event of timelineData) {
    const key = `${event.sessionId}:${event.assetId}`
    if (!dwelledSet.has(key)) continue
    if (!timelinesByVisitor[event.visitorId]) timelinesByVisitor[event.visitorId] = []
    timelinesByVisitor[event.visitorId].push({ ...event, dwellSeconds: dwelledMap.get(key) ?? 0 })
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
