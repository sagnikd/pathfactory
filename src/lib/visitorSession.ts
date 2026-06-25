import { cookies, headers } from 'next/headers'
import { db } from '@/db'
import { visitors, sessions } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { lookupIp } from '@/lib/ipLookup'

/**
 * Ensure a visitor + session exist for the given track (or experience track),
 * keyed on the `visitorId` cookie set by middleware. Best-effort: returns
 * { sessionId: null, visitorId: null } if anything fails so the page still renders.
 *
 * Used by both the track viewer (/t) and the experience viewer (/e) so chat
 * conversations on either surface link to a visitor and any captured contact.
 */
export async function ensureVisitorSession(
  trackId: string
): Promise<{ sessionId: string | null; visitorId: string | null }> {
  try {
    const cookieStore = await cookies()
    const visitorIdCookie = cookieStore.get('visitorId')?.value
    if (!visitorIdCookie) return { sessionId: null, visitorId: null }

    // Find or create the visitor
    const [existing] = await db
      .select({ id: visitors.id })
      .from(visitors)
      .where(eq(visitors.fingerprintId, visitorIdCookie))
      .limit(1)

    let visitorId = existing?.id ?? null
    if (!visitorId) {
      const [created] = await db
        .insert(visitors)
        .values({ fingerprintId: visitorIdCookie })
        .returning({ id: visitors.id })
      if (!created) {
        const [refetch] = await db
          .select({ id: visitors.id })
          .from(visitors)
          .where(eq(visitors.fingerprintId, visitorIdCookie))
          .limit(1)
        visitorId = refetch?.id ?? null
      } else {
        visitorId = created.id
      }
    }
    if (!visitorId) return { sessionId: null, visitorId: null }

    // Resolve IP → company (best-effort), then open a session
    const reqHeaders = await headers()
    const rawIp =
      reqHeaders.get('x-nf-client-connection-ip') ??
      reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      reqHeaders.get('x-real-ip') ??
      null
    const ipInfo = await lookupIp(rawIp)

    const [session] = await db
      .insert(sessions)
      .values({
        visitorId,
        trackId,
        deviceJson: {
          ip: ipInfo.ip,
          company: ipInfo.company,
          country: ipInfo.country,
          city: ipInfo.city,
        },
      })
      .returning({ id: sessions.id })

    return { sessionId: session?.id ?? null, visitorId }
  } catch (err) {
    console.error('[visitor-session] setup failed:', err)
    return { sessionId: null, visitorId: null }
  }
}
