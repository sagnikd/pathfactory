import { NextResponse } from 'next/server'
import { db } from '@/db'
import { leads, visitors } from '@/db/schema'
import { eq } from 'drizzle-orm'

export async function POST(req: Request) {
  try {
    const { trackId, visitorId, email } = await req.json()

    if (!visitorId || !email) {
      return NextResponse.json({ error: 'Missing visitorId or email' }, { status: 400 })
    }

    await db.insert(leads).values({
      visitorId,
      email,
      formResponsesJson: { email },
      score: 10
    })

    // Update visitor with captured email
    await db.update(visitors)
      .set({ capturedEmail: email })
      .where(eq(visitors.id, visitorId))

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to capture lead' }, { status: 500 })
  }
}
