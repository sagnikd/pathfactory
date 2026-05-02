import { db } from '@/db'
import { engagements, sessions, visitors, assets, users } from '@/db/schema'
import { eq, count, sql, desc, inArray } from 'drizzle-orm'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import AnalyticsCharts from './AnalyticsCharts'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function AnalyticsDashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return redirect('/login')

  const userOrgs = await db.select().from(users).where(eq(users.id, user.id))
  const userRecord = userOrgs[0]
  if (!userRecord || !userRecord.organizationId) return redirect('/login')
  const orgId = userRecord.organizationId

  // 1. Overview stats
  // Total visitors and sessions are global for the org right now. To be precise, we filter by assets belonging to the org.
  // We'll get all assets for this org to use as a filter
  const orgAssets = await db.select({ id: assets.id }).from(assets).where(eq(assets.organizationId, orgId))
  const orgAssetIds = orgAssets.map(a => a.id)

  let totalVisitors = 0;
  let totalSessions = 0;
  
  if (orgAssetIds.length > 0) {
    const sessionsRes = await db.select({ count: count() })
      .from(sessions)
      .innerJoin(engagements, eq(sessions.id, engagements.sessionId))
      .where(inArray(engagements.assetId, orgAssetIds))
      .groupBy(sessions.id)
    
    totalSessions = sessionsRes.length; // Distinct sessions that interacted with org assets

    const visitorsRes = await db.select({ count: count() })
      .from(visitors)
      .innerJoin(sessions, eq(visitors.id, sessions.visitorId))
      .innerJoin(engagements, eq(sessions.id, engagements.sessionId))
      .where(inArray(engagements.assetId, orgAssetIds))
      .groupBy(visitors.id)
      
    totalVisitors = visitorsRes.length;
  }

  // 2. Top Assets
  const topAssets = await db.select({
    assetId: assets.id,
    title: assets.title,
    views: sql<number>`count(CASE WHEN ${engagements.eventType} = 'view' THEN 1 END)`.mapWith(Number),
    avgDwellTime: sql<number>`count(CASE WHEN ${engagements.eventType} = 'dwell_tick' THEN 1 END) * 5 / GREATEST(count(DISTINCT ${engagements.sessionId}), 1)`.mapWith(Number)
  })
  .from(assets)
  .leftJoin(engagements, eq(assets.id, engagements.assetId))
  .where(eq(assets.organizationId, orgId))
  .groupBy(assets.id, assets.title)
  .orderBy(desc(sql`count(CASE WHEN ${engagements.eventType} = 'view' THEN 1 END)`))
  .limit(5)

  const funnelData = topAssets.map(a => ({
    name: a.title.substring(0, 15) + (a.title.length > 15 ? '...' : ''),
    views: a.views
  }))

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8">Analytics Overview</h1>

      <div className="grid gap-4 md:grid-cols-3 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Visitors</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalVisitors}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalSessions}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Average Dwell / Asset</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {topAssets.length > 0 ? Math.round(topAssets[0].avgDwellTime) : 0}s
            </div>
            <p className="text-xs text-muted-foreground">Based on top asset</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Asset View Funnel</CardTitle>
          </CardHeader>
          <CardContent className="pl-2">
            <AnalyticsCharts funnelData={funnelData} />
          </CardContent>
        </Card>

        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Top Performing Assets</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-8">
              {topAssets.map(asset => (
                <div key={asset.assetId} className="flex items-center">
                  <div className="ml-4 space-y-1">
                    <p className="text-sm font-medium leading-none">{asset.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {asset.views} views • avg {Math.round(asset.avgDwellTime)}s dwell
                    </p>
                  </div>
                  <div className="ml-auto font-medium">
                    {asset.views} views
                  </div>
                </div>
              ))}
              {topAssets.length === 0 && (
                <div className="text-muted-foreground text-sm">No data available yet.</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
