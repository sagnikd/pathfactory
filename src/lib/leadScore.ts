/**
 * Real lead scoring based on engagement signals.
 *
 * Points breakdown:
 *   +5  per unique asset viewed          (breadth — how many pieces of content)
 *   +2  per dwell_tick (≈10 s on-page)   (time — raw attention)
 *   +3  per scroll_75 / scroll_100       (depth — actually read it)
 *   +5  per video_play                   (intent — chose to watch)
 *   +10 per video_complete               (completion — watched to the end)
 *   +20 per return session               (loyalty — came back)
 *
 * Score is uncapped so power users can score 100+.
 */

import { db } from '@/db'
import { sessions, engagements } from '@/db/schema'
import { inArray, eq, count } from 'drizzle-orm'

export type ScoreBreakdown = {
  total:       number
  breadth:     number   // unique assets viewed × 5
  dwell:       number   // dwell_ticks × 2
  depth:       number   // scroll_75/100 events × 3
  videoPlay:   number   // video_play × 5
  videoFinish: number   // video_complete × 10
  returnVisit: number   // (sessions − 1) × 20
}

export async function computeLeadScores(
  visitorIds: string[]
): Promise<Record<string, ScoreBreakdown>> {
  if (visitorIds.length === 0) return {}

  // Fetch all engagement events for these visitors in one query
  const events = await db
    .select({
      visitorId:  sessions.visitorId,
      eventType:  engagements.eventType,
      assetId:    engagements.assetId,
    })
    .from(sessions)
    .innerJoin(engagements, eq(sessions.id, engagements.sessionId))
    .where(inArray(sessions.visitorId, visitorIds))

  // Fetch session counts (for return-visit bonus)
  const sessionCounts = await db
    .select({ visitorId: sessions.visitorId, n: count() })
    .from(sessions)
    .where(inArray(sessions.visitorId, visitorIds))
    .groupBy(sessions.visitorId)

  const sessionCountMap: Record<string, number> = {}
  for (const row of sessionCounts) {
    sessionCountMap[row.visitorId] = Number(row.n)
  }

  // Group events by visitor
  const byVisitor: Record<string, typeof events> = {}
  for (const e of events) {
    ;(byVisitor[e.visitorId] ??= []).push(e)
  }

  const result: Record<string, ScoreBreakdown> = {}

  for (const visitorId of visitorIds) {
    const evts       = byVisitor[visitorId] ?? []
    const sessions_n = sessionCountMap[visitorId] ?? 0

    const breadth = new Set(
      evts.filter(e => e.eventType === 'view').map(e => e.assetId)
    ).size * 5

    const dwell = evts.filter(e => e.eventType === 'dwell_tick').length * 2

    const depth = evts.filter(
      e => e.eventType === 'scroll_75' || e.eventType === 'scroll_100'
    ).length * 3

    const videoPlay   = evts.filter(e => e.eventType === 'video_play').length * 5
    const videoFinish = evts.filter(e => e.eventType === 'video_complete').length * 10
    const returnVisit = Math.max(0, sessions_n - 1) * 20

    const total = breadth + dwell + depth + videoPlay + videoFinish + returnVisit

    result[visitorId] = { total, breadth, dwell, depth, videoPlay, videoFinish, returnVisit }
  }

  return result
}
