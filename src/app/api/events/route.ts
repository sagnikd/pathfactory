import { NextResponse } from 'next/server';
import { db } from '@/db';
import { engagements } from '@/db/schema';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { events } = body;

    if (!events || !Array.isArray(events)) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    if (events.length === 0) {
      return NextResponse.json({ success: true });
    }

    const values = events.map((e: any) => ({
      sessionId: e.sessionId,
      assetId: e.assetId,
      eventType: e.eventType,
      payloadJson: e.payloadJson,
      ts: new Date(e.ts),
    }));

    await db.insert(engagements).values(values);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to ingest events:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
