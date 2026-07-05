import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { chatConversations, chatMessages, leads, sessions, visitors } from '@/db/schema'
import {
  buildSystemPrompt,
  fetchTrackContext,
  isTrackGated,
  type Asset,
  type TrackContext,
} from '@/lib/trackChatServer'
import { getTrackChatConfig } from '@/lib/trackChatConfig'
import { computeLeadScores } from '@/lib/leadScore'
import { processAbmLeadMatch } from '@/lib/abm'

type ChatTurn = { role: 'user' | 'assistant'; content: string }

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

// Clean markdown to readable plain text: drop bold/italics/headings, normalize
// list bullets to "• " on their own lines, and preserve line breaks (the UI
// renders them with white-space: pre-wrap).
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    // Normalize bullet / numbered list markers to a clean "• " bullet
    .replace(/^\s*[-*•]\s+/gm, '• ')
    .replace(/^\s*\d+\.\s+/gm, '• ')
    // Collapse 3+ blank lines, trim trailing spaces per line
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Enforce brevity: drop trailing "want me to…/I can also…" offers, cap to 3 bullets
function tightenAnswer(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let bullets = 0
  for (const line of lines) {
    const t = line.trim()
    // Strip self-promotion / follow-up offer lines
    if (/^(if you want|i can also|want me to|would you like|let me know)/i.test(t)) continue
    if (/^•\s/.test(t)) {
      bullets++
      if (bullets > 3) continue
      out.push(line)
    } else {
      out.push(line)
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
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

    // Collapse spaces/tabs only — keep newlines so bullet-point formatting survives.
    const answer = typeof parsed.answer === 'string'
      ? parsed.answer.replace(/[ \t]+/g, ' ').trim().slice(0, 1400)
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
    // Model sometimes wraps JSON in a markdown code fence despite instructions —
    // strip the fence and retry once before falling back to plain text.
    const fenced = rawText.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
    if (fenced) {
      try {
        return parseAssistantPayload(fenced[1], context, currentAssetId, askedQuestions)
      } catch {
        // fall through to plain-text handling below
      }
    }
    const plain = rawText.replace(/[ \t]+/g, ' ').trim().slice(0, 1400)
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
  askedQuestions: string[],
  history: ChatTurn[],
  customSystemPrompt: string | undefined,
  meetingConfigured: boolean
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

  const systemPrompt = await buildSystemPrompt(context.track, context.assets, currentAsset, customSystemPrompt, meetingConfigured)

  // Multi-turn: the model needs prior turns to track conversation state
  // (e.g. which qualification step it's on) — a single message has no memory.
  const input = [
    ...history.map((turn) => ({ role: turn.role, content: turn.content })),
    { role: 'user' as const, content: message },
  ]

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
        input,
        max_output_tokens: 700,
        store: false,
      }),
    })

    if (!response.ok) {
      const errBody = await response.text().catch(() => '')
      console.error('[track-chat] OpenAI error:', response.status, errBody)
      return {
        answer: `This track covers "${context.track.title}". ${context.assets.length > 0 ? `A good starting point is "${context.assets[0].title}".` : ''}`,
        suggestedQuestions: getRecommendedQuestions(context, currentAssetId, askedQuestions),
      }
    }

    const rawText = extractOutputText(await response.json())
    const parsed = parseAssistantPayload(rawText, context, currentAssetId, askedQuestions)
    // Clean markdown, keep line breaks; cap generously so answers aren't cut mid-thought
    const answer = tightenAnswer(stripMarkdown(parsed.answer)).slice(0, 1600) ||
      'I can help — please ask a more specific question about this track.'
    return {
      answer,
      suggestedQuestions: parsed.suggestedQuestions,
    }
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
// Chat inbox persistence
// ---------------------------------------------------------------------------

async function persistChatTurn(
  trackId: string,
  sessionId: string | null,
  userMessage: string,
  assistantAnswer: string
): Promise<void> {
  // Resolve visitor + captured contact (email + name) from the session
  let visitorId: string | null = null
  let contactEmail: string | null = null
  let contactName: string | null = null
  if (sessionId) {
    const [row] = await db
      .select({ visitorId: sessions.visitorId, capturedEmail: visitors.capturedEmail })
      .from(sessions)
      .innerJoin(visitors, eq(sessions.visitorId, visitors.id))
      .where(eq(sessions.id, sessionId))
      .limit(1)
    if (row) {
      visitorId = row.visitorId
      contactEmail = row.capturedEmail?.trim() || null

      // Pull the latest lead for a human-readable name + company
      const [lead] = await db
        .select({ email: leads.email, formResponsesJson: leads.formResponsesJson })
        .from(leads)
        .where(eq(leads.visitorId, row.visitorId))
        .orderBy(desc(leads.createdAt))
        .limit(1)
      if (lead) {
        contactEmail = contactEmail ?? (lead.email?.trim() || null)
        const f = (lead.formResponsesJson as Record<string, unknown> | null) ?? {}
        const first = typeof f.firstName === 'string' ? f.firstName.trim() : ''
        const last = typeof f.lastName === 'string' ? f.lastName.trim() : ''
        const company = typeof f.company === 'string' ? f.company.trim() : ''
        const fullName = [first, last].filter(Boolean).join(' ')
        contactName =
          (fullName && company ? `${fullName} (${company})` : fullName || company) ||
          (contactEmail ? contactEmail.split('@')[0].replace(/[._-]+/g, ' ') : null)
      } else if (contactEmail) {
        contactName = contactEmail.split('@')[0].replace(/[._-]+/g, ' ')
      }
    }
  }

  // Find an existing conversation for this session+track, else create one
  let conversationId: string | null = null
  if (sessionId) {
    const [existing] = await db
      .select({ id: chatConversations.id })
      .from(chatConversations)
      .where(and(eq(chatConversations.sessionId, sessionId), eq(chatConversations.trackId, trackId)))
      .limit(1)
    conversationId = existing?.id ?? null
  }

  if (!conversationId) {
    const [created] = await db
      .insert(chatConversations)
      .values({ trackId, sessionId, visitorId, contactEmail, contactName })
      .returning({ id: chatConversations.id })
    conversationId = created.id
  }

  await db.insert(chatMessages).values([
    { conversationId, role: 'user', content: userMessage },
    { conversationId, role: 'assistant', content: assistantAnswer },
  ])

  await db
    .update(chatConversations)
    .set({
      messageCount: sql`${chatConversations.messageCount} + 2`,
      lastMessageAt: new Date(),
      ...(contactEmail ? { contactEmail } : {}),
      ...(contactName ? { contactName } : {}),
    })
    .where(eq(chatConversations.id, conversationId))
}

// ---------------------------------------------------------------------------
// Soft lead capture from chat — the visitor gives an email/name conversationally
// (per the "soft email capture" flow in a custom system prompt) instead of
// filling a form. Best-effort: never blocks the chat reply on failure.
// ---------------------------------------------------------------------------

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
const PHONE_RE = /\+?\d[\d\s().-]{6,18}\d/
const PLAUSIBLE_NAME_RE = /^[a-zA-Z][a-zA-Z' -]{0,39}$/
const SALES_INTENT_RE = /\b(talk|speak|chat|connect)\s+(to|with)\s+(sales|someone|a\s+human|a\s+rep|an?\s+agent)\b|\bbook\s+a\s+(meeting|call|demo)\b|\bschedule\s+a\s+(call|meeting|demo)\b|\bcontact\s+sales\b/i

function extractPhone(message: string): string | null {
  const match = message.match(PHONE_RE)
  if (!match) return null
  const digits = match[0].replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) return null
  return match[0].trim()
}

async function captureEmailFromMessage(
  trackId: string,
  sessionId: string,
  message: string
): Promise<void> {
  const match = message.match(EMAIL_RE)
  if (!match) return
  const email = match[0].toLowerCase()
  // Visitor may give email and phone in the same message (e.g. when no
  // meeting URL is configured and both are requested at once).
  const phone = extractPhone(message)

  const [row] = await db
    .select({ visitorId: sessions.visitorId, capturedEmail: visitors.capturedEmail })
    .from(sessions)
    .innerJoin(visitors, eq(sessions.visitorId, visitors.id))
    .where(eq(sessions.id, sessionId))
    .limit(1)
  if (!row) return
  // Already captured for this visitor — avoid inserting a duplicate lead on every mention
  if (row.capturedEmail?.trim()) return

  await db.update(visitors).set({ capturedEmail: email }).where(eq(visitors.id, row.visitorId))

  const scoreMap = await computeLeadScores([row.visitorId])
  const score = scoreMap[row.visitorId]?.total ?? 0

  const formFields = phone ? { email, phone, source: 'chat' } : { email, source: 'chat' }
  const [lead] = await db.insert(leads).values({
    visitorId: row.visitorId,
    email,
    formResponsesJson: formFields,
    score,
  }).returning({ id: leads.id })

  await processAbmLeadMatch({
    trackId,
    visitorId: row.visitorId,
    leadId: lead.id,
    email,
    formFields,
  }).catch(() => {})
}

// Phone given in a separate message from email (e.g. "email@x.com" then,
// next turn, "555-123-4567") — attach it to the most recent lead for this
// visitor. Requires a lead to already exist; a phone number alone with no
// email isn't enough to create one.
async function capturePhoneFromMessage(
  sessionId: string,
  message: string
): Promise<void> {
  const phone = extractPhone(message)
  if (!phone) return

  const [row] = await db
    .select({ visitorId: sessions.visitorId })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1)
  if (!row) return

  const [lead] = await db
    .select({ id: leads.id, formResponsesJson: leads.formResponsesJson })
    .from(leads)
    .where(eq(leads.visitorId, row.visitorId))
    .orderBy(desc(leads.createdAt))
    .limit(1)
  if (!lead) return

  const fields = (lead.formResponsesJson as Record<string, unknown> | null) ?? {}
  if (typeof fields.phone === 'string' && fields.phone.trim()) return

  await db.update(leads).set({ formResponsesJson: { ...fields, phone } }).where(eq(leads.id, lead.id))
}

async function captureNameFromMessage(
  sessionId: string,
  message: string,
  history: ChatTurn[]
): Promise<void> {
  const trimmed = message.trim()
  if (!PLAUSIBLE_NAME_RE.test(trimmed) || trimmed.split(/\s+/).length > 4) return

  const lastAssistantTurn = [...history].reverse().find((t) => t.role === 'assistant')
  if (!lastAssistantTurn || !/address you|what.?s your name|how should i call you/i.test(lastAssistantTurn.content)) return

  const [row] = await db
    .select({ visitorId: sessions.visitorId })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1)
  if (!row) return

  const [lead] = await db
    .select({ id: leads.id, formResponsesJson: leads.formResponsesJson })
    .from(leads)
    .where(eq(leads.visitorId, row.visitorId))
    .orderBy(desc(leads.createdAt))
    .limit(1)
  if (!lead) return

  const fields = (lead.formResponsesJson as Record<string, unknown> | null) ?? {}
  if (typeof fields.firstName === 'string' && fields.firstName.trim()) return

  await db
    .update(leads)
    .set({ formResponsesJson: { ...fields, firstName: trimmed } })
    .where(eq(leads.id, lead.id))
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

    const currentAssetId = typeof body.currentAssetId === 'string'
      ? body.currentAssetId.trim().slice(0, 80) || null
      : null

    // Proactive outreach: the assistant opens the conversation on its own once
    // the visitor's engagement crosses a threshold, rather than waiting for a
    // question. No real user message exists for this turn — one is synthesized
    // server-side and never shown to the visitor or persisted as their own.
    const isKickoff = body.kickoff === true
    const kickoffAssetTitle = typeof body.kickoffAssetTitle === 'string'
      ? body.kickoffAssetTitle.trim().slice(0, 200)
      : ''

    const message = isKickoff
      ? `(System: the visitor has shown real engagement${kickoffAssetTitle ? ` while viewing "${kickoffAssetTitle}"` : ''}. Begin the conversation now, per your instructions for this moment — a contextual hook, not a generic greeting.)`
      : typeof body.message === 'string' ? body.message.replace(/\s+/g, ' ').trim().slice(0, 1600) : ''

    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 })
    }

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

    const history: ChatTurn[] = Array.isArray(body.history)
      ? (body.history as unknown[])
          .filter(isRecord)
          .filter((t): t is { role: 'user' | 'assistant'; content: string } =>
            (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string'
          )
          .map((t) => ({ role: t.role, content: t.content.slice(0, 1600) }))
          .slice(-20)
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

    const assistant = await callOpenAI(context, message, resolvedAssetId, askedQuestions, history, chatConfig.systemPrompt, Boolean(chatConfig.meetingUrl))

    // Persist the turn to the chat inbox (best-effort — never block the reply).
    // Kickoff turns get a human-readable label instead of the raw internal
    // trigger text, so the transcript reads sensibly rather than starting
    // mid-conversation with no context for how the assistant opened.
    const persistedMessage = isKickoff ? '(Assistant proactively started this conversation)' : message
    void persistChatTurn(trackId, sessionId, persistedMessage, assistant.answer).catch((err) =>
      console.error('[track-chat] persist failed:', err)
    )

    if (!isKickoff) {
      // Soft lead capture — visitor volunteered an email, phone, or name conversationally
      if (sessionId) {
        void captureEmailFromMessage(trackId, sessionId, message).catch((err) =>
          console.error('[track-chat] email capture failed:', err)
        )
        void capturePhoneFromMessage(sessionId, message).catch((err) =>
          console.error('[track-chat] phone capture failed:', err)
        )
        void captureNameFromMessage(sessionId, message, history).catch((err) =>
          console.error('[track-chat] name capture failed:', err)
        )
      }
    }

    // Explicit sales intent should surface the meeting card immediately,
    // regardless of how many questions have been asked so far — a visitor
    // who says "I want to talk to sales" shouldn't have to keep chatting
    // until they cross a question-count threshold.
    const showMeetingCta = Boolean(
      chatConfig.meetingUrl &&
      ((askedQuestions.length ?? 0) >= chatConfig.meetingCtaThreshold || (!isKickoff && SALES_INTENT_RE.test(message)))
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
