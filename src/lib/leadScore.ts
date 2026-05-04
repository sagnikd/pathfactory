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
import { sessions, engagements, tracks } from '@/db/schema'
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

type LeadScoringWeights = {
  uniqueAssetViewPoints: number
  dwellTickPoints: number
  deepScrollPoints: number
  videoPlayPoints: number
  videoCompletePoints: number
  returnSessionPoints: number
}

const DEFAULT_WEIGHTS: LeadScoringWeights = {
  uniqueAssetViewPoints: 5,
  dwellTickPoints: 2,
  deepScrollPoints: 3,
  videoPlayPoints: 5,
  videoCompletePoints: 10,
  returnSessionPoints: 20,
}

function asNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.floor(value))
}

function extractWeights(themeJson: unknown): LeadScoringWeights | null {
  if (!themeJson || typeof themeJson !== 'object') return null
  const scoring = (themeJson as { leadScoring?: unknown }).leadScoring
  if (!scoring || typeof scoring !== 'object') return null
  return {
    uniqueAssetViewPoints: asNonNegativeInt((scoring as Record<string, unknown>).uniqueAssetViewPoints, DEFAULT_WEIGHTS.uniqueAssetViewPoints),
    dwellTickPoints: asNonNegativeInt((scoring as Record<string, unknown>).dwellTickPoints, DEFAULT_WEIGHTS.dwellTickPoints),
    deepScrollPoints: asNonNegativeInt((scoring as Record<string, unknown>).deepScrollPoints, DEFAULT_WEIGHTS.deepScrollPoints),
    videoPlayPoints: asNonNegativeInt((scoring as Record<string, unknown>).videoPlayPoints, DEFAULT_WEIGHTS.videoPlayPoints),
    videoCompletePoints: asNonNegativeInt((scoring as Record<string, unknown>).videoCompletePoints, DEFAULT_WEIGHTS.videoCompletePoints),
    returnSessionPoints: asNonNegativeInt((scoring as Record<string, unknown>).returnSessionPoints, DEFAULT_WEIGHTS.returnSessionPoints),
  }
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

  // Resolve organization and org-level scoring config (from track.themeJson) per visitor
  const visitorSessions = await db.select({
    visitorId: sessions.visitorId,
    trackId: sessions.trackId,
  })
  .from(sessions)
  .where(inArray(sessions.visitorId, visitorIds))

  const latestTrackByVisitor: Record<string, string> = {}
  for (const row of visitorSessions) latestTrackByVisitor[row.visitorId] = row.trackId

  const uniqueTrackIds = Array.from(new Set(Object.values(latestTrackByVisitor)))
  const orgByTrackId: Record<string, string> = {}
  if (uniqueTrackIds.length > 0) {
    const trackRows = await db.select({
      id: tracks.id,
      organizationId: tracks.organizationId,
    }).from(tracks).where(inArray(tracks.id, uniqueTrackIds))
    for (const t of trackRows) orgByTrackId[t.id] = t.organizationId
  }

  const orgIds = Array.from(new Set(Object.values(orgByTrackId)))
  const weightsByOrg: Record<string, LeadScoringWeights> = {}
  for (const orgId of orgIds) {
    const orgTracks = await db.select({ themeJson: tracks.themeJson })
      .from(tracks)
      .where(eq(tracks.organizationId, orgId))
    const maybeWeights = orgTracks
      .map((t) => extractWeights(t.themeJson))
      .find((w): w is LeadScoringWeights => w !== null)
    weightsByOrg[orgId] = maybeWeights ?? DEFAULT_WEIGHTS
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
    const orgId = orgByTrackId[latestTrackByVisitor[visitorId] ?? '']
    const weights = (orgId && weightsByOrg[orgId]) ? weightsByOrg[orgId] : DEFAULT_WEIGHTS

    const breadth = new Set(
      evts.filter(e => e.eventType === 'view').map(e => e.assetId)
    ).size * weights.uniqueAssetViewPoints

    const dwell = evts.filter(e => e.eventType === 'dwell_tick').length * weights.dwellTickPoints

    const depth = evts.filter(
      e => e.eventType === 'scroll_75' || e.eventType === 'scroll_100'
    ).length * weights.deepScrollPoints

    const videoPlay   = evts.filter(e => e.eventType === 'video_play').length * weights.videoPlayPoints
    const videoFinish = evts.filter(e => e.eventType === 'video_complete').length * weights.videoCompletePoints
    const returnVisit = Math.max(0, sessions_n - 1) * weights.returnSessionPoints

    const total = breadth + dwell + depth + videoPlay + videoFinish + returnVisit

    result[visitorId] = { total, breadth, dwell, depth, videoPlay, videoFinish, returnVisit }
  }

  return result
}
