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

async function extractYouTubeTranscript(url: string): Promise<string> {
  try {
    const { YoutubeTranscript } = await import('youtube-transcript')
    const segments = await YoutubeTranscript.fetchTranscript(url)
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Asset = {
  id: string
  title: string
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
      title: trackRow.title,
      slug: trackRow.slug,
      layout: trackRow.layout,
      themeJson: trackRow.themeJson,
      gateConfigJson: trackRow.gateConfigJson,
    },
    assets: uniqueAssetRows.map((row) => ({
      id: row.id,
      title: row.title,
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

function assetLine(asset: Asset, index: number, pdfText?: string): string {
  const parts: string[] = [`${index + 1}. "${asset.title}" [${asset.type}]`]
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
  const url = asset.sourceUrl ?? asset.fileUrl
  if (url) {
    parts.push(`   URL: ${url.slice(0, 220)}`)
  }
  return parts.join('\n')
}

export async function buildSystemPrompt(
  track: Track,
  trackAssets: Asset[],
  currentAsset?: Asset
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

  return [
    `You are a content-guide assistant for ONE specific content track titled "${track.title}".`,
    'You are NOT a general-purpose assistant. You ONLY discuss this track and its assets.',
    'The CURRENT ASSET section below contains the full text of what the visitor is watching/reading right now. Answer questions from THAT content first.',
    '',
    'OTHER ASSETS IN THIS TRACK (metadata only — do not invent their content):',
    assetSection,
    currentSection,
    'HARD RULES — follow exactly, no exceptions:',
    '1. Answer from the CURRENT ASSET content above. Questions about speakers, presenters, authors, or people mentioned in the current asset ARE answerable if the name appears in its content. If the name is not in the content, say you cannot find it in this asset — do NOT pull names from other assets.',
    `2. For ANY off-topic question (weather, geography, math, news, coding, general trivia, pin/zip codes, other companies, anything not in the assets above), reply with EXACTLY this and nothing else: "${redirectLine}"`,
    '3. Answer ONLY using facts present in the TRACK ASSETS above. Never use outside knowledge for product claims, pricing, statistics, timelines, company facts, or definitions.',
    '4. Never invent asset titles, URLs, statistics, customer names, availability, or pricing. When citing an asset, use its exact title.',
    '5. Be concise and COMPLETE: 1–2 sentences for simple questions; for "key points"/"summary" questions use at most 3 short bullet lines (start each with "- "), one line each, no nested bullets. Hard limit 3 bullets. No trailing "want me to..." offers. Always finish your last sentence.',
    '6. If the answer is in the asset content above, quote or paraphrase it directly.',
    '7. No bold, italics, headings, or code formatting. Plain sentences and simple "- " bullets only.',
    '',
    'EXAMPLES of questions you CAN answer (name is in the content): "who is the speaker", "who presents this video", "who wrote this".',
    'EXAMPLES of off-topic questions you MUST redirect (do NOT answer them): "what is the weather", "560062 pin code", "who won the world cup", "write me code", "what is 2+2", "tell me about Microsoft".',
    `For the off-topic ones, your entire reply is: "${redirectLine}"`,
  ]
    .join('\n')
    .slice(0, 28000)
}
