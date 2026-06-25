import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { db } from '@/db'
import {
  sessions, tracks, users, organizations, visitors, leads, engagements,
  chatConversations, chatMessages, assets,
} from '@/db/schema'
import { eq, and, asc, desc, sql, isNull } from 'drizzle-orm'
import { processAbmSessionMatch } from '@/lib/abm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const resend = new Resend(process.env.RESEND_API_KEY)

/**
 * POST /api/session-summary
 * Body: { sessionId }
 *
 * Fired once at the END of a visitor's session (tab close / leave) via
 * navigator.sendBeacon from TrackViewer. Aggregates everything that happened
 * in the session — dwell time, assets viewed, chat Q&A, whether they clicked
 * "Book a meeting", location — and emails the org admin a single human-readable
 * summary ("Sagnik Datta from HCL Technologies spent 4 minutes watching …").
 *
 * Idempotent: atomically claims the session by stamping sessions.ended_at, so
 * concurrent beacons (visibilitychange + pagehide) only send one email.
 */
export async function POST(req: Request) {
  const apiKey = process.env.RESEND_API_KEY
  try {
    const { sessionId } = await req.json().catch(() => ({}))
    if (!sessionId) return NextResponse.json({ ok: false, reason: 'sessionId required' })

    // ── Atomic claim: only the first request where ended_at IS NULL proceeds ──
    const claimed = await db
      .update(sessions)
      .set({ endedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.endedAt)))
      .returning({ id: sessions.id })
    if (!claimed.length) {
      return NextResponse.json({ ok: false, reason: 'session already summarized' })
    }

    // ── Session + track + org ──────────────────────────────────────────────
    const rows = await db
      .select({
        trackId: sessions.trackId,
        trackSlug: tracks.slug,
        trackTitle: tracks.title,
        orgId: tracks.organizationId,
        orgName: organizations.name,
        deviceJson: sessions.deviceJson,
        startedAt: sessions.startedAt,
        visitorId: sessions.visitorId,
      })
      .from(sessions)
      .innerJoin(tracks, eq(sessions.trackId, tracks.id))
      .innerJoin(organizations, eq(tracks.organizationId, organizations.id))
      .where(eq(sessions.id, sessionId))
      .limit(1)
    if (!rows.length) return NextResponse.json({ ok: false, reason: 'session not found' })
    const { trackId, trackSlug, trackTitle, orgId, orgName, deviceJson, startedAt, visitorId } = rows[0]

    // ── Dwell (dwell_tick ≈ 10s of active engagement) ──────────────────────
    const [dwell] = await db
      .select({ ticks: sql<number>`count(*)`.mapWith(Number) })
      .from(engagements)
      .where(and(eq(engagements.sessionId, sessionId), eq(engagements.eventType, 'dwell_tick')))
    const dwellSeconds = Number(dwell?.ticks ?? 0) * 10

    // ── Meeting CTA click? ──────────────────────────────────────────────────
    const [meetingClick] = await db
      .select({ id: engagements.id })
      .from(engagements)
      .where(and(
        eq(engagements.sessionId, sessionId),
        eq(engagements.eventType, 'click'),
        sql`${engagements.payloadJson}->>'kind' = 'meeting_cta'`,
      ))
      .limit(1)
    const clickedMeeting = Boolean(meetingClick)

    // ── Assets viewed (distinct, in view order) ─────────────────────────────
    const assetRows = await db
      .select({
        title: assets.title,
        firstView: sql<string>`min(${engagements.ts})`,
      })
      .from(engagements)
      .innerJoin(assets, eq(engagements.assetId, assets.id))
      .where(and(eq(engagements.sessionId, sessionId), eq(engagements.eventType, 'view')))
      .groupBy(assets.title)
      .orderBy(asc(sql`min(${engagements.ts})`))
    const assetTitles = assetRows.map(a => a.title)

    // ── Chat transcript for this session ────────────────────────────────────
    const [conv] = await db
      .select({ id: chatConversations.id })
      .from(chatConversations)
      .where(and(eq(chatConversations.sessionId, sessionId), eq(chatConversations.trackId, trackId)))
      .limit(1)
    let transcript: { role: string; content: string }[] = []
    if (conv) {
      transcript = await db
        .select({ role: chatMessages.role, content: chatMessages.content })
        .from(chatMessages)
        .where(eq(chatMessages.conversationId, conv.id))
        .orderBy(asc(chatMessages.createdAt))
    }
    const userQuestions = transcript.filter(m => m.role === 'user').map(m => m.content)

    // ── Only email if something meaningful happened ─────────────────────────
    const meaningful = dwellSeconds >= 30 || userQuestions.length > 0 || clickedMeeting
    if (!meaningful) {
      return NextResponse.json({ ok: false, reason: `not meaningful (dwell ${dwellSeconds}s)` })
    }

    // ── Known visitor identity (email + name + company from latest lead) ─────
    const geo = (deviceJson ?? {}) as Record<string, string | null>
    const city = geo.city ?? null
    const country = geo.country ?? null
    let knownName: string | null = null
    let knownEmail: string | null = null
    let knownCompany: string | null = null
    if (visitorId) {
      const [vis] = await db
        .select({ capturedEmail: visitors.capturedEmail })
        .from(visitors).where(eq(visitors.id, visitorId)).limit(1)
      knownEmail = vis?.capturedEmail?.trim() || null
      const [lead] = await db
        .select({ email: leads.email, formResponsesJson: leads.formResponsesJson })
        .from(leads).where(eq(leads.visitorId, visitorId)).orderBy(desc(leads.createdAt)).limit(1)
      if (lead) {
        knownEmail = knownEmail ?? (lead.email?.trim() || null)
        const f = (lead.formResponsesJson as Record<string, unknown> | null) ?? {}
        const first = typeof f.firstName === 'string' ? f.firstName.trim() : ''
        const last = typeof f.lastName === 'string' ? f.lastName.trim() : ''
        knownCompany = typeof f.company === 'string' && f.company.trim() ? f.company.trim() : null
        knownName = [first, last].filter(Boolean).join(' ') || null
      }
      if (!knownName && knownEmail) knownName = knownEmail.split('@')[0].replace(/[._-]+/g, ' ')
    }
    const company = knownCompany ?? geo.company ?? null
    const location = [city, country].filter(Boolean).join(', ') || 'Unknown location'
    const who = knownName
      ? `${knownName}${company ? ` from ${company}` : ''}`
      : company ? `Someone from ${company}` : 'A visitor'

    // ── AI-generated one-line summary of the session ────────────────────────
    const dwellPhrase = formatDwellPhrase(dwellSeconds)
    const summaryLine = await generateSummaryLine({
      who, trackTitle, dwellPhrase, assetTitles,
      userQuestions, clickedMeeting, location,
    })

    // ── Recipient / sender ───────────────────────────────────────────────────
    if (!apiKey || apiKey === 'your_resend_api_key_here') {
      return NextResponse.json({ ok: false, reason: 'RESEND_API_KEY not configured', summaryLine })
    }
    const adminRows = await db
      .select({ email: users.email }).from(users)
      .where(eq(users.organizationId, orgId)).limit(1)
    if (!adminRows.length) return NextResponse.json({ ok: false, reason: 'no admin found' })
    const adminEmail = process.env.RESEND_TO_EMAIL ?? adminRows[0].email
    const fromDomain = (process.env.RESEND_FROM_EMAIL && process.env.RESEND_FROM_EMAIL !== 'notifications@yourdomain.com')
      ? process.env.RESEND_FROM_EMAIL : 'onboarding@resend.dev'
    const dashboardUrl = process.env.NEXT_PUBLIC_APP_URL && process.env.NEXT_PUBLIC_APP_URL !== 'https://your-app.netlify.app'
      ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '')}/dashboard/chats` : null
    const visitedAt = new Date(startedAt).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    })

    const { data, error: resendError } = await resend.emails.send({
      from: `${orgName} Signals <${fromDomain}>`,
      to: adminEmail,
      subject: `📩 ${who} engaged with "${trackTitle}"`,
      html: buildEmailHtml({
        orgName, summaryLine, knownName, knownEmail, company, location,
        trackTitle, dwellPhrase, assetTitles, userQuestions, clickedMeeting,
        transcript, visitedAt, dashboardUrl,
      }),
    })
    if (resendError) {
      console.error('[session-summary] Resend error:', JSON.stringify(resendError))
      return NextResponse.json({ ok: false, resendError }, { status: 500 })
    }
    console.log('[session-summary] sent:', data?.id, '→', adminEmail)

    // ── ABM session match — fire-and-forget, preserves existing behavior ─────
    processAbmSessionMatch({
      sessionId, trackId, orgId,
      company: company ?? null, city: city ?? null, country: country ?? null,
      trackTitle, trackSlug, visitorId: visitorId ?? null,
    }).catch(e => console.error('[session-summary] ABM match error:', e))

    return NextResponse.json({ ok: true, sentTo: adminEmail, emailId: data?.id, summaryLine })
  } catch (err) {
    console.error('[session-summary]', err)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function formatDwellPhrase(secs: number): string {
  if (secs < 60) return `${secs} seconds`
  const mins = Math.round(secs / 60)
  return `${mins} minute${mins !== 1 ? 's' : ''}`
}

/** AI one-liner mirroring the pitch voice; falls back to a template on failure. */
async function generateSummaryLine(facts: {
  who: string; trackTitle: string; dwellPhrase: string; assetTitles: string[]
  userQuestions: string[]; clickedMeeting: boolean; location: string
}): Promise<string> {
  const template = buildTemplateLine(facts)
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) return template

  const model = process.env.OPENAI_CHAT_MODEL?.trim() || 'gpt-4o-mini'
  const instructions = [
    'You write a single, punchy sentence summarizing a B2B website visitor session for a sales/marketing alert email.',
    'Write in third person, past tense. Be specific and concrete. No greeting, no preamble, ONE sentence only.',
    'If they asked questions, characterize the TOPIC of the questions in a few words (e.g. "asked three questions about governance").',
    'If they clicked "Book a meeting", mention it as a strong buying signal. Mention dwell time and what they watched/read.',
    'Do not invent facts. Use only the data provided. Plain text, no markdown.',
  ].join(' ')
  const input = JSON.stringify({
    visitor: facts.who,
    track: facts.trackTitle,
    timeSpent: facts.dwellPhrase,
    assetsViewed: facts.assetTitles,
    questionsAsked: facts.userQuestions,
    clickedBookMeeting: facts.clickedMeeting,
    location: facts.location,
  })

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 12_000)
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, instructions, input, max_output_tokens: 200, store: false }),
    })
    clearTimeout(timeout)
    if (!res.ok) return template
    const json = await res.json()
    const text = extractOutputText(json).replace(/\s+/g, ' ').trim()
    return text || template
  } catch {
    return template
  }
}

function buildTemplateLine(facts: {
  who: string; trackTitle: string; dwellPhrase: string; assetTitles: string[]
  userQuestions: string[]; clickedMeeting: boolean; location: string
}): string {
  const parts: string[] = [`${facts.who} spent ${facts.dwellPhrase} on "${facts.trackTitle}"`]
  if (facts.userQuestions.length) {
    parts.push(`asked ${facts.userQuestions.length} question${facts.userQuestions.length !== 1 ? 's' : ''} of the assistant`)
  }
  if (facts.clickedMeeting) parts.push(`clicked "Book a meeting"`)
  let line = parts.length > 2
    ? `${parts[0]}, ${parts.slice(1, -1).join(', ')}, and ${parts[parts.length - 1]}`
    : parts.join(' and ')
  if (facts.location && facts.location !== 'Unknown location') line += `. Location: ${facts.location}`
  return line + '.'
}

function extractOutputText(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const d = data as Record<string, unknown>
  if (typeof d.output_text === 'string') return d.output_text
  const output = d.output
  if (!Array.isArray(output)) return ''
  const chunks: string[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const content = (item as Record<string, unknown>).content
    if (!Array.isArray(content)) continue
    for (const c of content) {
      if (c && typeof c === 'object' && typeof (c as Record<string, unknown>).text === 'string') {
        chunks.push((c as Record<string, unknown>).text as string)
      }
    }
  }
  return chunks.join('\n').trim()
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function buildEmailHtml(d: {
  orgName: string; summaryLine: string; knownName: string | null; knownEmail: string | null
  company: string | null; location: string; trackTitle: string; dwellPhrase: string
  assetTitles: string[]; userQuestions: string[]; clickedMeeting: boolean
  transcript: { role: string; content: string }[]; visitedAt: string; dashboardUrl: string | null
}): string {
  const row = (label: string, value: string) => `
    <tr>
      <td style="padding:6px 0;border-bottom:1px solid #f0f0f0;">
        <span style="font-size:12px;color:#71717a;font-weight:600;text-transform:uppercase;letter-spacing:.04em;">${label}</span>
      </td>
      <td style="padding:6px 0;border-bottom:1px solid #f0f0f0;text-align:right;">
        <span style="font-size:14px;color:#18181b;font-weight:600;">${value}</span>
      </td>
    </tr>`

  const transcriptHtml = d.transcript.length ? `
    <p style="margin:24px 0 8px;font-size:13px;color:#71717a;font-weight:700;text-transform:uppercase;letter-spacing:.04em;">Full transcript</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fafafa;border:1px solid #e4e4e7;border-radius:8px;">
      <tr><td style="padding:16px 20px;">
        ${d.transcript.map(m => `
          <div style="margin-bottom:10px;">
            <span style="display:inline-block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:${m.role === 'user' ? '#0e7490' : '#71717a'};">${m.role === 'user' ? 'Visitor' : 'Assistant'}</span>
            <p style="margin:2px 0 0;font-size:14px;color:#27272a;line-height:1.5;">${escapeHtml(m.content)}</p>
          </div>`).join('')}
      </td></tr>
    </table>` : ''

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
        <tr><td style="background:#18181b;padding:24px 32px;">
          <p style="margin:0;font-size:13px;color:#a1a1aa;letter-spacing:.05em;text-transform:uppercase;font-weight:600;">Unica Pathways</p>
          <h1 style="margin:8px 0 0;font-size:22px;color:#ffffff;font-weight:700;">Session Summary</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 24px;font-size:16px;color:#18181b;line-height:1.6;font-weight:500;">${escapeHtml(d.summaryLine)}</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#fafafa;border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin-bottom:8px;">
            <tr><td style="padding:20px 24px;"><table width="100%" cellpadding="0" cellspacing="0">
              ${d.knownName ? row('Visitor', escapeHtml(d.knownName)) : ''}
              ${d.knownEmail ? row('Email', escapeHtml(d.knownEmail)) : ''}
              ${d.company ? row('Company', escapeHtml(d.company)) : ''}
              ${row('Track', escapeHtml(d.trackTitle))}
              ${row('Time spent', escapeHtml(d.dwellPhrase))}
              ${d.assetTitles.length ? row('Assets viewed', escapeHtml(d.assetTitles.join(', '))) : ''}
              ${d.userQuestions.length ? row('Questions asked', String(d.userQuestions.length)) : ''}
              ${row('Booked meeting', d.clickedMeeting ? '✅ Yes' : 'No')}
              ${row('Location', escapeHtml(d.location))}
              ${row('Started', escapeHtml(d.visitedAt))}
            </table></td></tr>
          </table>
          ${transcriptHtml}
          ${d.dashboardUrl ? `
          <table cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr>
            <td style="border-radius:8px;background:#18181b;">
              <a href="${d.dashboardUrl}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">View in Dashboard →</a>
            </td>
          </tr></table>` : ''}
        </td></tr>
        <tr><td style="padding:16px 32px 24px;border-top:1px solid #f0f0f0;">
          <p style="margin:0;font-size:12px;color:#a1a1aa;">You're receiving this because you're an admin on ${escapeHtml(d.orgName)}.<br>One summary is sent per visitor session.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}
