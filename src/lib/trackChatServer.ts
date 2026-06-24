import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { assets, organizations, trackAssets, tracks } from '@/db/schema'

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

function assetLine(asset: Asset, index: number): string {
  const parts: string[] = [`${index + 1}. "${asset.title}" [${asset.type}]`]
  if (asset.description) {
    parts.push(`   Description: ${asset.description.slice(0, 300)}`)
  }
  const tags = getAssetTags(asset.metadataJson)
  if (tags.length > 0) {
    parts.push(`   Tags: ${tags.join(', ')}`)
  }
  const url = asset.sourceUrl ?? asset.fileUrl
  if (url) {
    parts.push(`   URL: ${url.slice(0, 220)}`)
  }
  return parts.join('\n')
}

export function buildSystemPrompt(track: Track, trackAssets: Asset[], currentAsset?: Asset): string {
  const currentSection = currentAsset
    ? [
        '',
        `CURRENT ASSET THE VISITOR IS VIEWING:`,
        `  Title: ${currentAsset.title}`,
        `  Type:  ${currentAsset.type}`,
        currentAsset.description ? `  Description: ${currentAsset.description.slice(0, 300)}` : '',
        '',
      ]
        .filter((line) => line !== undefined)
        .join('\n')
    : ''

  const assetSection = trackAssets.map(assetLine).join('\n\n')

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
    '5. Keep answers concise (3–5 sentences where possible) and focused on helping the visitor evaluate or navigate this track.',
    '6. Nudge the visitor toward sharper buying or evaluation questions related to this track.',
    '7. Return only valid JSON with this shape: {"answer":"...","suggestedQuestions":["...","...","..."]}',
  ]
    .join('\n')
    .slice(0, 12000)
}
