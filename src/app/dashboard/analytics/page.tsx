import { db } from '@/db'
import { engagements, sessions, visitors, assets } from '@/db/schema'
import { eq, count, sql, desc, inArray, and, gte, lte } from 'drizzle-orm'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import AnalyticsCharts from './AnalyticsCharts'
import { getDashboardAuthContext } from '@/lib/auth/impersonation'
import { DateRangeFilter } from './DateRangeFilter'
import { Suspense } from 'react'

function fmtDwell(secs: number): string {
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60)
  const s = Math.round(secs % 60)
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

function parseDateParam(val: string | undefined, endOfDay = false): Date | null {
  if (!val) return null
  const d = new Date(val)
  if (isNaN(d.getTime())) return null
  if (endOfDay) d.setHours(23, 59, 59, 999)
  return d
}

export default async function AnalyticsDashboard({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const { dbUser } = await getDashboardAuthContext()
  const orgId = dbUser.organizationId

  const sp       = await searchParams
  const dateFrom = parseDateParam(sp.from)
  const dateTo   = parseDateParam(sp.to, true)

  // Date filters applied to engagements.ts
  const engDateConds = [
    dateFrom ? gte(engagements.ts, dateFrom) : undefined,
    dateTo   ? lte(engagements.ts, dateTo)   : undefined,
  ].filter((x): x is NonNullable<typeof x> => !!x)

  // 1. Org assets
  const orgAssets    = await db.select({ id: assets.id }).from(assets).where(eq(assets.organizationId, orgId))
  const orgAssetIds  = orgAssets.map(a => a.id)

  let totalVisitors = 0
  let totalSessions = 0

  if (orgAssetIds.length > 0) {
    const baseWhere = and(inArray(engagements.assetId, orgAssetIds), ...engDateConds)

    const sessionsRes = await db.select({ count: count() })
      .from(sessions)
      .innerJoin(engagements, eq(sessions.id, engagements.sessionId))
      .where(baseWhere)
      .groupBy(sessions.id)
    totalSessions = sessionsRes.length

    const visitorsRes = await db.select({ count: count() })
      .from(visitors)
      .innerJoin(sessions, eq(visitors.id, sessions.visitorId))
      .innerJoin(engagements, eq(sessions.id, engagements.sessionId))
      .where(baseWhere)
      .groupBy(visitors.id)
    totalVisitors = visitorsRes.length
  }

  // 2. Top assets with date-filtered engagement join
  const topAssets = await db.select({
    assetId: assets.id,
    title:   assets.title,
    views: sql<number>`count(CASE WHEN ${engagements.eventType} = 'view' THEN 1 END)`.mapWith(Number),
    avgDwellTime: sql<number>`
      count(CASE WHEN ${engagements.eventType} = 'dwell_tick' THEN 1 END) * 10.0
      / GREATEST(
          count(DISTINCT CASE WHEN ${engagements.eventType} = 'dwell_tick' THEN ${engagements.sessionId} END),
          1
        )`.mapWith(Number),
  })
  .from(assets)
  .leftJoin(engagements, and(eq(assets.id, engagements.assetId), ...engDateConds))
  .where(eq(assets.organizationId, orgId))
  .groupBy(assets.id, assets.title)
  .orderBy(desc(sql`count(CASE WHEN ${engagements.eventType} = 'view' THEN 1 END)`))
  .limit(5)

  const funnelData = topAssets.map(a => ({
    name:  a.title.substring(0, 15) + (a.title.length > 15 ? '...' : ''),
    views: a.views,
  }))

  const engagedAssets   = topAssets.filter(a => a.avgDwellTime > 0)
  const overallAvgDwell = engagedAssets.length > 0
    ? Math.round(engagedAssets.reduce((sum, a) => sum + a.avgDwellTime, 0) / engagedAssets.length)
    : 0

  const rangeLabel = sp.from || sp.to
    ? [sp.from, sp.to].filter(Boolean).join(' → ')
    : 'All time'

  return (
    <div className="space-y-6">
      {/* Header + filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{rangeLabel}</p>
        </div>
        <Suspense>
          <DateRangeFilter />
        </Suspense>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 md:grid-cols-3">
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
            <CardTitle className="text-sm font-medium">Avg Dwell / Asset</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmtDwell(overallAvgDwell)}</div>
            <p className="text-xs text-muted-foreground">
              Across {engagedAssets.length} asset{engagedAssets.length !== 1 ? 's' : ''} with engagement
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Asset View Funnel</CardTitle>
          </CardHeader>
          <CardContent className="pl-2">
            <AnalyticsCharts funnelData={funnelData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Performing Assets</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {topAssets.map(asset => (
                <div key={asset.assetId} className="flex items-center gap-4">
                  <div className="space-y-1 min-w-0 flex-1">
                    <p className="text-sm font-medium leading-none truncate">{asset.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {asset.views} view{asset.views !== 1 ? 's' : ''} · avg {fmtDwell(Math.round(asset.avgDwellTime))} dwell
                    </p>
                  </div>
                  <div className="font-medium text-sm shrink-0">{asset.views} views</div>
                </div>
              ))}
              {topAssets.length === 0 && (
                <p className="text-muted-foreground text-sm">No data yet.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
