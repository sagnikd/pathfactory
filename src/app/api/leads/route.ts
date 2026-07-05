import { NextResponse } from 'next/server'
import { db } from '@/db'
import { leads, visitors } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { computeLeadScores } from '@/lib/leadScore'
import { processAbmLeadMatch } from '@/lib/abm'
import { isPersonalEmail } from '@/lib/workEmail'

export async function POST(req: Request) {
  try {
    const { trackId, visitorId, fields } = await req.json()
    // `fields` is a Record<string, string> e.g. { email, firstName, company, … }

    if (!visitorId || !fields) {
      return NextResponse.json({ error: 'Missing visitorId or fields' }, { status: 400 })
    }

    const email: string = (fields as Record<string, string>).email ?? ''
    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }
    if (isPersonalEmail(email)) {
      return NextResponse.json({ error: 'Please enter your work email address.' }, { status: 422 })
    }

    // visitorId may be a DB UUID (normal) or a fingerprintId cookie value
    // (first-ever visit: middleware set the cookie on the response so page.tsx
    // couldn't read it back; the client falls back to document.cookie which
    // holds the fingerprint string). Resolve to a real DB visitor either way.
    let resolvedVisitorId: string = visitorId
    const [byId] = await db.select({ id: visitors.id })
      .from(visitors).where(eq(visitors.id, visitorId)).limit(1)
    if (!byId) {
      const [byFingerprint] = await db.select({ id: visitors.id })
        .from(visitors).where(eq(visitors.fingerprintId, visitorId)).limit(1)
      if (byFingerprint) {
        resolvedVisitorId = byFingerprint.id
      } else {
        const [created] = await db.insert(visitors).values({ fingerprintId: visitorId }).returning({ id: visitors.id })
        resolvedVisitorId = created.id
      }
    }

    // Compute score from real engagement history up to this moment
    const scoreMap = await computeLeadScores([resolvedVisitorId])
    const score    = scoreMap[resolvedVisitorId]?.total ?? 0

    const [lead] = await db.insert(leads).values({
      visitorId: resolvedVisitorId,
      email,
      formResponsesJson: fields,
      score,
    }).returning({ id: leads.id })

    // Persist captured email on visitor record
    await db.update(visitors)
      .set({ capturedEmail: email })
      .where(eq(visitors.id, resolvedVisitorId))

    await processAbmLeadMatch({
      trackId: typeof trackId === 'string' ? trackId : null,
      visitorId: resolvedVisitorId,
      leadId: lead.id,
      email,
      formFields: (fields as Record<string, unknown>) ?? {},
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to capture lead' }, { status: 500 })
  }
}
