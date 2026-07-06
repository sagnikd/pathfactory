import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { assets, organizations, trackAssets, tracks } from '@/db/schema'

// ---------------------------------------------------------------------------
// Asset content extraction (server-side, best-effort)
// ---------------------------------------------------------------------------

function isPdfUrl(url: string | null | undefined): boolean {
  if (!url) return false
  return /\.pdf(\?.*)?$/i.test(url)
}

function youTubeId(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('/')[0] || null
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v')
  } catch {}
  return null
}

async function extractPdfText(url: string): Promise<string> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) })
    if (!res.ok) return ''
    const buffer = new Uint8Array(await res.arrayBuffer())
    // unpdf bundles its own pdfjs build with no worker config — works in
    // Next.js / serverless without GlobalWorkerOptions setup.
    const { extractText, getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(buffer)
    const { text } = await extractText(pdf, { mergePages: true })
    const merged = Array.isArray(text) ? text.join('\n') : text
    return merged.replace(/\s+/g, ' ').trim().slice(0, 6000)
  } catch (err) {
    console.error('[pdf-extract] failed:', err)
    return ''
  }
}

// Build a fetch that egresses through a residential proxy, if configured.
// YouTube blocks transcript requests from datacenter IPs (Netlify), so in
// production we route them through a residential/rotating proxy via
// YOUTUBE_PROXY_URL (e.g. http://user:pass@gate.smartproxy.com:7000).
// Returns undefined when no proxy is set — caller falls back to direct fetch.
let cachedProxyFetch: typeof fetch | null | undefined
async function getProxyFetch(): Promise<typeof fetch | undefined> {
  if (cachedProxyFetch !== undefined) return cachedProxyFetch ?? undefined
  const proxyUrl = process.env.YOUTUBE_PROXY_URL?.trim()
  if (!proxyUrl) {
    cachedProxyFetch = null
    return undefined
  }
  try {
    const { ProxyAgent } = await import('undici')
    const agent = new ProxyAgent(proxyUrl)
    // Node's global fetch (undici) accepts a per-request `dispatcher`.
    const proxyFetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      fetch(input, { ...(init ?? {}), dispatcher: agent } as RequestInit)) as typeof fetch
    cachedProxyFetch = proxyFetch
    return proxyFetch
  } catch (err) {
    console.error('[yt-transcript] proxy init failed:', err)
    cachedProxyFetch = null
    return undefined
  }
}

async function extractYouTubeTranscript(url: string): Promise<string> {
  try {
    const { YoutubeTranscript } = await import('youtube-transcript')
    const proxyFetch = await getProxyFetch()
    // youtube-transcript honors config.fetch for every request it makes, so
    // routing it through the proxy makes the whole flow egress residentially.
    const config = proxyFetch ? ({ fetch: proxyFetch } as unknown as undefined) : undefined
    const segments = await YoutubeTranscript.fetchTranscript(url, config)
    return segments
      .map((s) => s.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 20000)
  } catch (err) {
    console.error('[yt-transcript] failed:', err)
    return ''
  }
}

// Bump this when extraction limits change — newer-version caches are preferred,
// but a stale cache is still used as a fallback when live re-extraction fails.
const EXTRACT_VERSION = 2

// Extract readable text from any supported asset (PDF file/URL or YouTube video).
// Caches the result in assets.metadataJson.extractedText so each asset is only
// fetched/parsed once — subsequent chats reuse the stored text.
//
// IMPORTANT: YouTube blocks transcript fetches from datacenter IPs (Netlify),
// so live extraction usually FAILS in production. Transcripts are normally
// pre-populated by the local backfill script (scripts/backfill-transcripts.mjs),
// which runs from a residential IP. This function therefore treats the DB cache
// as the source of truth and never discards a good cache when a live fetch fails.
async function extractAssetText(asset: Asset): Promise<string> {
  const url = asset.fileUrl ?? asset.sourceUrl
  if (!url) return ''

  const meta = (asset.metadataJson && typeof asset.metadataJson === 'object'
    ? (asset.metadataJson as Record<string, unknown>)
    : {})
  const cached = typeof meta.extractedText === 'string' ? meta.extractedText : ''
  const cachedVersion = typeof meta.extractedVersion === 'number' ? meta.extractedVersion : 1

  // 1. Fresh cache at the current version — use it directly.
  if (cached.length > 0 && cachedVersion >= EXTRACT_VERSION) return cached

  // 2. Try a fresh extraction (works locally; usually fails on Netlify for YT).
  let text = ''
  if (asset.type === 'pdf' || isPdfUrl(url)) text = await extractPdfText(url)
  else if (youTubeId(url)) text = await extractYouTubeTranscript(url)

  // 3. Live extraction failed — fall back to whatever is cached (even if stale).
  //    Better to serve an older/shorter transcript than nothing.
  if (!text) return cached

  // 4. Got fresh text — write it back to the cache (best-effort).
  try {
    await db
      .update(assets)
      .set({ metadataJson: { ...meta, extractedText: text, extractedAt: new Date().toISOString(), extractedVersion: EXTRACT_VERSION } })
      .where(eq(assets.id, asset.id))
  } catch (err) {
    console.error('[asset-extract] cache write failed:', err)
  }
  return text
}

/**
 * Extract and cache an asset's transcript / text by id. Called at asset-creation
 * time (from the dashboard "add asset" actions) so the transcript is captured
 * immediately while the server is on a residential IP (local dev, or production
 * with YOUTUBE_PROXY_URL set). YouTube blocks datacenter IPs, so capturing at
 * add-time — when the admin's own machine runs the action in dev — is the free
 * path that avoids the Netlify block entirely.
 *
 * Best-effort: returns the number of characters cached (0 if nothing extracted).
 * Never throws — a failed extraction must not break asset creation.
 */
export async function warmAssetExtraction(assetId: string): Promise<number> {
  try {
    const [row] = await db
      .select({
        id: assets.id,
        title: assets.title,
        type: assets.type,
        description: assets.description,
        sourceUrl: assets.sourceUrl,
        fileUrl: assets.fileUrl,
        thumbnailUrl: assets.thumbnailUrl,
        metadataJson: assets.metadataJson,
      })
      .from(assets)
      .where(eq(assets.id, assetId))
      .limit(1)
    if (!row) return 0
    const text = await extractAssetText({ ...row, displayTitle: null, subCopy: null } as Asset)
    return text.length
  } catch (err) {
    console.error('[warm-extract] failed:', err)
    return 0
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Asset = {
  id: string
  title: string
  displayTitle: string | null
  subCopy: string | null
  type: 'pdf' | 'video' | 'article' | 'image'
  description: string | null
  sourceUrl: string | null
  fileUrl: string | null
  thumbnailUrl: string | null
  metadataJson: unknown
}

export type Track = {
  id: string
  title: string
  slug: string
  layout: 'binge' | 'hub' | 'single'
  themeJson: unknown
  gateConfigJson: unknown
}

export type Org = {
  id: string
  name: string
  slug: string
}

export type TrackContext = {
  track: Track
  assets: Asset[]
  org: Org
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function cleanText(value: unknown, maxLength = 500): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/\s+/g, ' ').trim()
  return cleaned ? cleaned.slice(0, maxLength) : null
}

function getAssetTags(metadataJson: unknown): string[] {
  const record = asRecord(metadataJson)
  if (!Array.isArray(record.tags)) return []
  return record.tags
    .map((tag) => cleanText(tag, 60))
    .filter((tag): tag is string => Boolean(tag))
    .slice(0, 8)
}

// ---------------------------------------------------------------------------
// 1. fetchTrackContext
// ---------------------------------------------------------------------------

export async function fetchTrackContext(trackId: string): Promise<TrackContext | null> {
  const [trackRow] = await db
    .select({
      id: tracks.id,
      title: tracks.title,
      externalTitle: tracks.externalTitle,
      slug: tracks.slug,
      layout: tracks.layout,
      themeJson: tracks.themeJson,
      gateConfigJson: tracks.gateConfigJson,
      orgId: organizations.id,
      orgName: organizations.name,
      orgSlug: organizations.slug,
    })
    .from(tracks)
    .innerJoin(organizations, eq(tracks.organizationId, organizations.id))
    .where(eq(tracks.id, trackId))
    .limit(1)

  if (!trackRow) return null

  // An "experience" is a wrapper track that aggregates assets from several
  // child tracks (themeJson.selectedTrackIds). Pull assets from those children;
  // a normal track pulls its own trackAssets.
  const theme = asRecord(trackRow.themeJson)
  const isExperience = theme.kind === 'experience'
  const selectedTrackIds = isExperience && Array.isArray(theme.selectedTrackIds)
    ? (theme.selectedTrackIds as unknown[]).filter((v): v is string => typeof v === 'string')
    : []
  const assetTrackIds = isExperience && selectedTrackIds.length ? selectedTrackIds : [trackId]

  const assetRows = await db
    .select({
      id: assets.id,
      title: assets.title,
      displayTitle: trackAssets.displayTitle,
      subCopy: trackAssets.subCopy,
      type: assets.type,
      description: assets.description,
      sourceUrl: assets.sourceUrl,
      fileUrl: assets.fileUrl,
      thumbnailUrl: assets.thumbnailUrl,
      metadataJson: assets.metadataJson,
    })
    .from(trackAssets)
    .innerJoin(assets, eq(trackAssets.assetId, assets.id))
    .where(inArray(trackAssets.trackId, assetTrackIds))
    .orderBy(asc(trackAssets.position))

  // Dedupe — an asset can belong to multiple child tracks of an experience
  const seenAssetIds = new Set<string>()
  const uniqueAssetRows = assetRows.filter((r) => {
    if (seenAssetIds.has(r.id)) return false
    seenAssetIds.add(r.id)
    return true
  })

  return {
    track: {
      id: trackRow.id,
      // Chat is visitor-facing — use the external (public) name, not the
      // internal admin-only label.
      title: trackRow.externalTitle?.trim() || trackRow.title,
      slug: trackRow.slug,
      layout: trackRow.layout,
      themeJson: trackRow.themeJson,
      gateConfigJson: trackRow.gateConfigJson,
    },
    assets: uniqueAssetRows.map((row) => ({
      id: row.id,
      title: row.title,
      displayTitle: row.displayTitle ?? null,
      subCopy: row.subCopy ?? null,
      type: row.type,
      description: cleanText(row.description, 600),
      sourceUrl: cleanText(row.sourceUrl, 500),
      fileUrl: cleanText(row.fileUrl, 500),
      thumbnailUrl: cleanText(row.thumbnailUrl, 500),
      metadataJson: row.metadataJson,
    })),
    org: {
      id: trackRow.orgId,
      name: trackRow.orgName,
      slug: trackRow.orgSlug,
    },
  }
}

// ---------------------------------------------------------------------------
// 2. isTrackGated
// ---------------------------------------------------------------------------

export function isTrackGated(themeJson: unknown): boolean {
  const theme = asRecord(themeJson)
  if (theme.gated === true) return true
  const formConfig = asRecord(theme.formConfig)
  return formConfig.enabled === true
}

// ---------------------------------------------------------------------------
// 3. buildSystemPrompt
// ---------------------------------------------------------------------------

// Assets are referenced with a stable [[asset:<id>:<title>]] token instead of
// a raw URL. The client renders this as an in-session link that switches the
// visitor to that asset without leaving the track or exposing a backend/CDN
// URL. See TrackChatWidget's message renderer for the client-side half.
function assetLine(asset: Asset, index: number, pdfText?: string): string {
  const title = asset.displayTitle ?? asset.title
  const parts: string[] = [`${index + 1}. "${title}" [${asset.type}] — reference token: [[asset:${asset.id}:${title}]]`]
  if (asset.description) {
    parts.push(`   Description: ${asset.description.slice(0, 300)}`)
  }
  const tags = getAssetTags(asset.metadataJson)
  if (tags.length > 0) {
    parts.push(`   Tags: ${tags.join(', ')}`)
  }
  if (pdfText) {
    parts.push(`   Content (extracted text / video transcript):\n${pdfText.slice(0, 4000)}`)
  }
  return parts.join('\n')
}

const JSON_OUTPUT_INSTRUCTIONS = [
  '',
  'OUTPUT FORMAT — always respond with a single JSON object and nothing else:',
  '{"answer": "your reply text shown to the visitor", "suggestedQuestions": ["short clickable option 1", "short clickable option 2", ...]}',
  '- "answer" is required plain text (no markdown).',
  '- The full question you are asking the visitor must always be written out in "answer" — never rely on "suggestedQuestions" alone to convey what you are asking; it only supplies clickable shortcuts for a question already stated in "answer".',
  '- "suggestedQuestions" is optional. Use it ONLY for a closed set of valid, clickable ANSWERS to a multiple-choice question you just asked (e.g. "Insurance", "Financial Services", "Healthcare" after asking their industry) — each entry must be a short answer the visitor could click as-is.',
  '- EVERY entry in "suggestedQuestions" must be an ANSWER (visitor\'s words), never a question. If an entry ends with "?" it is wrong — remove it. "Which industry are you in?" is wrong; "Insurance" is right.',
  '- Never use "suggestedQuestions" for open-ended questions expecting free text (name, email, company) — leave it as an empty array and let them type their answer.',
  '- Do NOT put follow-up questions or conversation starters in "suggestedQuestions". If you have not just asked a closed multiple-choice question, set "suggestedQuestions" to [].',
  '- Never wrap the JSON in code fences. Output ONLY the JSON object.',
]

// Included in every system prompt regardless of custom persona text — baseline
// behavior the assistant should have without an admin needing to spell it out.
function baselineIntelligenceRules(meetingConfigured: boolean): string[] {
  const salesIntentRule = meetingConfigured
    ? '- If the visitor explicitly asks to talk to sales, speak to someone, book a meeting, schedule a call, or similar — stop whatever qualification flow you are in immediately. Do not ask further questions first. Simply acknowledge and tell them they can use the "Book a meeting" button to pick a time.'
    : '- If the visitor explicitly asks to talk to sales, speak to someone, book a meeting, schedule a call, or similar — there is no meeting-booking link configured, so instead stop whatever qualification flow you are in and ask for their email address and phone number so the team can follow up directly. Once you have both, confirm with: "Thanks — someone from our team will get back to you within 24 hours." Do not offer a "Book a meeting" button since none exists.'

  return [
    '',
    'BASELINE BEHAVIOR — always follow these, on top of any persona or flow above:',
    '- Never ask the visitor for information they already gave earlier in this conversation (industry, role, name, email, phone, or anything else). Check the conversation history before asking a question.',
    salesIntentRule,
    '- When pointing the visitor to a specific asset in this track, reference it using its exact reference token, e.g. [[asset:<id>:<title>]], exactly as given in the asset list below. Never output a raw http(s) URL for a track asset, and never invent a reference token for an asset not listed below.',
  ]
}

// Repeated as the LAST thing the model reads, right before it must respond —
// models weight instructions closer to generation more heavily, and this is
// specifically the failure mode admins hit with multi-step qualification
// flows (ask industry → visitor clicks an option chip → model re-asks the
// same question instead of advancing), so it earns a dedicated, concrete
// checklist rather than relying on the general "don't re-ask" rule above
// being noticed among a long persona/asset-content prompt.
const FINAL_STATE_CHECK = [
  '',
  'BEFORE YOU RESPOND — re-read the visitor\'s most recent message against your own immediately preceding message:',
  '- If your previous message asked a single question (open-ended, or offering clickable options) and the visitor\'s new message is a plausible answer to it — a word/phrase matching one of the options you offered, or any direct reply to what you asked — treat that question as answered. Do not ask it again in any form. Move on to the next step of your flow (or the next thing worth asking/telling them).',
  '- This applies even if their answer is terse (e.g. just "Insurance" or "CMO") — terse is still an answer, not a non-answer.',
]

export async function buildSystemPrompt(
  track: Track,
  trackAssets: Asset[],
  currentAsset?: Asset,
  customSystemPrompt?: string,
  meetingConfigured = false,
  visitorProfile?: Record<string, string> | null
): Promise<string> {
  // Only extract the CURRENT asset's content — other track assets contribute
  // title/type/metadata only. This prevents content from unrelated assets (e.g.
  // a PDF whose author is "Paul Pisecco") from bleeding into answers about a
  // different video the visitor is actively watching.
  let currentText = ''
  if (currentAsset) {
    currentText = await extractAssetText(currentAsset)
  }

  // Also pre-warm cache for other extractable assets in the background so
  // future navigation is instant — but do NOT include their text in this prompt.
  const othersToWarm = trackAssets
    .filter((a) => a.id !== currentAsset?.id)
    .filter((a) => a.type === 'pdf' || isPdfUrl(a.fileUrl ?? a.sourceUrl) || !!youTubeId(a.sourceUrl ?? a.fileUrl))
    .slice(0, 3)
  void Promise.all(othersToWarm.map((a) => extractAssetText(a).catch(() => '')))

  const currentSection = currentAsset
    ? [
        '',
        `CURRENT ASSET THE VISITOR IS VIEWING (answer questions from this content):`,
        `  Title: ${currentAsset.title}`,
        `  Type:  ${currentAsset.type}`,
        currentAsset.description ? `  Description: ${currentAsset.description.slice(0, 300)}` : '',
        currentText
          ? `  Full content (PDF text / video transcript):\n${currentText.slice(0, 15000)}`
          : '  (no extractable text — use title and description only)',
        '',
      ]
        .filter(Boolean)
        .join('\n')
    : ''

  // Other track assets: metadata only — so the AI knows what else is in the
  // track for navigation hints but cannot mix their content into the current answer.
  const assetSection = trackAssets
    .map((a, i) => assetLine(a, i))
    .join('\n\n')

  const redirectLine = trackAssets.length
    ? `That's outside what this track covers. This track is about "${track.title}" — ask me about ${trackAssets.slice(0, 2).map((a) => `"${a.title}"`).join(' or ')}.`
    : `That's outside what this track covers. Ask me about "${track.title}".`

  // Build a visitor profile section if gate form data was submitted this session.
  // Fields map: known keys → readable labels; unknown keys use title-cased key name.
  const FIELD_LABELS: Record<string, string> = {
    firstName: 'First name',
    lastName: 'Last name',
    email: 'Email',
    company: 'Company',
    industry: 'Industry',
    jobTitle: 'Job title',
    phone: 'Phone',
    country: 'Country',
    city: 'City',
  }
  const profileSection = visitorProfile && Object.keys(visitorProfile).length > 0
    ? [
        '',
        'VISITOR PROFILE — already collected from the gate form this session:',
        ...Object.entries(visitorProfile)
          .filter(([, v]) => v.trim())
          .map(([k, v]) => `  ${FIELD_LABELS[k] ?? k.replace(/([A-Z])/g, ' $1').trim()}: ${v}`),
        'Do NOT ask the visitor for any of these fields again. They have already been provided.',
        '',
      ].join('\n')
    : ''

  // Custom persona/behavior configured in the dashboard — takes priority over
  // the default Q&A persona below, but still gets the real asset data and the
  // same anti-hallucination guardrails so it can only ever recommend real
  // assets with real links, never invented ones.
  if (customSystemPrompt) {
    return [
      customSystemPrompt,
      '',
      `You are operating on the content track titled "${track.title}".`,
      profileSection,
      '',
      'ASSETS AVAILABLE IN THIS TRACK (the only content you may reference or recommend):',
      assetSection,
      currentSection,
      'GUARDRAILS — follow exactly, no exceptions:',
      '- Only recommend assets listed above, using their exact title and reference token. Never invent asset titles, links, statistics, or descriptions.',
      '- Never fabricate outcome stats, customer names, or claims not present in the asset data above.',
      '- Stay on the topic of this track and its assets; redirect anything unrelated back to the track.',
      ...baselineIntelligenceRules(meetingConfigured),
      ...FINAL_STATE_CHECK,
      ...JSON_OUTPUT_INSTRUCTIONS,
    ]
      .join('\n')
      .slice(0, 28000)
  }

  return [
    `You are a content-guide assistant for ONE specific content track titled "${track.title}".`,
    'You are NOT a general-purpose assistant. You ONLY discuss this track and its assets.',
    'The CURRENT ASSET section below contains the full text of what the visitor is watching/reading right now. Answer questions from THAT content first.',
    profileSection,
    '',
    'OTHER ASSETS IN THIS TRACK (metadata only — do not invent their content):',
    assetSection,
    currentSection,
    'HARD RULES — follow exactly, no exceptions:',
    '1. Answer from the CURRENT ASSET content above. Questions about speakers, presenters, authors, or people mentioned in the current asset ARE answerable if the name appears in its content. If the name is not in the content, say you cannot find it in this asset — do NOT pull names from other assets.',
    `2. For ANY off-topic question (weather, geography, math, news, coding, general trivia, pin/zip codes, other companies, anything not in the assets above), reply with EXACTLY this and nothing else: "${redirectLine}"`,
    '3. Answer ONLY using facts present in the TRACK ASSETS above. Never use outside knowledge for product claims, pricing, statistics, timelines, company facts, or definitions.',
    '4. Never invent asset titles, reference tokens, statistics, customer names, availability, or pricing. When citing an asset, use its exact title and reference token.',
    '5. Be concise and COMPLETE: 1–2 sentences for simple questions; for "key points"/"summary" questions use at most 3 short bullet lines (start each with "- "), one line each, no nested bullets. Hard limit 3 bullets. No trailing "want me to..." offers. Always finish your last sentence.',
    '6. If the answer is in the asset content above, quote or paraphrase it directly.',
    '7. No bold, italics, headings, or code formatting. Plain sentences and simple "- " bullets only.',
    '',
    'EXAMPLES of questions you CAN answer (name is in the content): "who is the speaker", "who presents this video", "who wrote this".',
    'EXAMPLES of off-topic questions you MUST redirect (do NOT answer them): "what is the weather", "560062 pin code", "who won the world cup", "write me code", "what is 2+2", "tell me about Microsoft".',
    `For the off-topic ones, your entire reply is: "${redirectLine}"`,
    ...baselineIntelligenceRules(meetingConfigured),
    ...FINAL_STATE_CHECK,
    ...JSON_OUTPUT_INSTRUCTIONS,
  ]
    .join('\n')
    .slice(0, 28000)
}
