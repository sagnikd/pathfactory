import { db } from '@/db'
import { engagements, sessions, visitors, assets, leads } from '@/db/schema'
import { eq, count, sql, desc, inArray, and, gte, lte } from 'drizzle-orm'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import AnalyticsCharts from './AnalyticsCharts'
import { AnalyticsTables } from './SortableAnalyticsTables'
import { getDashboardAuthContext } from '@/lib/auth/impersonation'
import { DateRangeFilter } from './DateRangeFilter'
import { Suspense } from 'react'

function fmtDwell(secs: number): string {
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60)
  const s = Math.round(secs % 60)
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

/** HH:MM:SS format like the reference design */
function fmtHMS(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':')
}

// ── Company fuzzy-merge helpers ───────────────────────────────────────────────
const CORP_SUFFIXES = /\b(s\.?r\.?l\.?|s\.?a\.?s?\.?|s\.?p\.?a\.?|llc|llp|ltd|limited|inc|incorporated|corp|corporation|co\.?|gmbh|ag|bv|nv|pty|plc|lp|pvt|sdn\s*bhd)\b\.?/gi

function normCo(name: string): string {
  return name.toLowerCase().replace(CORP_SUFFIXES, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}
function tokenize(name: string): string[] {
  return normCo(name).split(' ').filter(t => t.length > 1 && !['of','the','and','de','la','le'].includes(t))
}
function coSimilarity(a: string, b: string): number {
  const ta = tokenize(a), tb = tokenize(b)
  if (!ta.length || !tb.length) return 0
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  const longerSet = new Set(longer)
  return shorter.filter(t => longerSet.has(t)).length / shorter.length
}

type AccountRaw = { company: string; contacts: number; views: number; sessions_count: number; dwell_secs: number }

/** Cluster rows with similar company names, canonical = heaviest by dwell_secs */
function mergeAccounts(rows: AccountRaw[], threshold = 0.75): AccountRaw[] {
  const clusters: AccountRaw[][] = []

  for (const row of rows) {
    const match = clusters.find(c =>
      coSimilarity(row.company, c[0].company) >= threshold
    )
    if (match) match.push(row)
    else clusters.push([row])
  }

  return clusters.map(cluster => {
    // canonical name = entry with most dwell time
    const canonical = cluster.reduce((best, r) => r.dwell_secs > best.dwell_secs ? r : best)
    return {
      company:        canonical.company,
      contacts:       cluster.reduce((s, r) => s + r.contacts,       0),
      views:          cluster.reduce((s, r) => s + r.views,          0),
      sessions_count: cluster.reduce((s, r) => s + r.sessions_count, 0),
      dwell_secs:     cluster.reduce((s, r) => s + r.dwell_secs,     0),
    }
  })
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

  const engDateConds = [
    dateFrom ? gte(engagements.ts, dateFrom) : undefined,
    dateTo   ? lte(engagements.ts, dateTo)   : undefined,
  ].filter((x): x is NonNullable<typeof x> => !!x)

  // Date filter fragment for raw SQL
  const dateFilter = dateFrom && dateTo
    ? sql` AND e.ts BETWEEN ${dateFrom} AND ${dateTo}`
    : dateFrom
    ? sql` AND e.ts >= ${dateFrom}`
    : dateTo
    ? sql` AND e.ts <= ${dateTo}`
    : sql``

  // ── 1. KPI counts ──────────────────────────────────────────────────────────
  const orgAssets   = await db.select({ id: assets.id }).from(assets).where(eq(assets.organizationId, orgId))
  const orgAssetIds = orgAssets.map(a => a.id)

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

  // ── 2. Funnel / avg dwell (existing) ──────────────────────────────────────
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

  const funnelData     = topAssets.map(a => ({ name: a.title.substring(0, 15) + (a.title.length > 15 ? '...' : ''), views: a.views }))
  const engagedAssets  = topAssets.filter(a => a.avgDwellTime > 0)
  const overallAvgDwell = engagedAssets.length > 0
    ? Math.round(engagedAssets.reduce((sum, a) => sum + a.avgDwellTime, 0) / engagedAssets.length)
    : 0

  // ── 3. Top 5 by total engagement time ─────────────────────────────────────
  type DwellRow = { asset_id: string; title: string; dwell_secs: number; views: number }
  const dwellRes = await db.execute<DwellRow>(sql`
    SELECT
      a.id   AS asset_id,
      a.title,
      (COUNT(CASE WHEN e.event_type = 'dwell_tick' THEN 1 END) * 10)::int AS dwell_secs,
      COUNT(CASE WHEN e.event_type = 'view' THEN 1 END)::int AS views
    FROM assets a
    LEFT JOIN engagements e ON e.asset_id = a.id ${dateFilter}
    WHERE a.organization_id = ${orgId}::uuid
    GROUP BY a.id, a.title
    HAVING COUNT(CASE WHEN e.event_type = 'dwell_tick' THEN 1 END) > 0
    ORDER BY dwell_secs DESC
    LIMIT 5
  `)
  const topByDwell = Array.from(dwellRes) as DwellRow[]

  // ── 4. Top 5 by content binge rate ────────────────────────────────────────
  type BingeRow = { asset_id: string; title: string; total_sessions: number; binge_sessions: number; binge_rate: number }
  const bingeRes = await db.execute<BingeRow>(sql`
    WITH session_counts AS (
      SELECT e.session_id, COUNT(DISTINCT e.asset_id) AS asset_count
      FROM engagements e
      JOIN assets a ON a.id = e.asset_id
      WHERE e.event_type = 'view'
        AND a.organization_id = ${orgId}::uuid
      GROUP BY e.session_id
    )
    SELECT
      a.id   AS asset_id,
      a.title,
      COUNT(DISTINCT e.session_id)::int AS total_sessions,
      COUNT(DISTINCT CASE WHEN sc.asset_count > 1 THEN e.session_id END)::int AS binge_sessions,
      ROUND(
        100.0 * COUNT(DISTINCT CASE WHEN sc.asset_count > 1 THEN e.session_id END)
        / GREATEST(COUNT(DISTINCT e.session_id), 1)
      )::int AS binge_rate
    FROM assets a
    JOIN engagements e ON e.asset_id = a.id AND e.event_type = 'view'
    JOIN session_counts sc ON sc.session_id = e.session_id
    WHERE a.organization_id = ${orgId}::uuid
    GROUP BY a.id, a.title
    HAVING COUNT(DISTINCT e.session_id) > 0
    ORDER BY binge_rate DESC, total_sessions DESC
    LIMIT 5
  `)
  const topByBinge = Array.from(bingeRes) as BingeRow[]

  // ── 5. Top accounts — merged lead-form company + IP geo ──────────────────
  // Priority: lead form 'company' field > IP geo company on the session.
  // Contacts = distinct captured emails from that company.
  const accountsRes = await db.execute<AccountRaw>(sql`
    WITH visitor_company AS (
      -- Per visitor: prefer the company they wrote in the lead form,
      -- fall back to whatever IP geo resolved for any of their sessions.
      SELECT
        v.id AS visitor_id,
        COALESCE(
          MAX(NULLIF(TRIM(l.form_responses_json::jsonb->>'company'), '')),
          MAX(NULLIF(s.device_json::jsonb->>'company', ''))
        ) AS company,
        MAX(l.email) AS email
      FROM visitors v
      LEFT JOIN sessions s ON s.visitor_id = v.id
      LEFT JOIN leads    l ON l.visitor_id = v.id
      GROUP BY v.id
    )
    SELECT
      vc.company,
      COUNT(DISTINCT CASE WHEN vc.email IS NOT NULL THEN vc.visitor_id END)::int AS contacts,
      COUNT(CASE WHEN e.event_type = 'view'       THEN 1 END)::int AS views,
      COUNT(DISTINCT s.id)::int                                     AS sessions_count,
      (COUNT(CASE WHEN e.event_type = 'dwell_tick' THEN 1 END) * 10)::int AS dwell_secs
    FROM visitor_company vc
    JOIN sessions    s ON s.visitor_id = vc.visitor_id
    JOIN engagements e ON e.session_id = s.id ${dateFilter}
    JOIN assets      a ON a.id = e.asset_id
    WHERE a.organization_id = ${orgId}::uuid
      AND vc.company IS NOT NULL
      AND vc.company <> ''
    GROUP BY vc.company
    ORDER BY contacts DESC, dwell_secs DESC
    LIMIT 50
  `)
  const topAccounts = mergeAccounts(Array.from(accountsRes) as AccountRaw[])
    .sort((a, b) => b.contacts - a.contacts || b.dwell_secs - a.dwell_secs)
    .slice(0, 20)

  // ── 6. Top visitors ───────────────────────────────────────────────────────
  type VisitorRow = { visitor_id: string; identifier: string; views: number; sessions_count: number; dwell_secs: number }
  const visitorsRes2 = await db.execute<VisitorRow>(sql`
    SELECT
      v.id AS visitor_id,
      COALESCE(MAX(l.email), v.captured_email, 'Visitor #' || SUBSTRING(v.id::text, 1, 8)) AS identifier,
      COUNT(CASE WHEN e.event_type = 'view' THEN 1 END)::int        AS views,
      COUNT(DISTINCT s.id)::int                                      AS sessions_count,
      (COUNT(CASE WHEN e.event_type = 'dwell_tick' THEN 1 END) * 10)::int AS dwell_secs
    FROM visitors v
    JOIN sessions s ON s.visitor_id = v.id
    JOIN engagements e ON e.session_id = s.id ${dateFilter}
    JOIN assets a ON a.id = e.asset_id
    LEFT JOIN leads l ON l.visitor_id = v.id
    WHERE a.organization_id = ${orgId}::uuid
    GROUP BY v.id, v.captured_email
    ORDER BY dwell_secs DESC
    LIMIT 10
  `)
  const topVisitors = Array.from(visitorsRes2) as VisitorRow[]

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

      <AnalyticsTables
        visitors={topVisitors}
        accounts={topAccounts}
        dwell={topByDwell}
        binge={topByBinge}
      />

      {/* Row 3: Funnel + Top Performing Assets (existing) */}
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
            <div className="space-y-4">
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
