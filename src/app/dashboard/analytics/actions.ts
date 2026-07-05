'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/db'
import { companyAliases } from '@/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { getDashboardAuthContext } from '@/lib/auth/impersonation'

export async function mergeCompanies(aliasName: string, canonicalName: string) {
  const { dbUser } = await getDashboardAuthContext()
  const alias = aliasName.trim()
  const canonical = canonicalName.trim()
  if (!alias || !canonical || alias.toLowerCase() === canonical.toLowerCase()) {
    return { success: false, error: 'Pick two different account names' }
  }

  await db.insert(companyAliases).values({
    organizationId: dbUser.organizationId,
    aliasName: alias,
    canonicalName: canonical,
  })

  revalidatePath('/dashboard/analytics')
  return { success: true }
}

export async function deleteCompanyAlias(id: string) {
  const { dbUser } = await getDashboardAuthContext()
  await db.delete(companyAliases).where(
    and(eq(companyAliases.id, id), eq(companyAliases.organizationId, dbUser.organizationId))
  )
  revalidatePath('/dashboard/analytics')
  return { success: true }
}

export type AccountLeadRow = {
  visitorId: string
  email: string
  formResponsesJson: Record<string, unknown> | null
  score: number
  createdAt: string
  views: number
  sessionsCount: number
  dwellSecs: number
}

// All leads (+ engagement) for every visitor whose lead-form or IP-geo company
// matches one of the given raw company names — i.e. every name that got
// merged (by alias or fuzzy match) into one Top Accounts row.
export async function getAccountLeads(
  companyNames: string[],
  dateFromSql: string | null,
  dateToSql: string | null
): Promise<AccountLeadRow[]> {
  const { dbUser } = await getDashboardAuthContext()
  if (companyNames.length === 0) return []

  const dateFilter = dateFromSql && dateToSql
    ? sql` AND e.ts BETWEEN ${dateFromSql}::timestamp AND ${dateToSql}::timestamp`
    : dateFromSql
    ? sql` AND e.ts >= ${dateFromSql}::timestamp`
    : dateToSql
    ? sql` AND e.ts <= ${dateToSql}::timestamp`
    : sql``

  type Row = {
    visitor_id: string
    email: string
    form_responses_json: Record<string, unknown> | null
    score: number
    created_at: string
    views: number
    sessions_count: number
    dwell_secs: number
  }

  const res = await db.execute<Row>(sql`
    WITH visitor_company AS (
      SELECT
        v.id AS visitor_id,
        COALESCE(
          MAX(NULLIF(TRIM(l.form_responses_json::jsonb->>'company'), '')),
          MAX(NULLIF(s.device_json::jsonb->>'company', ''))
        ) AS company
      FROM visitors v
      LEFT JOIN sessions s ON s.visitor_id = v.id
      LEFT JOIN leads    l ON l.visitor_id = v.id
      GROUP BY v.id
    )
    SELECT
      l.visitor_id::text AS visitor_id,
      l.email,
      l.form_responses_json,
      l.score,
      l.created_at::text AS created_at,
      COUNT(CASE WHEN e.event_type = 'view' THEN 1 END)::int AS views,
      COUNT(DISTINCT s.id)::int AS sessions_count,
      (COUNT(CASE WHEN e.event_type = 'dwell_tick' THEN 1 END) * 10)::int AS dwell_secs
    FROM visitor_company vc
    JOIN leads l       ON l.visitor_id = vc.visitor_id
    JOIN sessions s    ON s.visitor_id = vc.visitor_id
    JOIN engagements e ON e.session_id = s.id ${dateFilter}
    JOIN assets a      ON a.id = e.asset_id
    WHERE a.organization_id = ${dbUser.organizationId}::uuid
      AND vc.company IN (${sql.join(companyNames.map((c) => sql`${c}`), sql`, `)})
    GROUP BY l.id, l.visitor_id, l.email, l.form_responses_json, l.score, l.created_at
    ORDER BY dwell_secs DESC
  `)

  return Array.from(res).map((r) => ({
    visitorId: r.visitor_id,
    email: r.email,
    formResponsesJson: r.form_responses_json,
    score: r.score,
    createdAt: r.created_at,
    views: r.views,
    sessionsCount: r.sessions_count,
    dwellSecs: r.dwell_secs,
  }))
}
