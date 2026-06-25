import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { db } from '@/db'
import { sessions, tracks, users, organizations, visitors, leads, engagements } from '@/db/schema'
import { eq, desc, and, count } from 'drizzle-orm'
import { processAbmSessionMatch } from '@/lib/abm'

const resend = new Resend(process.env.RESEND_API_KEY)

/**
 * POST /api/visitor-notify
 * Body: { sessionId: string }
 *
 * Looks up the session → track → org → admin email, then sends a
 * "visitor is browsing your track" notification via Resend.
 * Fire-and-forget from TrackViewer — failures are silent to the visitor.
 */
export async function POST(req: Request) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey || apiKey === 'your_resend_api_key_here') {
    return NextResponse.json({ ok: false, reason: 'RESEND_API_KEY not configured' })
  }

  try {
    const { sessionId } = await req.json()
    if (!sessionId) return NextResponse.json({ ok: false, reason: 'sessionId required' })

    // Fetch session + track + org in one join
    const rows = await db
      .select({
        trackId:    sessions.trackId,
        trackSlug:  tracks.slug,
        trackTitle: tracks.title,
        orgId:      tracks.organizationId,
        orgName:    organizations.name,
        deviceJson: sessions.deviceJson,
        startedAt:  sessions.startedAt,
        visitorId:  sessions.visitorId,
      })
      .from(sessions)
      .innerJoin(tracks,        eq(sessions.trackId,       tracks.id))
      .innerJoin(organizations, eq(tracks.organizationId,  organizations.id))
      .where(eq(sessions.id, sessionId))
      .limit(1)

    if (!rows.length) return NextResponse.json({ ok: false, reason: 'session not found' })
    const { trackId, trackSlug, trackTitle, orgId, orgName, deviceJson, startedAt, visitorId } = rows[0]

    // Only notify once the visitor has actually dwelled >= 60s on this session.
    // Dwell ticks fire ~every 10s of active engagement, so require >= 6 ticks.
    const [dwell] = await db
      .select({ ticks: count() })
      .from(engagements)
      .where(and(eq(engagements.sessionId, sessionId), eq(engagements.eventType, 'dwell_tick')))
    const dwellSeconds = Number(dwell?.ticks ?? 0) * 10
    if (dwellSeconds < 60) {
      return NextResponse.json({ ok: false, reason: `insufficient dwell (${dwellSeconds}s)` })
    }

    // Find the org admin email
    const adminRows = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.organizationId, orgId))
      .limit(1)

    if (!adminRows.length) return NextResponse.json({ ok: false, reason: 'no admin found' })
    // RESEND_TO_EMAIL lets you override the recipient during testing — required
    // when using onboarding@resend.dev (Resend free plan only delivers to the
    // email address you signed up with).
    const adminEmail = process.env.RESEND_TO_EMAIL ?? adminRows[0].email

    const geo = (deviceJson ?? {}) as Record<string, string | null>
    const city     = geo.city    ?? null
    const country  = geo.country ?? null

    // Resolve known-visitor identity (captured email + lead name/company).
    // A submitted form makes the visitor "known" — prefer that over IP geo.
    let knownName: string | null = null
    let knownEmail: string | null = null
    let knownCompany: string | null = null
    if (visitorId) {
      const [vis] = await db
        .select({ capturedEmail: visitors.capturedEmail })
        .from(visitors)
        .where(eq(visitors.id, visitorId))
        .limit(1)
      knownEmail = vis?.capturedEmail?.trim() || null

      const [lead] = await db
        .select({ email: leads.email, formResponsesJson: leads.formResponsesJson })
        .from(leads)
        .where(eq(leads.visitorId, visitorId))
        .orderBy(desc(leads.createdAt))
        .limit(1)
      if (lead) {
        knownEmail = knownEmail ?? (lead.email?.trim() || null)
        const f = (lead.formResponsesJson as Record<string, unknown> | null) ?? {}
        const first = typeof f.firstName === 'string' ? f.firstName.trim() : ''
        const last = typeof f.lastName === 'string' ? f.lastName.trim() : ''
        knownCompany = typeof f.company === 'string' && f.company.trim() ? f.company.trim() : null
        knownName = [first, last].filter(Boolean).join(' ') || null
      }
      if (!knownName && knownEmail) {
        knownName = knownEmail.split('@')[0].replace(/[._-]+/g, ' ')
      }
    }

    // Prefer the lead's company over IP-derived org name
    const company = knownCompany ?? geo.company ?? null

    const locationParts = [city, country].filter(Boolean)
    const location = locationParts.length > 0 ? locationParts.join(', ') : 'Unknown location'

    // Headline label: known visitor name+company, else company/location
    const visitorLabel = knownName
      ? `${knownName}${company ? ` from ${company}` : ''}`
      : company
        ? `${company} (${location})`
        : location
    const visitedAt = new Date(startedAt).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    })

    // Use verified custom domain if configured, otherwise fall back to Resend's
    // shared sender (works on free plan without DNS verification).
    const fromDomain = (
      process.env.RESEND_FROM_EMAIL &&
      process.env.RESEND_FROM_EMAIL !== 'notifications@yourdomain.com'
    )
      ? process.env.RESEND_FROM_EMAIL
      : 'onboarding@resend.dev'

    const dashboardUrl = process.env.NEXT_PUBLIC_APP_URL &&
      process.env.NEXT_PUBLIC_APP_URL !== 'https://your-app.netlify.app'
      ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '')}/dashboard/leads`
      : null

    const { data, error: resendError } = await resend.emails.send({
      from: `${orgName} Alerts <${fromDomain}>`,
      to:   adminEmail,
      subject: knownName
        ? `👀 ${visitorLabel} is viewing "${trackTitle}"`
        : `👀 Someone from ${company ?? location} is viewing "${trackTitle}"`,
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">

        <!-- Header -->
        <tr>
          <td style="background:#18181b;padding:24px 32px;">
            <p style="margin:0;font-size:13px;color:#a1a1aa;letter-spacing:.05em;text-transform:uppercase;font-weight:600;">Content Engagement Platform</p>
            <h1 style="margin:8px 0 0;font-size:22px;color:#ffffff;font-weight:700;">New Visitor Alert</h1>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 24px;font-size:15px;color:#3f3f46;line-height:1.6;">
              ${knownName
                ? `<strong>${escapeHtml(knownName)}</strong>${company ? ` from <strong>${escapeHtml(company)}</strong>` : ''} is actively browsing one of your content tracks right now.`
                : 'Someone is actively browsing one of your content tracks right now.'}
            </p>

            <!-- Detail card -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#fafafa;border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin-bottom:24px;">
              <tr>
                <td style="padding:20px 24px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    ${knownName ? `
                    <tr>
                      <td style="padding:6px 0;border-bottom:1px solid #f0f0f0;">
                        <span style="font-size:12px;color:#71717a;font-weight:600;text-transform:uppercase;letter-spacing:.04em;">Visitor</span>
                      </td>
                      <td style="padding:6px 0;border-bottom:1px solid #f0f0f0;text-align:right;">
                        <span style="font-size:14px;color:#18181b;font-weight:600;">${escapeHtml(knownName)}</span>
                      </td>
                    </tr>` : ''}
                    ${knownEmail ? `
                    <tr>
                      <td style="padding:6px 0;border-bottom:1px solid #f0f0f0;">
                        <span style="font-size:12px;color:#71717a;font-weight:600;text-transform:uppercase;letter-spacing:.04em;">Email</span>
                      </td>
                      <td style="padding:6px 0;border-bottom:1px solid #f0f0f0;text-align:right;">
                        <span style="font-size:14px;color:#18181b;">${escapeHtml(knownEmail)}</span>
                      </td>
                    </tr>` : ''}
                    <tr>
                      <td style="padding:6px 0;border-bottom:1px solid #f0f0f0;">
                        <span style="font-size:12px;color:#71717a;font-weight:600;text-transform:uppercase;letter-spacing:.04em;">Track</span>
                      </td>
                      <td style="padding:6px 0;border-bottom:1px solid #f0f0f0;text-align:right;">
                        <span style="font-size:14px;color:#18181b;font-weight:600;">${escapeHtml(trackTitle)}</span>
                      </td>
                    </tr>
                    ${company ? `
                    <tr>
                      <td style="padding:6px 0;border-bottom:1px solid #f0f0f0;">
                        <span style="font-size:12px;color:#71717a;font-weight:600;text-transform:uppercase;letter-spacing:.04em;">Company</span>
                      </td>
                      <td style="padding:6px 0;border-bottom:1px solid #f0f0f0;text-align:right;">
                        <span style="font-size:14px;color:#18181b;font-weight:600;">${escapeHtml(company)}</span>
                      </td>
                    </tr>` : ''}
                    <tr>
                      <td style="padding:6px 0;border-bottom:1px solid #f0f0f0;">
                        <span style="font-size:12px;color:#71717a;font-weight:600;text-transform:uppercase;letter-spacing:.04em;">Location</span>
                      </td>
                      <td style="padding:6px 0;border-bottom:1px solid #f0f0f0;text-align:right;">
                        <span style="font-size:14px;color:#18181b;">${escapeHtml(location)}</span>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;">
                        <span style="font-size:12px;color:#71717a;font-weight:600;text-transform:uppercase;letter-spacing:.04em;">Time</span>
                      </td>
                      <td style="padding:6px 0;text-align:right;">
                        <span style="font-size:14px;color:#18181b;">${escapeHtml(visitedAt)}</span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- CTA -->
            ${dashboardUrl ? `
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="border-radius:8px;background:#18181b;">
                  <a href="${dashboardUrl}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:.01em;">
                    View in Dashboard →
                  </a>
                </td>
              </tr>
            </table>` : ''}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:16px 32px 24px;border-top:1px solid #f0f0f0;">
            <p style="margin:0;font-size:12px;color:#a1a1aa;">
              You're receiving this because you're an admin on ${escapeHtml(orgName)}.<br>
              These alerts fire once per visitor session.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`,
    })

    if (resendError) {
      console.error('[visitor-notify] Resend error:', JSON.stringify(resendError))
      return NextResponse.json({ ok: false, resendError }, { status: 500 })
    }

    console.log('[visitor-notify] Email sent:', data?.id, '→', adminEmail)

    // ABM session match — fire-and-forget, never blocks the response
    processAbmSessionMatch({
      sessionId,
      trackId,
      orgId,
      company:    company ?? null,
      city:       city    ?? null,
      country:    country ?? null,
      trackTitle,
      trackSlug,
      visitorId:  visitorId ?? null,
    }).catch(e => console.error('[visitor-notify] ABM session match error:', e))

    return NextResponse.json({ ok: true, sentTo: adminEmail, emailId: data?.id, visitor: visitorLabel })
  } catch (err) {
    console.error('[visitor-notify]', err)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
