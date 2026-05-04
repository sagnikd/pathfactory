import { NextResponse } from 'next/server'
import { db } from '@/db'
import { leads, visitors } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { computeLeadScores } from '@/lib/leadScore'
import { processAbmLeadMatch } from '@/lib/abm'

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

    // Compute score from real engagement history up to this moment
    const scoreMap = await computeLeadScores([visitorId])
    const score    = scoreMap[visitorId]?.total ?? 0

    const [lead] = await db.insert(leads).values({
      visitorId,
      email,
      formResponsesJson: fields,
      score,
    }).returning({ id: leads.id })

    // Persist captured email on visitor record
    await db.update(visitors)
      .set({ capturedEmail: email })
      .where(eq(visitors.id, visitorId))

    await processAbmLeadMatch({
      trackId: typeof trackId === 'string' ? trackId : null,
      visitorId,
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
