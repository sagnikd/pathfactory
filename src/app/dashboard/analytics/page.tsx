import { db } from '@/db'
import { engagements, sessions, visitors, assets, companyAliases, tracks } from '@/db/schema'
import { eq, count, sql, inArray, and, gte, lte } from 'drizzle-orm'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import AnalyticsCharts, { CampaignDonut } from './AnalyticsCharts'
import { AnalyticsTables, TrackStatsTable, ExperienceStatsTable, ContentClicksTable, type TrackStatRow, type ExperienceStatRow, type ContentClickRow } from './SortableAnalyticsTables'
import { getDashboardAuthContext } from '@/lib/auth/impersonation'
import { DateRangeFilter } from './DateRangeFilter'
import { TrackFilter } from './TrackFilter'
import { Suspense } from 'react'

function fmtDwell(secs: number): string {
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60)
  const s = Math.round(secs % 60)
  return s > 0 ? `${m}m ${s}s` : `${m}m`
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

type AccountSqlRow = { company: string; contacts: number; views: number; sessions_count: number; dwell_secs: number }
type AccountRaw = AccountSqlRow & { rawCompany: string }
type AccountMerged = AccountSqlRow & { companies: string[] }

/** Cluster rows with similar company names, canonical = heaviest by dwell_secs.
 *  `companies` on the result carries every RAW (pre-alias-rename) name folded
 *  into that cluster — that's what's actually stored on visitors/leads in the
 *  DB, so callers must query leads by rawCompany, not the display `company`. */
function mergeAccounts(rows: AccountRaw[], threshold = 0.75): AccountMerged[] {
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
      companies:      cluster.map(r => r.rawCompany),
      contacts:       cluster.reduce((s, r) => s + r.contacts,       0),
      views:          cluster.reduce((s, r) => s + r.views,          0),
      sessions_count: cluster.reduce((s, r) => s + r.sessions_count, 0),
      dwell_secs:     cluster.reduce((s, r) => s + r.dwell_secs,     0),
    }
  })
}

function getSearchParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function parseDateParam(val: string | string[] | undefined, endOfDay = false): Date | null {
  const raw = getSearchParam(val)?.trim()
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null

  const [year, month, day] = raw.split('-').map(Number)
  const d = new Date(year, month - 1, day)
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    return null
  }

  if (endOfDay) d.setHours(23, 59, 59, 999)
  else d.setHours(0, 0, 0, 0)
  return d
}

function toSqlTimestamp(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  const millis = String(date.getMilliseconds()).padStart(3, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${millis}`
}

export default async function AnalyticsDashboard({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[]; to?: string | string[]; trackId?: string | string[] }>
}) {
  const { dbUser } = await getDashboardAuthContext()
  const orgId = dbUser.organizationId

  const sp       = await searchParams
  const rawFrom  = getSearchParam(sp.from)
  const rawTo    = getSearchParam(sp.to)
  const trackId  = getSearchParam(sp.trackId) || null
  let dateFrom   = parseDateParam(rawFrom)
  let dateTo     = parseDateParam(rawTo, true)

  if (dateFrom && dateTo && dateFrom > dateTo) {
    ;[dateFrom, dateTo] = [parseDateParam(rawTo), parseDateParam(rawFrom, true)]
  }

  const dateFromSql = dateFrom ? toSqlTimestamp(dateFrom) : null
  const dateToSql = dateTo ? toSqlTimestamp(dateTo) : null

  const engDateConds = [
    dateFrom ? gte(engagements.ts, dateFrom) : undefined,
    dateTo   ? lte(engagements.ts, dateTo)   : undefined,
  ].filter((x): x is NonNullable<typeof x> => !!x)

  // Date filter fragment for raw SQL
  const dateFilter = dateFromSql && dateToSql
    ? sql` AND e.ts BETWEEN ${dateFromSql}::timestamp AND ${dateToSql}::timestamp`
    : dateFromSql
    ? sql` AND e.ts >= ${dateFromSql}::timestamp`
    : dateToSql
    ? sql` AND e.ts <= ${dateToSql}::timestamp`
    : sql``

  // Track filter fragment for raw SQL — appended alongside dateFilter wherever
  // a query already joins a sessions row aliased `s`.
  const trackFilter = trackId ? sql` AND s.track_id = ${trackId}::uuid` : sql``

  // ── 1. KPI counts ──────────────────────────────────────────────────────────
  const orgAssets   = await db.select({ id: assets.id }).from(assets).where(eq(assets.organizationId, orgId))
  const orgAssetIds = orgAssets.map(a => a.id)

  let totalVisitors = 0
  let totalSessions = 0

  if (orgAssetIds.length > 0) {
    const baseWhere = and(
      inArray(engagements.assetId, orgAssetIds),
      ...engDateConds,
      ...(trackId ? [eq(sessions.trackId, trackId)] : []),
    )

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

  // Org-wide count of CTA ("Talk to us") clicks, date + track scoped.
  const ctaClicksRes = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count
    FROM engagements e
    JOIN sessions s ON s.id = e.session_id
    JOIN assets   a ON a.id = e.asset_id
    WHERE a.organization_id = ${orgId}::uuid
      AND e.event_type = 'cta_click'
      ${dateFilter}
      ${trackFilter}
  `)
  const ctaClicks = Array.from(ctaClicksRes)[0]?.count ?? 0

  // ── 2. Funnel / avg dwell (existing) ──────────────────────────────────────
  type TopAssetRow = { asset_id: string; title: string; views: number; avg_dwell_time: number }
  const topAssetsRes = await db.execute<TopAssetRow>(sql`
    SELECT
      a.id AS asset_id,
      a.title,
      COUNT(CASE WHEN e.event_type = 'view' THEN 1 END)::int AS views,
      (
        COUNT(CASE WHEN e.event_type = 'dwell_tick' THEN 1 END) * 10.0
        / GREATEST(COUNT(DISTINCT CASE WHEN e.event_type = 'dwell_tick' THEN e.session_id END), 1)
      ) AS avg_dwell_time
    FROM assets a
    LEFT JOIN engagements e ON e.asset_id = a.id ${dateFilter}
    LEFT JOIN sessions s ON s.id = e.session_id
    WHERE a.organization_id = ${orgId}::uuid
      ${trackFilter}
    GROUP BY a.id, a.title
    ORDER BY views DESC
    LIMIT 5
  `)
  const topAssets = (Array.from(topAssetsRes) as TopAssetRow[]).map(r => ({
    assetId: r.asset_id,
    title: r.title,
    views: r.views,
    avgDwellTime: Number(r.avg_dwell_time),
  }))

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
    LEFT JOIN sessions s ON s.id = e.session_id
    WHERE a.organization_id = ${orgId}::uuid
      ${trackFilter}
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
    JOIN sessions s ON s.id = e.session_id
    WHERE a.organization_id = ${orgId}::uuid
      ${trackFilter}
    GROUP BY a.id, a.title
    HAVING COUNT(DISTINCT e.session_id) > 0
    ORDER BY binge_rate DESC, total_sessions DESC
    LIMIT 5
  `)
  const topByBinge = Array.from(bingeRes) as BingeRow[]

  // ── 5. Top accounts — merged lead-form company + IP geo ──────────────────
  // Priority: lead form 'company' field > IP geo company on the session.
  // Contacts = distinct captured emails from that company.
  const accountsRes = await db.execute<AccountSqlRow>(sql`
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
      ${trackFilter}
    GROUP BY vc.company
    ORDER BY contacts DESC, dwell_secs DESC
    LIMIT 50
  `)
  const rawAccountRows = Array.from(accountsRes) as AccountSqlRow[]

  // Manual overrides for company names automatic fuzzy matching doesn't catch
  // (e.g. "HCLTech" has zero token overlap with "HCL Technologies"). Applied
  // before fuzzy merge so aliased rows collapse into the same cluster. Keep
  // rawCompany = the untouched DB value — getAccountLeads must filter by that,
  // not the renamed display `company`, since that's what's actually stored on
  // visitors/leads.
  const aliases = await db.select({
    id: companyAliases.id,
    aliasName: companyAliases.aliasName,
    canonicalName: companyAliases.canonicalName,
  }).from(companyAliases).where(eq(companyAliases.organizationId, orgId))

  const aliasMap = new Map(aliases.map(a => [a.aliasName.toLowerCase(), a.canonicalName]))
  const aliasedRows: AccountRaw[] = rawAccountRows.map(r => ({
    ...r,
    rawCompany: r.company,
    company: aliasMap.get(r.company.toLowerCase()) ?? r.company,
  }))

  const topAccounts = mergeAccounts(aliasedRows)
    .sort((a, b) => b.contacts - a.contacts || b.dwell_secs - a.dwell_secs)
    .slice(0, 20)

  // Distinct raw company names, for the "merge accounts" picker — the alias
  // target itself should always be selectable even after being applied once.
  const allCompanyNames = [...new Set([
    ...rawAccountRows.map(r => r.company),
    ...aliases.map(a => a.canonicalName),
  ])].sort((a, b) => a.localeCompare(b))

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
      ${trackFilter}
    GROUP BY v.id, v.captured_email
    ORDER BY dwell_secs DESC
    LIMIT 10
  `)
  const topVisitors = Array.from(visitorsRes2) as VisitorRow[]

  // ── 6b. Campaign breakdown — session volume by UTM source/medium/campaign ──
  type CampaignRow = { source: string; sessions: number }
  async function campaignBreakdownBy(column: 'utm_source' | 'utm_medium' | 'utm_campaign') {
    const res = await db.execute<CampaignRow>(sql`
      SELECT
        COALESCE(NULLIF(TRIM(s.${sql.raw(column)}), ''), 'Direct / Other') AS source,
        COUNT(DISTINCT s.id)::int AS sessions
      FROM sessions s
      JOIN engagements e ON e.session_id = s.id ${dateFilter}
      JOIN assets      a ON a.id = e.asset_id
      WHERE a.organization_id = ${orgId}::uuid
        ${trackFilter}
      GROUP BY 1
      ORDER BY sessions DESC
    `)
    return Array.from(res) as CampaignRow[]
  }
  const campaignSourceData   = await campaignBreakdownBy('utm_source')
  const campaignMediumData   = await campaignBreakdownBy('utm_medium')
  const campaignCampaignData = await campaignBreakdownBy('utm_campaign')

  // All tracks in the org, for the track-picker filter.
  const allTracks = await db.select({ id: tracks.id, title: tracks.title })
    .from(tracks)
    .where(eq(tracks.organizationId, orgId))
    .orderBy(tracks.title)

  // ── 7. Track & Experience performance ────────────────────────────────────────
  // All tracks metadata (needed to detect experiences even if they have 0 sessions)
  type TrackMeta = { track_id: string; title: string; slug: string; layout: string; theme_json_text: string }
  const trackMetaRes = await db.execute<TrackMeta>(sql`
    SELECT id AS track_id, title, slug, layout, theme_json::text AS theme_json_text
    FROM tracks
    WHERE organization_id = ${orgId}::uuid
  `)
  const allTrackMeta = Array.from(trackMetaRes) as TrackMeta[]

  // Stats per track (only tracks with engagement in date range)
  type TrackStatRaw = { track_id: string; sessions_count: number; unique_visitors: number; total_dwell_secs: number; views: number }
  const trackStatRes = await db.execute<TrackStatRaw>(sql`
    SELECT
      s.track_id::text AS track_id,
      COUNT(DISTINCT s.id)::int          AS sessions_count,
      COUNT(DISTINCT s.visitor_id)::int  AS unique_visitors,
      (COUNT(CASE WHEN e.event_type = 'dwell_tick' THEN 1 END) * 10)::int AS total_dwell_secs,
      COUNT(CASE WHEN e.event_type = 'view' THEN 1 END)::int              AS views
    FROM sessions s
    JOIN tracks t      ON t.id = s.track_id AND t.organization_id = ${orgId}::uuid
    JOIN engagements e ON e.session_id = s.id ${dateFilter}
    WHERE true ${trackFilter}
    GROUP BY s.track_id
  `)
  const trackStatMap = new Map(
    (Array.from(trackStatRes) as TrackStatRaw[]).map(r => [r.track_id, r])
  )

  function parseSelectedIds(text: string): string[] {
    try {
      const j = JSON.parse(text || '{}')
      return Array.isArray(j.selectedTrackIds)
        ? j.selectedTrackIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
        : []
    } catch { return [] }
  }

  // Build experience rows (parent tracks with selectedTrackIds)
  const childTrackIdSet = new Set<string>()
  const expRowsRaw: ExperienceStatRow[] = []
  for (const meta of allTrackMeta) {
    const childIds = parseSelectedIds(meta.theme_json_text)
    if (childIds.length > 0) {
      childIds.forEach(id => childTrackIdSet.add(id))
      const children = childIds.map(id => trackStatMap.get(id)).filter((r): r is TrackStatRaw => !!r)
      expRowsRaw.push({
        track_id:         meta.track_id,
        title:            meta.title,
        track_count:      childIds.length,
        sessions_count:   children.reduce((s, c) => s + c.sessions_count,   0),
        unique_visitors:  children.reduce((s, c) => s + c.unique_visitors,  0),
        total_dwell_secs: children.reduce((s, c) => s + c.total_dwell_secs, 0),
        views:            children.reduce((s, c) => s + c.views,            0),
      })
    }
  }
  const experienceStats = expRowsRaw
    .filter(e => e.sessions_count > 0)
    .sort((a, b) => b.sessions_count - a.sessions_count)

  // Track-wise analytics should include every non-experience track, even if it
  // is also used inside an experience page.
  const trackStats: TrackStatRow[] = allTrackMeta
    .filter(meta => {
      const childIds = parseSelectedIds(meta.theme_json_text)
      return childIds.length === 0
    })
    .map(meta => {
      const s = trackStatMap.get(meta.track_id)
      return {
        track_id:         meta.track_id,
        title:            meta.title,
        slug:             meta.slug,
        layout:           meta.layout,
        sessions_count:   s?.sessions_count   ?? 0,
        unique_visitors:  s?.unique_visitors  ?? 0,
        total_dwell_secs: s?.total_dwell_secs ?? 0,
        views:            s?.views            ?? 0,
      }
    })
    .filter(t => t.sessions_count > 0)
    .sort((a, b) => b.sessions_count - a.sessions_count)

  // ── Content link/button clicks ────────────────────────────────────────────
  type ContentClickSqlRow = { asset_id: string; asset_title: string; label: string; href: string | null; click_count: number }
  const contentClicksRes = await db.execute<ContentClickSqlRow>(sql`
    SELECT
      a.id   AS asset_id,
      a.title AS asset_title,
      COALESCE(e.payload_json->>'label', '(content area click)') AS label,
      e.payload_json->>'href' AS href,
      COUNT(*)::int AS click_count
    FROM engagements e
    JOIN assets   a ON a.id  = e.asset_id
    JOIN sessions s ON s.id  = e.session_id
    WHERE a.organization_id = ${orgId}::uuid
      AND e.event_type = 'click'
      AND e.payload_json IS NOT NULL
      ${dateFilter}
      ${trackFilter}
    GROUP BY a.id, a.title, label, href
    ORDER BY click_count DESC
    LIMIT 100
  `)
  const contentClicks: ContentClickRow[] = (Array.from(contentClicksRes) as ContentClickSqlRow[]).map(r => ({
    assetId:    r.asset_id,
    assetTitle: r.asset_title,
    label:      r.label,
    href:       r.href ?? null,
    clickCount: r.click_count,
  }))

  const rangeLabel = rawFrom || rawTo
    ? [rawFrom, rawTo].filter(Boolean).join(' → ')
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
          <div className="flex flex-wrap items-center gap-2">
            <TrackFilter tracks={allTracks} />
            <DateRangeFilter />
          </div>
        </Suspense>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">CTA Clicks</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{ctaClicks}</div>
            <p className="text-xs text-muted-foreground">&quot;Talk to us&quot; button clicks</p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Track and Experience Analytics</h2>
          <p className="text-sm text-muted-foreground">
            Compare engagement by individual tracks and rolled-up experience pages.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Track Performance</CardTitle>
              <p className="text-xs text-muted-foreground">Sessions, visitors, views, and dwell per track. Click headers to sort.</p>
            </CardHeader>
            <CardContent className="p-0">
              <TrackStatsTable rows={trackStats} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Experience Performance</CardTitle>
              <p className="text-xs text-muted-foreground">Aggregated from the tracks included in each experience. Click headers to sort.</p>
            </CardHeader>
            <CardContent className="p-0">
              <ExperienceStatsTable rows={experienceStats} />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Campaign breakdown — clicks that landed on tracks, by UTM source/medium/campaign */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Campaign Sources</CardTitle>
            <p className="text-xs text-muted-foreground">Sessions by <code>utm_source</code>.</p>
          </CardHeader>
          <CardContent>
            <CampaignDonut data={campaignSourceData} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Campaign Mediums</CardTitle>
            <p className="text-xs text-muted-foreground">Sessions by <code>utm_medium</code>.</p>
          </CardHeader>
          <CardContent>
            <CampaignDonut data={campaignMediumData} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Campaigns</CardTitle>
            <p className="text-xs text-muted-foreground">Sessions by <code>utm_campaign</code>.</p>
          </CardHeader>
          <CardContent>
            <CampaignDonut data={campaignCampaignData} />
          </CardContent>
        </Card>
      </div>

      <AnalyticsTables
        visitors={topVisitors}
        accounts={topAccounts}
        dwell={topByDwell}
        binge={topByBinge}
        dateFromSql={dateFromSql}
        dateToSql={dateToSql}
        allCompanyNames={allCompanyNames}
        aliases={aliases}
      />

      {/* Content clicks table */}
      <Card>
        <CardHeader>
          <CardTitle>Content Clicks</CardTitle>
          <p className="text-xs text-muted-foreground">
            Button and link clicks tracked inside assets. PDF annotation links show full text.
            Article embeds show &quot;content area click&quot; (cross-origin — button text unavailable).
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <ContentClicksTable rows={contentClicks} />
        </CardContent>
      </Card>

      {/* Row 4: Funnel + Top Performing Assets (existing) */}
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
