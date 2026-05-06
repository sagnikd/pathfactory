import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  abmAccountDomains,
  abmAccounts,
  abmAlerts,
  abmMatches,
  leads,
  organizations,
  tracks,
  users,
} from '@/db/schema'

type MatchResult = {
  accountId: string
  accountName: string
  source: 'email_domain' | 'reverse_ip' | 'fuzzy'
  confidence: 'high' | 'medium' | 'low'
  matchedValue: string
}

export async function isAbmSchemaReady(): Promise<boolean> {
  try {
    await db.select({ id: abmAccounts.id }).from(abmAccounts).limit(1)
    return true
  } catch {
    return ensureAbmSchema()
  }
}

let abmBootstrapAttempted = false

async function ensureAbmSchema(): Promise<boolean> {
  if (abmBootstrapAttempted) {
    try {
      await db.select({ id: abmAccounts.id }).from(abmAccounts).limit(1)
      return true
    } catch {
      return false
    }
  }
  abmBootstrapAttempted = true

  try {
    await db.execute(sql.raw(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'abm_match_source') THEN
          CREATE TYPE "abm_match_source" AS ENUM ('email_domain', 'reverse_ip', 'fuzzy');
        END IF;
      END $$;
    `))
    await db.execute(sql.raw(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'abm_confidence') THEN
          CREATE TYPE "abm_confidence" AS ENUM ('high', 'medium', 'low');
        END IF;
      END $$;
    `))
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS "abm_accounts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "organization_id" uuid NOT NULL,
        "account_name" text NOT NULL,
        "priority" text DEFAULT 'medium' NOT NULL,
        "owner_email" text,
        "notes" text,
        "status" text DEFAULT 'active' NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
      );
    `))
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS "abm_account_domains" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "abm_account_id" uuid NOT NULL,
        "domain" text NOT NULL,
        "is_primary" boolean DEFAULT false NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      );
    `))
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS "abm_matches" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "organization_id" uuid NOT NULL,
        "visitor_id" uuid NOT NULL,
        "session_id" uuid,
        "lead_id" uuid,
        "abm_account_id" uuid NOT NULL,
        "match_source" "abm_match_source" NOT NULL,
        "confidence" "abm_confidence" NOT NULL,
        "matched_value" text NOT NULL,
        "payload_json" jsonb,
        "created_at" timestamp DEFAULT now() NOT NULL
      );
    `))
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS "abm_alerts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "organization_id" uuid NOT NULL,
        "abm_account_id" uuid NOT NULL,
        "lead_id" uuid,
        "visitor_id" uuid,
        "trigger_type" text NOT NULL,
        "recipients_json" jsonb NOT NULL,
        "payload_json" jsonb,
        "sent_at" timestamp DEFAULT now() NOT NULL
      );
    `))
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS "abm_domains_domain_idx" ON "abm_account_domains" ("domain");`))
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS "abm_accounts_org_idx" ON "abm_accounts" ("organization_id");`))

    await db.select({ id: abmAccounts.id }).from(abmAccounts).limit(1)
    return true
  } catch {
    return false
  }
}

function domainFromEmail(email: string): string | null {
  const at = email.lastIndexOf('@')
  if (at <= 0 || at === email.length - 1) return null
  return email.slice(at + 1).trim().toLowerCase()
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^www\./, '')
}

function domainMatches(inputDomain: string, candidateDomain: string): boolean {
  const input = normalizeDomain(inputDomain)
  const candidate = normalizeDomain(candidateDomain)
  return input === candidate || input.endsWith(`.${candidate}`)
}

async function matchAbmByEmailDomain(orgId: string, email: string): Promise<MatchResult | null> {
  const domain = domainFromEmail(email)
  if (!domain) return null

  const rows = await db.select({
    accountId: abmAccounts.id,
    accountName: abmAccounts.accountName,
    domain: abmAccountDomains.domain,
  })
  .from(abmAccountDomains)
  .innerJoin(abmAccounts, eq(abmAccountDomains.abmAccountId, abmAccounts.id))
  .where(and(eq(abmAccounts.organizationId, orgId), eq(abmAccounts.status, 'active')))

  const found = rows.find((r) => domainMatches(domain, r.domain))
  if (!found) return null

  return {
    accountId: found.accountId,
    accountName: found.accountName,
    source: 'email_domain',
    confidence: 'high',
    matchedValue: domain,
  }
}

async function matchAbmByReverseIpDomain(orgId: string, domain: string): Promise<MatchResult | null> {
  const rows = await db.select({
    accountId: abmAccounts.id,
    accountName: abmAccounts.accountName,
    domain: abmAccountDomains.domain,
  })
  .from(abmAccountDomains)
  .innerJoin(abmAccounts, eq(abmAccountDomains.abmAccountId, abmAccounts.id))
  .where(and(eq(abmAccounts.organizationId, orgId), eq(abmAccounts.status, 'active')))

  const found = rows.find((r) => domainMatches(domain, r.domain))
  if (!found) return null
  return {
    accountId: found.accountId,
    accountName: found.accountName,
    source: 'reverse_ip',
    confidence: 'medium',
    matchedValue: normalizeDomain(domain),
  }
}

// ─── Company-name fuzzy matching helpers ────────────────────────────────────

/** Legal / corporate suffixes to strip before comparing */
const CORP_SUFFIXES = /\b(s\.?r\.?l\.?|s\.?a\.?s?\.?|s\.?p\.?a\.?|llc|llp|ltd|limited|inc|incorporated|corp|corporation|co\.?|gmbh|ag|bv|nv|pty|plc|lp|lllp|pllc|pc|pvt|sdn\s+bhd|bhd)\b\.?/gi

function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(CORP_SUFFIXES, '')       // strip legal suffixes
    .replace(/[^a-z0-9\s]/g, ' ')    // punctuation → space
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(name: string): string[] {
  // Filter very short filler tokens ('of', 'the', 'and', 'de', '&')
  return normalizeCompany(name)
    .split(' ')
    .filter(t => t.length > 1 && !['of', 'the', 'and', 'de', 'la', 'le', 'van'].includes(t))
}

/** Levenshtein distance (for single-token fallback) */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
  return dp[m][n]
}

/**
 * Returns a 0–1 similarity score between two company names.
 * Strategy:
 *  1. Strip suffixes + punctuation, tokenize.
 *  2. Token overlap: what fraction of the shorter name's tokens appear in the longer?
 *  3. Single-token fallback: Levenshtein similarity.
 */
function companyNameSimilarity(a: string, b: string): number {
  const ta = tokenize(a)
  const tb = tokenize(b)

  if (ta.length === 0 || tb.length === 0) return 0

  // Token overlap — works for "Abstract" vs "Abstract SRL", "HCL" vs "HCL Technologies"
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  const longerSet = new Set(longer)
  const matched = shorter.filter(t => longerSet.has(t)).length
  const overlapScore = matched / shorter.length

  if (overlapScore >= 0.8) return overlapScore   // strong token match → done

  // Fuzzy single-token: compare the two normalised strings directly
  // Useful for slight typos: "Abstact" vs "Abstract"
  const na = normalizeCompany(a)
  const nb = normalizeCompany(b)
  const maxLen = Math.max(na.length, nb.length)
  if (maxLen === 0) return 0
  const lev = levenshtein(na, nb)
  const levScore = 1 - lev / maxLen

  return Math.max(overlapScore, levScore)
}

/** Minimum score to treat two company names as the same */
const COMPANY_MATCH_THRESHOLD = 0.75

async function matchAbmByCompanyName(orgId: string, companyName: string): Promise<MatchResult | null> {
  const cleaned = companyName.trim()
  if (!cleaned) return null

  const rows = await db.select({
    accountId: abmAccounts.id,
    accountName: abmAccounts.accountName,
  })
  .from(abmAccounts)
  .where(and(eq(abmAccounts.organizationId, orgId), eq(abmAccounts.status, 'active')))

  let best: { row: typeof rows[0]; score: number } | null = null
  for (const row of rows) {
    const score = companyNameSimilarity(cleaned, row.accountName)
    if (score >= COMPANY_MATCH_THRESHOLD && (!best || score > best.score)) {
      best = { row, score }
    }
  }

  if (!best) return null
  return {
    accountId: best.row.accountId,
    accountName: best.row.accountName,
    source: 'fuzzy',
    confidence: best.score >= 0.95 ? 'medium' : 'low',
    matchedValue: cleaned,
  }
}

async function sendEmailAlert(params: {
  to: string[]
  subject: string
  html: string
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey || apiKey === 'your_resend_api_key_here') return false

  const from = process.env.RESEND_FROM_EMAIL &&
    process.env.RESEND_FROM_EMAIL !== 'notifications@yourdomain.com'
    ? `ABM Alerts <${process.env.RESEND_FROM_EMAIL}>`
    : 'ABM Alerts <onboarding@resend.dev>'

  // RESEND_TO_EMAIL overrides all recipients on free plan
  // (onboarding@resend.dev can only deliver to the Resend signup email)
  const to = process.env.RESEND_TO_EMAIL
    ? [process.env.RESEND_TO_EMAIL]
    : params.to

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject: params.subject, html: params.html }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error('[abm] Resend error:', res.status, body)
    }
    return res.ok
  } catch (e) {
    console.error('[abm] sendEmailAlert failed:', e)
    return false
  }
}

/** Shared helper: get org admin recipients */
async function getAdminRecipients(orgId: string): Promise<string[]> {
  const adminUsers = await db.select({ email: users.email })
    .from(users)
    .where(and(eq(users.organizationId, orgId), eq(users.role, 'admin')))
  return Array.from(new Set(adminUsers.map(u => u.email).filter(Boolean)))
}

export async function processAbmLeadMatch(input: {
  trackId: string | null
  visitorId: string
  leadId: string
  email: string
  formFields: Record<string, unknown>
}) {
  if (!input.trackId) return
  if (!(await isAbmSchemaReady())) return

  try {
    const [track] = await db.select({
      id: tracks.id,
      organizationId: tracks.organizationId,
      title: tracks.title,
      slug: tracks.slug,
    }).from(tracks).where(eq(tracks.id, input.trackId))
    if (!track) return

    const match = await matchAbmByEmailDomain(track.organizationId, input.email)
    const reverseIpDomain =
      typeof input.formFields.reverseIpDomain === 'string' ? input.formFields.reverseIpDomain : ''
    const companyName =
      typeof input.formFields.company === 'string' ? input.formFields.company : ''
    const matchResolved =
      match
      ?? (reverseIpDomain ? await matchAbmByReverseIpDomain(track.organizationId, reverseIpDomain) : null)
      ?? (companyName ? await matchAbmByCompanyName(track.organizationId, companyName) : null)
    if (!matchResolved) return

    await db.insert(abmMatches).values({
      organizationId: track.organizationId,
      visitorId: input.visitorId,
      leadId: input.leadId,
      abmAccountId: matchResolved.accountId,
      matchSource: matchResolved.source,
      confidence: matchResolved.confidence,
      matchedValue: matchResolved.matchedValue,
      payloadJson: {
        fields: input.formFields,
        trackTitle: track.title,
      },
    })

    // 6-hour dedupe window for same account + trigger.
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000)
    const recentAlert = await db.select({ id: abmAlerts.id })
      .from(abmAlerts)
      .where(and(
        eq(abmAlerts.organizationId, track.organizationId),
        eq(abmAlerts.abmAccountId, matchResolved.accountId),
        eq(abmAlerts.triggerType, 'lead_submit'),
        gte(abmAlerts.sentAt, sixHoursAgo),
      ))
      .limit(1)
    if (recentAlert.length > 0) return

    const [org] = await db.select({
      name: organizations.name,
      slug: organizations.slug,
    }).from(organizations).where(eq(organizations.id, track.organizationId))
    const recipients = await getAdminRecipients(track.organizationId)
    if (recipients.length === 0) return

    const subject = `🎯 ABM Alert: ${matchResolved.accountName} engaged with "${track.title}"`
    const dashboardUrl = process.env.NEXT_PUBLIC_APP_URL && process.env.NEXT_PUBLIC_APP_URL !== 'https://your-app.netlify.app'
      ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '')}/dashboard/abm`
      : null

    const html = buildAbmEmail({
      accountName: matchResolved.accountName,
      matchSource: matchResolved.source,
      confidence: matchResolved.confidence,
      trackTitle: track.title,
      email: input.email,
      dashboardUrl,
    })

    const sent = await sendEmailAlert({ to: recipients, subject, html })
    console.log('[abm] lead_submit alert sent:', sent, '→', recipients)

    await db.insert(abmAlerts).values({
      organizationId: track.organizationId,
      abmAccountId: matchResolved.accountId,
      leadId: input.leadId,
      visitorId: input.visitorId,
      triggerType: 'lead_submit',
      recipientsJson: recipients,
      payloadJson: {
        sent,
        email: input.email,
        trackTitle: track.title,
        accountName: matchResolved.accountName,
      },
    })
  } catch {
    // Never block lead capture because ABM tables/migrations are not ready.
  }
}

function buildAbmEmail(params: {
  accountName: string
  matchSource: string
  confidence: string
  trackTitle: string
  email?: string
  company?: string
  location?: string
  dashboardUrl: string | null
}): string {
  const { accountName, matchSource, confidence, trackTitle, email, company, location, dashboardUrl } = params
  const sourceLabel = matchSource === 'email_domain' ? 'Email domain'
    : matchSource === 'reverse_ip' ? 'Reverse IP lookup'
    : 'Company name match'

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
        <tr>
          <td style="background:#18181b;padding:24px 32px;">
            <p style="margin:0;font-size:13px;color:#a1a1aa;letter-spacing:.05em;text-transform:uppercase;font-weight:600;">ABM Intelligence</p>
            <h1 style="margin:8px 0 0;font-size:22px;color:#fff;font-weight:700;">Target Account Engaged</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 24px;font-size:15px;color:#3f3f46;line-height:1.6;">
              A visitor from one of your target ABM accounts just engaged with your content.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#fafafa;border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin-bottom:24px;">
              <tr><td style="padding:20px 24px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding:6px 0;border-bottom:1px solid #f0f0f0;">
                      <span style="font-size:12px;color:#71717a;font-weight:600;text-transform:uppercase;">Account</span>
                    </td>
                    <td style="padding:6px 0;border-bottom:1px solid #f0f0f0;text-align:right;">
                      <span style="font-size:14px;color:#18181b;font-weight:700;">${accountName}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;border-bottom:1px solid #f0f0f0;">
                      <span style="font-size:12px;color:#71717a;font-weight:600;text-transform:uppercase;">Track</span>
                    </td>
                    <td style="padding:6px 0;border-bottom:1px solid #f0f0f0;text-align:right;">
                      <span style="font-size:14px;color:#18181b;">${trackTitle}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;border-bottom:1px solid #f0f0f0;">
                      <span style="font-size:12px;color:#71717a;font-weight:600;text-transform:uppercase;">Match method</span>
                    </td>
                    <td style="padding:6px 0;border-bottom:1px solid #f0f0f0;text-align:right;">
                      <span style="font-size:14px;color:#18181b;">${sourceLabel} <span style="color:#71717a;">(${confidence})</span></span>
                    </td>
                  </tr>
                  ${email ? `<tr>
                    <td style="padding:6px 0;border-bottom:1px solid #f0f0f0;">
                      <span style="font-size:12px;color:#71717a;font-weight:600;text-transform:uppercase;">Email</span>
                    </td>
                    <td style="padding:6px 0;border-bottom:1px solid #f0f0f0;text-align:right;">
                      <span style="font-size:14px;color:#18181b;">${email}</span>
                    </td>
                  </tr>` : ''}
                  ${company ? `<tr>
                    <td style="padding:6px 0;border-bottom:1px solid #f0f0f0;">
                      <span style="font-size:12px;color:#71717a;font-weight:600;text-transform:uppercase;">Company (IP)</span>
                    </td>
                    <td style="padding:6px 0;border-bottom:1px solid #f0f0f0;text-align:right;">
                      <span style="font-size:14px;color:#18181b;">${company}</span>
                    </td>
                  </tr>` : ''}
                  ${location ? `<tr>
                    <td style="padding:6px 0;">
                      <span style="font-size:12px;color:#71717a;font-weight:600;text-transform:uppercase;">Location</span>
                    </td>
                    <td style="padding:6px 0;text-align:right;">
                      <span style="font-size:14px;color:#18181b;">${location}</span>
                    </td>
                  </tr>` : ''}
                </table>
              </td></tr>
            </table>
            ${dashboardUrl ? `
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="border-radius:8px;background:#18181b;">
                  <a href="${dashboardUrl}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#fff;text-decoration:none;">
                    View ABM Dashboard →
                  </a>
                </td>
              </tr>
            </table>` : ''}
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px 24px;border-top:1px solid #f0f0f0;">
            <p style="margin:0;font-size:12px;color:#a1a1aa;">
              Alerts fire at most once per account per 6 hours.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

/**
 * Called from /api/visitor-notify after geo is resolved.
 * Tries to match the session's reverse-IP company against ABM accounts
 * and fires an alert for anonymous visitors (no form submission needed).
 */
export async function processAbmSessionMatch(input: {
  sessionId: string
  trackId: string
  orgId: string
  company: string | null
  city: string | null
  country: string | null
  trackTitle: string
  trackSlug: string
  visitorId: string | null
}) {
  if (!input.company) return              // nothing to match on
  if (!(await isAbmSchemaReady())) return

  try {
    // Try company name fuzzy match against ABM accounts
    const match = await matchAbmByCompanyName(input.orgId, input.company)
    if (!match) return

    // 6-hour dedupe: same account + session trigger
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000)
    const recent = await db.select({ id: abmAlerts.id })
      .from(abmAlerts)
      .where(and(
        eq(abmAlerts.organizationId, input.orgId),
        eq(abmAlerts.abmAccountId, match.accountId),
        eq(abmAlerts.triggerType, 'session_visit'),
        gte(abmAlerts.sentAt, sixHoursAgo),
      ))
      .limit(1)
    if (recent.length > 0) return

    // Record the match
    await db.insert(abmMatches).values({
      organizationId: input.orgId,
      visitorId: input.visitorId ?? '',
      abmAccountId: match.accountId,
      matchSource: match.source,
      confidence: match.confidence,
      matchedValue: match.matchedValue,
      payloadJson: { company: input.company, trackTitle: input.trackTitle },
    }).onConflictDoNothing()

    const recipients = await getAdminRecipients(input.orgId)
    if (recipients.length === 0) return

    const locationParts = [input.city, input.country].filter(Boolean)
    const location = locationParts.length > 0 ? locationParts.join(', ') : undefined
    const dashboardUrl = process.env.NEXT_PUBLIC_APP_URL && process.env.NEXT_PUBLIC_APP_URL !== 'https://your-app.netlify.app'
      ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '')}/dashboard/abm`
      : null

    const subject = `🎯 ABM Alert: ${match.accountName} is viewing "${input.trackTitle}"`
    const html = buildAbmEmail({
      accountName: match.accountName,
      matchSource: match.source,
      confidence: match.confidence,
      trackTitle: input.trackTitle,
      company: input.company,
      location,
      dashboardUrl,
    })

    const sent = await sendEmailAlert({ to: recipients, subject, html })
    console.log('[abm] session_visit alert sent:', sent, '→', recipients)

    await db.insert(abmAlerts).values({
      organizationId: input.orgId,
      abmAccountId: match.accountId,
      visitorId: input.visitorId ?? undefined,
      triggerType: 'session_visit',
      recipientsJson: recipients,
      payloadJson: {
        sent,
        company: input.company,
        trackTitle: input.trackTitle,
        accountName: match.accountName,
      },
    })
  } catch (e) {
    console.error('[abm] processAbmSessionMatch error:', e)
  }
}

export async function listAbmAccounts(orgId: string) {
  if (!(await isAbmSchemaReady())) return []
  const accounts = await db.select()
    .from(abmAccounts)
    .where(eq(abmAccounts.organizationId, orgId))
    .orderBy(desc(abmAccounts.updatedAt))

  const domains = await db.select().from(abmAccountDomains)
  const domainsByAccount = domains.reduce<Record<string, string[]>>((acc, row) => {
    if (!acc[row.abmAccountId]) acc[row.abmAccountId] = []
    acc[row.abmAccountId].push(row.domain)
    return acc
  }, {})

  return accounts.map((a) => ({
    ...a,
    domains: domainsByAccount[a.id] ?? [],
  }))
}
