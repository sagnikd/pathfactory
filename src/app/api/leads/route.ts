import { NextResponse } from 'next/server'
import { db } from '@/db'
import { leads, visitors, sessions, engagements, assets } from '@/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { computeLeadScores } from '@/lib/leadScore'
import { processAbmLeadMatch } from '@/lib/abm'
import { isPersonalEmail } from '@/lib/workEmail'
import { createClient } from '@/lib/supabase/server'
import { users } from '@/db/schema'

export async function POST(req: Request) {
  try {
    const { trackId, visitorId, fields } = await req.json()
    // `fields` is a Record<string, string> e.g. { email, firstName, company, … }

    if (!fields) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    const email: string = (fields as Record<string, string>).email ?? ''
    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }
    if (isPersonalEmail(email)) {
      return NextResponse.json({ error: 'Please enter your work email address.' }, { status: 422 })
    }

    // Resolve to a real DB visitor. visitorId may be:
    //   - a DB UUID (happy path)
    //   - a fingerprintId string (first-ever visit: middleware set the cookie on the
    //     response so page.tsx couldn't read it back; client falls back to document.cookie)
    //   - null (tracking never initialised — create an anonymous visitor, link by email later)
    let resolvedVisitorId: string
    if (!visitorId) {
      // No visitorId at all: look up by capturedEmail or create fresh anonymous visitor
      const [byEmail] = await db.select({ id: visitors.id })
        .from(visitors).where(eq(visitors.capturedEmail, email)).limit(1)
      if (byEmail) {
        resolvedVisitorId = byEmail.id
      } else {
        const [created] = await db.insert(visitors).values({ fingerprintId: crypto.randomUUID(), capturedEmail: email }).returning({ id: visitors.id })
        resolvedVisitorId = created.id
      }
    } else {
      resolvedVisitorId = visitorId
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
    }

    // Compute score from real engagement history up to this moment
    const scoreMap = await computeLeadScores([resolvedVisitorId])
    const score    = scoreMap[resolvedVisitorId]?.total ?? 0

    // Dedup: if same visitor already captured with this email, update rather than insert
    const [existing] = await db.select({ id: leads.id, formResponsesJson: leads.formResponsesJson })
      .from(leads)
      .where(and(eq(leads.visitorId, resolvedVisitorId), eq(leads.email, email)))
      .limit(1)

    let lead: { id: string }
    if (existing) {
      const merged = { ...(existing.formResponsesJson as Record<string, unknown> ?? {}), ...(fields as Record<string, unknown>) }
      await db.update(leads)
        .set({ score, formResponsesJson: merged })
        .where(eq(leads.id, existing.id))
      lead = { id: existing.id }
    } else {
      const [inserted] = await db.insert(leads).values({
        visitorId: resolvedVisitorId,
        trackId: typeof trackId === 'string' ? trackId : null,
        email,
        formResponsesJson: fields,
        score,
      }).returning({ id: leads.id })
      lead = inserted
    }

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

export async function DELETE(req: Request) {
  try {
    const { leadId } = await req.json()
    if (!leadId) return NextResponse.json({ error: 'Missing leadId' }, { status: 400 })

    // Auth: resolve caller's org
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const [dbUser] = await db.select({ organizationId: users.organizationId })
      .from(users).where(eq(users.id, user.id)).limit(1)
    if (!dbUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const orgId = dbUser.organizationId

    // Verify lead belongs to caller's org via: lead → visitor → session → engagement → asset → org
    const [lead] = await db.select({ visitorId: leads.visitorId })
      .from(leads).where(eq(leads.id, leadId)).limit(1)
    if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const orgAssets = await db.select({ id: assets.id }).from(assets).where(eq(assets.organizationId, orgId))
    const orgAssetIds = orgAssets.map(a => a.id)
    if (orgAssetIds.length === 0) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const [inScope] = await db.select({ visitorId: sessions.visitorId })
      .from(sessions)
      .innerJoin(engagements, eq(sessions.id, engagements.sessionId))
      .where(and(eq(sessions.visitorId, lead.visitorId), inArray(engagements.assetId, orgAssetIds)))
      .limit(1)
    if (!inScope) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await db.delete(leads).where(eq(leads.id, leadId))

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to delete lead' }, { status: 500 })
  }
}
