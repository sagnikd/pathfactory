import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { db } from '@/db'
import { sessions } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { lookupIp } from '@/lib/ipLookup'

/**
 * POST /api/session-geo
 * Body: {
 *   sessionId: string
 *   // Optional: client-resolved geo (ipapi.co/json called from the browser).
 *   // When provided, we skip the server-side lookup entirely — this avoids
 *   // the rate-limit problem where all Netlify-origin calls share one IP quota.
 *   country?: string | null
 *   city?:    string | null
 *   company?: string | null
 * }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { sessionId, country: bodyCountry, city: bodyCity, company: bodyCompany } = body

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
      return NextResponse.json({
        ok: true, source: 'existing',
        country: existing.country, city: existing.city, company: existing.company,
      })
    }

    let country: string | null = null
    let city:    string | null = null
    let company: string | null = null
    let source = 'server-lookup'

    // Prefer client-resolved geo (visitor's own IP → no shared quota)
    if (bodyCountry || bodyCity) {
      country = bodyCountry ?? null
      city    = bodyCity    ?? null
      company = bodyCompany ?? null
      source  = 'client'
    } else {
      // Fallback: resolve from server-side request headers
      const reqHeaders = await headers()
      const rawIp =
        reqHeaders.get('x-nf-client-connection-ip') ??
        reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ??
        reqHeaders.get('x-real-ip') ??
        null

      const ipInfo = await lookupIp(rawIp)
      country = ipInfo.country
      city    = ipInfo.city
      company = ipInfo.company
    }

    if (country || city || company) {
      const merged = {
        ...existing,
        company: company ?? existing.company ?? null,
        country: country ?? existing.country ?? null,
        city:    city    ?? existing.city    ?? null,
      }
      await db.update(sessions).set({ deviceJson: merged }).where(eq(sessions.id, sessionId))
      return NextResponse.json({ ok: true, source, country, city, company })
    }

    return NextResponse.json({ ok: false, reason: 'no geo data' })
  } catch (err) {
    console.error('[session-geo]', err)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
