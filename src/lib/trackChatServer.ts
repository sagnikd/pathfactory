import { and, asc, eq } from 'drizzle-orm'
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
      .slice(0, 6000)
  } catch (err) {
    console.error('[yt-transcript] failed:', err)
    return ''
  }
}

// Extract readable text from any supported asset (PDF file/URL or YouTube video).
// Caches the result in assets.metadataJson.extractedText so each asset is only
// fetched/parsed once — subsequent chats reuse the stored text.
async function extractAssetText(asset: Asset): Promise<string> {
  const url = asset.fileUrl ?? asset.sourceUrl
  if (!url) return ''

  // 1. Serve from cache when present
  const meta = (asset.metadataJson && typeof asset.metadataJson === 'object'
    ? (asset.metadataJson as Record<string, unknown>)
    : {})
  const cached = meta.extractedText
  if (typeof cached === 'string' && cached.length > 0) return cached

  // 2. Extract fresh
  let text = ''
  if (asset.type === 'pdf' || isPdfUrl(url)) text = await extractPdfText(url)
  else if (youTubeId(url)) text = await extractYouTubeTranscript(url)
  if (!text) return ''

  // 3. Write back to cache (best-effort — never block on a cache write)
  try {
    await db
      .update(assets)
      .set({ metadataJson: { ...meta, extractedText: text, extractedAt: new Date().toISOString() } })
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
    .where(eq(trackAssets.trackId, trackId))
    .orderBy(asc(trackAssets.position))

  return {
    track: {
      id: trackRow.id,
      title: trackRow.title,
      slug: trackRow.slug,
      layout: trackRow.layout,
      themeJson: trackRow.themeJson,
      gateConfigJson: trackRow.gateConfigJson,
    },
    assets: assetRows.map((row) => ({
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
    parts.push(`   Content (extracted text / video transcript):\n${pdfText.slice(0, 3000)}`)
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
  // Extract readable content (PDF text / YouTube transcript) — always the
  // current asset first, then up to 2 more extractable assets.
  const extractions = new Map<string, string>()
  const extractable = trackAssets.filter(
    (a) => a.type === 'pdf' || isPdfUrl(a.fileUrl ?? a.sourceUrl) || youTubeId(a.sourceUrl ?? a.fileUrl)
  )
  const ordered = currentAsset
    ? [currentAsset, ...extractable.filter((a) => a.id !== currentAsset.id)]
    : extractable
  // Dedupe while preserving order, cap to 3 fetches to bound latency
  const seen = new Set<string>()
  const toFetch = ordered.filter((a) => {
    if (seen.has(a.id)) return false
    seen.add(a.id)
    return a.type === 'pdf' || isPdfUrl(a.fileUrl ?? a.sourceUrl) || !!youTubeId(a.sourceUrl ?? a.fileUrl)
  }).slice(0, 3)

  await Promise.all(
    toFetch.map(async (a) => {
      const text = await extractAssetText(a)
      if (text) extractions.set(a.id, text)
    })
  )

  const currentSection = currentAsset
    ? [
        '',
        `CURRENT ASSET THE VISITOR IS VIEWING:`,
        `  Title: ${currentAsset.title}`,
        `  Type:  ${currentAsset.type}`,
        currentAsset.description ? `  Description: ${currentAsset.description.slice(0, 300)}` : '',
        extractions.get(currentAsset.id)
          ? `  Content:\n${extractions.get(currentAsset.id)!.slice(0, 4000)}`
          : '',
        '',
      ]
        .filter(Boolean)
        .join('\n')
    : ''

  const assetSection = trackAssets
    .map((a, i) => assetLine(a, i, extractions.get(a.id)))
    .join('\n\n')

  return [
    `You are a concise B2B content-guide assistant embedded in a content track titled "${track.title}".`,
    '',
    'TRACK ASSETS:',
    assetSection,
    currentSection,
    'GUARDRAILS — follow these exactly:',
    '1. Answer ONLY using the track and asset context provided above. Do not draw on outside knowledge for product claims, pricing, timelines, or company facts.',
    '2. If the visitor asks something outside the scope of this track, politely acknowledge it and redirect them to the most relevant asset in the list.',
    '3. Never invent asset titles, URLs, statistics, customer names, availability, or pricing.',
    '4. When recommending an asset, use its exact title from the list above.',
    '5. Keep answers to 1–2 sentences. No preamble, no summary at the end.',
    '6. If the answer is in the asset content above, quote or paraphrase it directly.',
    '7. Reply in plain prose. No JSON, no markdown, no bullet points.',
  ]
    .join('\n')
    .slice(0, 12000)
}
