import { db } from '@/db'
import { leads, visitors, sessions, engagements, assets } from '@/db/schema'
import { eq, inArray, desc } from 'drizzle-orm'
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

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Leads & Engagement</h1>
          <p className="text-muted-foreground mt-2">View captured leads and their complete journey through your content tracks.</p>
        </div>
      </div>
      <LeadClientList leads={validLeads} timelines={timelinesByVisitor} liveScores={liveScores} />
    </div>
  )
}
