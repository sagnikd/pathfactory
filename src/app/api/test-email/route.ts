import { NextResponse } from 'next/server'

/**
 * GET /api/test-email
 * Super-admin-only diagnostic: tries to send a test email and returns
 * the full Resend response so we can see exactly what's failing.
 * Remove or protect this endpoint after debugging.
 */
export async function GET() {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const resendTo    = process.env.RESEND_TO_EMAIL?.trim()
  const resendFrom  = process.env.RESEND_FROM_EMAIL?.trim()

  const config = {
    RESEND_API_KEY:    apiKey   ? `set (${apiKey.slice(0, 8)}…)` : 'NOT SET',
    RESEND_TO_EMAIL:   resendTo   ?? 'NOT SET',
    RESEND_FROM_EMAIL: resendFrom ?? 'NOT SET',
  }

  if (!apiKey) {
    return NextResponse.json({ ok: false, reason: 'RESEND_API_KEY not set', config })
  }

  const from = resendFrom && resendFrom !== 'notifications@yourdomain.com'
    ? `Test <${resendFrom}>`
    : 'Test <onboarding@resend.dev>'

  const to = resendTo ? [resendTo] : []
  if (to.length === 0) {
    return NextResponse.json({ ok: false, reason: 'RESEND_TO_EMAIL not set — no recipient', config })
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to,
        subject: 'Test email from Content Engagement Platform',
        html: '<p>This is a test email. If you see this, Resend is configured correctly.</p>',
      }),
    })

    const body = await res.json().catch(() => null)
    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      resendResponse: body,
      config,
    })
  } catch (e: unknown) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      config,
    })
  }
}
