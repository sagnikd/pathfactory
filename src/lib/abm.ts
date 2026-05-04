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

async function matchAbmByCompanyName(orgId: string, companyName: string): Promise<MatchResult | null> {
  const normalized = companyName.trim().toLowerCase()
  if (!normalized) return null
  const rows = await db.select({
    accountId: abmAccounts.id,
    accountName: abmAccounts.accountName,
  })
  .from(abmAccounts)
  .where(and(eq(abmAccounts.organizationId, orgId), eq(abmAccounts.status, 'active')))

  const found = rows.find((r) => {
    const n = r.accountName.trim().toLowerCase()
    return n.includes(normalized) || normalized.includes(n)
  })
  if (!found) return null
  return {
    accountId: found.accountId,
    accountName: found.accountName,
    source: 'fuzzy',
    confidence: 'low',
    matchedValue: companyName.trim(),
  }
}

async function sendEmailAlert(params: {
  to: string[]
  subject: string
  html: string
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from = process.env.ABM_ALERT_FROM?.trim() || 'ABM Alerts <onboarding@resend.dev>'
  if (!apiKey) return false

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: params.to,
        subject: params.subject,
        html: params.html,
      }),
    })
    return res.ok
  } catch {
    return false
  }
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
    const adminUsers = await db.select({ email: users.email })
      .from(users)
      .where(and(eq(users.organizationId, track.organizationId), eq(users.role, 'admin')))
    const recipients = Array.from(new Set(adminUsers.map((u) => u.email).filter(Boolean)))
    if (recipients.length === 0) return

    const subject = `ABM Alert: ${matchResolved.accountName} engaged with ${track.title}`
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || ''
    const trackUrl = baseUrl ? `${baseUrl}/t/${org?.slug ?? ''}/${track.slug}` : ''

    const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5">
      <h2 style="margin:0 0 12px">ABM Account Activity Detected</h2>
      <p><strong>Account:</strong> ${matchResolved.accountName}</p>
      <p><strong>Matched by:</strong> ${matchResolved.source} (${matchResolved.confidence})</p>
      <p><strong>Email:</strong> ${input.email}</p>
      <p><strong>Organization:</strong> ${org?.name ?? 'Unknown'}</p>
      <p><strong>Track:</strong> ${track.title}</p>
      ${trackUrl ? `<p><a href="${trackUrl}">Open track</a></p>` : ''}
      <p style="color:#666;font-size:12px">Sent by Content Engagement Platform ABM Intelligence</p>
    </div>
    `

    const sent = await sendEmailAlert({ to: recipients, subject, html })

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
