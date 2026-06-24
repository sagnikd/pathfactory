import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { leads, sessions, visitors } from '@/db/schema'
import {
  buildSystemPrompt,
  fetchTrackContext,
  isTrackGated,
  type Asset,
  type TrackContext,
} from '@/lib/trackChatServer'
import { getTrackChatConfig } from '@/lib/trackChatConfig'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 30

type RateBucket = { count: number; resetAt: number }
const rateLimitMap = new Map<string, RateBucket>()

function pruneRateLimitMap(): void {
  const now = Date.now()
  for (const [key, bucket] of rateLimitMap) {
    if (bucket.resetAt <= now) rateLimitMap.delete(key)
  }
}

async function getRateLimitKey(trackId: string): Promise<string> {
  const hdrs = await headers()
  const forwarded = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ip = forwarded ?? hdrs.get('x-real-ip') ?? 'unknown'
  return `${trackId}:${ip}`
}

function checkRateLimit(key: string): boolean {
  pruneRateLimitMap()
  const now = Date.now()
  const bucket = rateLimitMap.get(key)
  if (!bucket || bucket.resetAt <= now) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return false
  }
  bucket.count += 1
  return bucket.count > RATE_LIMIT_MAX
}

// ---------------------------------------------------------------------------
// Gate check
// ---------------------------------------------------------------------------

async function hasSessionClearedGate(
  sessionId: string,
  trackId: string
): Promise<boolean> {
  const [row] = await db
    .select({
      capturedEmail: visitors.capturedEmail,
      visitorId: sessions.visitorId,
    })
    .from(sessions)
    .innerJoin(visitors, eq(sessions.visitorId, visitors.id))
    .where(and(eq(sessions.id, sessionId), eq(sessions.trackId, trackId)))
    .limit(1)

  if (!row) return false
  if (row.capturedEmail?.trim()) return true

  const [leadRow] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(eq(leads.visitorId, row.visitorId))
    .limit(1)

  return Boolean(leadRow)
}

// ---------------------------------------------------------------------------
// Suggested questions fallback
// ---------------------------------------------------------------------------

function getRecommendedQuestions(
  context: TrackContext,
  currentAssetId: string | null,
  askedQuestions: string[]
): string[] {
  const askedSet = new Set(
    askedQuestions.map((q) => q.toLowerCase().replace(/\s+/g, ' ').trim())
  )

  const candidates: string[] = []

  const currentAsset = currentAssetId
    ? context.assets.find((a) => a.id === currentAssetId) ?? null
    : null

  if (currentAsset) {
    candidates.push(`What should I take away from "${currentAsset.title}"?`)
    candidates.push(`How does "${currentAsset.title}" apply to my team?`)
  }

  const otherAssets = context.assets.filter((a) => a.id !== currentAssetId).slice(0, 3)
  for (const asset of otherAssets) {
    candidates.push(`Tell me more about "${asset.title}".`)
  }

  candidates.push(
    'Which asset should I start with?',
    'What is the fastest summary of this track?',
    'How should I evaluate this for my team?',
    'What questions should I ask before booking a meeting?'
  )

  const seen = new Set<string>()
  const result: string[] = []
  for (const q of candidates) {
    const key = q.toLowerCase().replace(/\s+/g, ' ').trim()
    if (seen.has(key) || askedSet.has(key)) continue
    seen.add(key)
    result.push(q)
    if (result.length >= 4) break
  }
  return result
}

// ---------------------------------------------------------------------------
// OpenAI Responses API call
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function extractOutputText(data: unknown): string {
  if (!isRecord(data)) return ''
  if (typeof data.output_text === 'string') return data.output_text
  const output = data.output
  if (!Array.isArray(output)) return ''
  const chunks: string[] = []
  for (const item of output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue
    for (const content of item.content) {
      if (!isRecord(content)) continue
      if (typeof content.text === 'string') chunks.push(content.text)
    }
  }
  return chunks.join('\n').trim()
}

type AssistantPayload = {
  answer: string
  suggestedQuestions: string[]
}

function parseAssistantPayload(
  rawText: string,
  context: TrackContext,
  currentAssetId: string | null,
  askedQuestions: string[]
): AssistantPayload {
  const fallbackQuestions = getRecommendedQuestions(context, currentAssetId, askedQuestions)
  try {
    const parsed = JSON.parse(rawText) as unknown
    if (!isRecord(parsed)) throw new Error('not an object')

    const answer = typeof parsed.answer === 'string'
      ? parsed.answer.replace(/\s+/g, ' ').trim().slice(0, 1400)
      : ''
    if (!answer) throw new Error('missing answer')

    const rawSuggested = Array.isArray(parsed.suggestedQuestions)
      ? (parsed.suggestedQuestions as unknown[])
          .filter((s): s is string => typeof s === 'string')
          .map((s) => s.replace(/\s+/g, ' ').trim().slice(0, 120))
          .filter(Boolean)
          .slice(0, 4)
      : []

    return {
      answer,
      suggestedQuestions: rawSuggested.length > 0 ? rawSuggested : fallbackQuestions,
    }
  } catch {
    const plain = rawText.replace(/\s+/g, ' ').trim().slice(0, 1400)
    return {
      answer: plain || 'I can help with this track — please ask a more specific question.',
      suggestedQuestions: fallbackQuestions,
    }
  }
}

async function callOpenAI(
  context: TrackContext,
  message: string,
  currentAssetId: string | null,
  askedQuestions: string[]
): Promise<AssistantPayload> {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    return {
      answer: `This track covers "${context.track.title}". ${context.assets.length > 0 ? `Start with "${context.assets[0].title}" for an overview.` : 'Browse the assets to learn more.'}`,
      suggestedQuestions: getRecommendedQuestions(context, currentAssetId, askedQuestions),
    }
  }

  const model = process.env.OPENAI_CHAT_MODEL?.trim() || 'gpt-4o-mini'
  const currentAsset: Asset | undefined = currentAssetId
    ? context.assets.find((a) => a.id === currentAssetId)
    : undefined

  const systemPrompt = buildSystemPrompt(context.track, context.assets, currentAsset)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        instructions: systemPrompt,
        input: message,
        max_output_tokens: 650,
        store: false,
        text: {
          format: { type: 'json_object' },
        },
      }),
    })

    if (!response.ok) {
      console.error('[track-chat] OpenAI error:', response.status, await response.text().catch(() => ''))
      return {
        answer: `This track covers "${context.track.title}". ${context.assets.length > 0 ? `A good starting point is "${context.assets[0].title}".` : ''}`,
        suggestedQuestions: getRecommendedQuestions(context, currentAssetId, askedQuestions),
      }
    }

    const rawText = extractOutputText(await response.json())
    return parseAssistantPayload(rawText, context, currentAssetId, askedQuestions)
  } catch (error) {
    console.error('[track-chat] OpenAI request failed:', error)
    return {
      answer: `This track covers "${context.track.title}". ${context.assets.length > 0 ? `Start with "${context.assets[0].title}" for an overview.` : 'Browse the assets to learn more.'}`,
      suggestedQuestions: getRecommendedQuestions(context, currentAssetId, askedQuestions),
    }
  } finally {
    clearTimeout(timeout)
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!isRecord(body)) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    const trackId = typeof body.trackId === 'string' ? body.trackId.trim() : ''
    if (!trackId) {
      return NextResponse.json({ error: 'trackId is required' }, { status: 400 })
    }

    const message = typeof body.message === 'string' ? body.message.replace(/\s+/g, ' ').trim().slice(0, 1600) : ''
    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 })
    }

    const currentAssetId = typeof body.currentAssetId === 'string'
      ? body.currentAssetId.trim().slice(0, 80) || null
      : null

    const sessionId = typeof body.sessionId === 'string'
      ? body.sessionId.trim().slice(0, 80) || null
      : null

    const askedQuestions: string[] = Array.isArray(body.askedQuestions)
      ? (body.askedQuestions as unknown[])
          .filter((q): q is string => typeof q === 'string')
          .map((q) => q.trim())
          .filter(Boolean)
          .slice(0, 20)
      : []

    const rateLimitKey = await getRateLimitKey(trackId)
    if (checkRateLimit(rateLimitKey)) {
      return NextResponse.json({ error: 'Too many chat requests' }, { status: 429 })
    }

    const context = await fetchTrackContext(trackId)
    if (!context) {
      return NextResponse.json({ error: 'Track not found' }, { status: 404 })
    }

    const chatConfig = getTrackChatConfig(context.track.themeJson)

    if (!chatConfig.enabled) {
      return NextResponse.json({ error: 'Chat is disabled for this track' }, { status: 403 })
    }

    if (isTrackGated(context.track.gateConfigJson)) {
      const cleared = sessionId
        ? await hasSessionClearedGate(sessionId, trackId)
        : false
      if (!cleared) {
        return NextResponse.json(
          { error: 'Track chat is locked until the gate is cleared' },
          { status: 403 }
        )
      }
    }

    const resolvedAssetId = currentAssetId && context.assets.some((a) => a.id === currentAssetId)
      ? currentAssetId
      : null

    const assistant = await callOpenAI(context, message, resolvedAssetId, askedQuestions)

    const showMeetingCta = Boolean(
      chatConfig.meetingUrl &&
      (askedQuestions.length ?? 0) >= chatConfig.meetingCtaThreshold
    )

    return NextResponse.json({
      answer: assistant.answer,
      suggestedQuestions: assistant.suggestedQuestions,
      showMeetingCta,
      meetingCta: chatConfig.meetingUrl
        ? { url: chatConfig.meetingUrl, label: chatConfig.meetingCtaLabel }
        : null,
    })
  } catch (error) {
    console.error('[track-chat]', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
