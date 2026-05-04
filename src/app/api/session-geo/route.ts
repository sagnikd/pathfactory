import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { db } from '@/db'
import { sessions } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { lookupIp } from '@/lib/ipLookup'

/**
 * POST /api/session-geo
 * Body: { sessionId: string }
 *
 * Called client-side on track load. Resolves the visitor's real IP
 * (using Netlify / proxy headers) and back-fills the session's deviceJson
 * with country/city/company if they are currently missing.
 *
 * This is a graceful fallback for cases where the server-side lookup in
 * the track page failed (e.g. ipapi.co rate-limit, cold-start, etc.).
 */
export async function POST(req: Request) {
  try {
    const { sessionId } = await req.json()
    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
    }

    // Fetch the existing session
    const rows = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)
    if (!rows.length) return NextResponse.json({ ok: false, reason: 'not found' })

    const session = rows[0]
    const existing = (session.deviceJson ?? {}) as Record<string, string | null>

    // Already have geo — nothing to do
    if (existing.country || existing.city) {
      return NextResponse.json({ ok: true, source: 'existing', country: existing.country, city: existing.city })
    }

    // Extract real client IP from headers (Netlify first, then standard proxies)
    const reqHeaders = await headers()
    const rawIp =
      reqHeaders.get('x-nf-client-connection-ip') ??         // Netlify edge
      reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      reqHeaders.get('x-real-ip') ??
      null

    const ipInfo = await lookupIp(rawIp)

    // Only update if we got something useful
    if (ipInfo.country || ipInfo.city || ipInfo.company) {
      const merged = {
        ...existing,
        ip:      ipInfo.ip      ?? existing.ip      ?? null,
        company: ipInfo.company ?? existing.company ?? null,
        country: ipInfo.country ?? existing.country ?? null,
        city:    ipInfo.city    ?? existing.city    ?? null,
      }
      await db.update(sessions).set({ deviceJson: merged }).where(eq(sessions.id, sessionId))
      return NextResponse.json({ ok: true, source: 'lookup', country: ipInfo.country, city: ipInfo.city })
    }

    return NextResponse.json({ ok: false, reason: 'no geo data', ip: rawIp })
  } catch (err) {
    console.error('[session-geo]', err)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
