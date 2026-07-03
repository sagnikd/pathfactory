import { notFound } from 'next/navigation'
import { db } from '@/db'
import { organizations, tracks, trackAssets, assets } from '@/db/schema'
import { and, eq, inArray, asc, desc } from 'drizzle-orm'
import type { Metadata } from 'next'
import ExperienceViewer from './ExperienceViewer'
import { TrackChatWidget } from '@/components/TrackChatWidget'
import { SessionSignals } from '@/components/SessionSignals'
import { CookieBanner } from '@/components/CookieBanner'
import { getTrackChatConfig } from '@/lib/trackChatConfig'
import { ensureVisitorSession } from '@/lib/visitorSession'

type ExperienceTheme = {
  kind?: string
  seoTitle?: string | null
  viewMode?: 'showcase' | 'catalog'
  faviconUrl?: string | null
  bannerImageUrl?: string | null
  headline?: string | null
  subheadline?: string | null
  ctaText?: string | null
  ctaUrl?: string | null
  ctaColor?: string | null
  ctaPlacement?: 'underHeadline' | 'topLeft' | 'topRight'
  selectedTrackIds?: string[]
  sectionHeadlines?: Record<string, string>
}

type TrackThemeWithFavicon = {
  faviconUrl?: string | null
}

function extractTags(metadataJson: unknown): string[] {
  if (!metadataJson || typeof metadataJson !== 'object') return []
  const maybeTags = (metadataJson as { tags?: unknown }).tags
  if (!Array.isArray(maybeTags)) return []
  return maybeTags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
}

function toPublicOrgSegment(slug: string): string {
  return slug.replace(/-[a-z0-9]{4}$/i, '')
}

async function resolveOrgAndExperience(orgSlugOrId: string, experienceSlug: string) {
  // Primary path: org slug + experience slug
  const [orgBySlug] = await db.select().from(organizations).where(eq(organizations.slug, orgSlugOrId))
  if (orgBySlug) {
    const [exp] = await db.select().from(tracks)
      .where(and(eq(tracks.organizationId, orgBySlug.id), eq(tracks.slug, experienceSlug)))
    if (exp) return { org: orgBySlug, experience: exp }
  }

  // Friendly short org segment support (e.g. "hclsoftware" for "hclsoftware-i9vf")
  const allOrgs = await db.select().from(organizations)
  const orgByPublicSegment = allOrgs.find((o) => toPublicOrgSegment(o.slug) === orgSlugOrId)
  if (orgByPublicSegment) {
    const [exp] = await db.select().from(tracks)
      .where(and(eq(tracks.organizationId, orgByPublicSegment.id), eq(tracks.slug, experienceSlug)))
    if (exp) return { org: orgByPublicSegment, experience: exp }
  }

  // Backward compatibility: org id + experience slug
  const [orgById] = await db.select().from(organizations).where(eq(organizations.id, orgSlugOrId))
  if (orgById) {
    const [exp] = await db.select().from(tracks)
      .where(and(eq(tracks.organizationId, orgById.id), eq(tracks.slug, experienceSlug)))
    if (exp) return { org: orgById, experience: exp }
  }

  // Fallback: resolve experience by slug globally (handles stale org slug in shared links)
  const bySlug = await db.select().from(tracks).where(eq(tracks.slug, experienceSlug))
  const candidate =
    bySlug.find((t) => {
      const theme = (t.themeJson as { kind?: string; selectedTrackIds?: string[] } | null) ?? null
      return theme?.kind === 'experience' || Array.isArray(theme?.selectedTrackIds)
    }) ?? bySlug[0]
  if (!candidate) return null

  const [org] = await db.select().from(organizations).where(eq(organizations.id, candidate.organizationId))
  if (!org) return null
  return { org, experience: candidate }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ orgSlug: string; experienceSlug: string }>
}): Promise<Metadata> {
  const { orgSlug, experienceSlug } = await params

  const resolved = await resolveOrgAndExperience(orgSlug, experienceSlug)
  if (!resolved) return { title: 'Experience' }
  const { org, experience } = resolved

  const theme = (experience.themeJson as ExperienceTheme | null) ?? null
  if (theme?.kind && theme.kind !== 'experience') return { title: 'Experience' }

  const orgTracks = await db.select({ themeJson: tracks.themeJson })
    .from(tracks)
    .where(eq(tracks.organizationId, org.id))
    .orderBy(desc(tracks.updatedAt))

  const orgDefaultFavicon =
    orgTracks
      .map((t) => ((t.themeJson as TrackThemeWithFavicon | null)?.faviconUrl ?? '').trim())
      .find((url) => url.length > 0) ?? undefined

  const favicon = theme?.faviconUrl?.trim() || orgDefaultFavicon

  return {
    title: theme?.seoTitle?.trim() || theme?.headline?.trim() || `${experience.title} | ${org.name}`,
    icons: favicon ? { icon: favicon, shortcut: favicon, apple: favicon } : undefined,
  }
}

export default async function PublicExperiencePage({
  params,
}: {
  params: Promise<{ orgSlug: string; experienceSlug: string }>
}) {
  const { orgSlug, experienceSlug } = await params

  const resolved = await resolveOrgAndExperience(orgSlug, experienceSlug)
  if (!resolved) notFound()
  const { org, experience } = resolved

  const theme = (experience.themeJson as ExperienceTheme | null) ?? null
  if (theme?.kind && theme.kind !== 'experience') notFound()

  const selectedTrackIds = theme?.selectedTrackIds ?? []
  if (selectedTrackIds.length === 0) {
    return (
      <ExperienceViewer
        orgSlug={org.slug}
        viewMode={theme?.viewMode ?? 'showcase'}
        hero={{
          headline: theme?.headline?.trim() || experience.title,
          subheadline: theme?.subheadline?.trim() || '',
          bannerImageUrl: theme?.bannerImageUrl?.trim() || null,
          ctaText: theme?.ctaText?.trim() || null,
          ctaUrl: theme?.ctaUrl?.trim() || null,
          ctaColor: theme?.ctaColor?.trim() || '#007381',
          ctaPlacement: theme?.ctaPlacement ?? 'underHeadline',
        }}
        sections={[]}
      />
    )
  }

  const selectedTracks = await db.select().from(tracks)
    .where(and(eq(tracks.organizationId, org.id), inArray(tracks.id, selectedTrackIds)))

  const assetsRows = await db.select({
    trackId: trackAssets.trackId,
    position: trackAssets.position,
    displayTitle: trackAssets.displayTitle,
    subCopy: trackAssets.subCopy,
    asset: assets,
  })
  .from(trackAssets)
  .innerJoin(assets, eq(trackAssets.assetId, assets.id))
  .where(inArray(trackAssets.trackId, selectedTrackIds))
  .orderBy(asc(trackAssets.position))

  const assetsByTrack: Record<string, typeof assetsRows> = {}
  for (const row of assetsRows) {
    if (!assetsByTrack[row.trackId]) assetsByTrack[row.trackId] = []
    assetsByTrack[row.trackId].push(row)
  }

  const sections = selectedTracks.map((track) => ({
    id: track.id,
    title: track.title,
    slug: track.slug,
    headline: theme?.sectionHeadlines?.[track.id]?.trim() || track.title,
    assets: (assetsByTrack[track.id] ?? []).map((row) => ({
      ...row.asset,
      displayTitle: row.displayTitle ?? null,
      subCopy: row.subCopy ?? null,
      tags: extractTags(row.asset.metadataJson),
      trackId: track.id,
      trackTitle: track.title,
      trackSlug: track.slug,
    })),
  }))

  // Open a visitor session for this experience so chat conversations link to
  // a visitor and any captured contact (mirrors the track viewer).
  const { sessionId, visitorName } = await ensureVisitorSession(experience.id)

  return (
    <>
      <ExperienceViewer
        orgSlug={org.slug}
        viewMode={theme?.viewMode ?? 'showcase'}
        hero={{
          headline: theme?.headline?.trim() || experience.title,
          subheadline: theme?.subheadline?.trim() || '',
          bannerImageUrl: theme?.bannerImageUrl?.trim() || null,
          ctaText: theme?.ctaText?.trim() || null,
          ctaUrl: theme?.ctaUrl?.trim() || null,
          ctaColor: theme?.ctaColor?.trim() || '#007381',
          ctaPlacement: theme?.ctaPlacement ?? 'underHeadline',
        }}
        sections={sections}
      />
      {/* Chat assistant — answers from the assets aggregated across this
          experience's child tracks (fetchTrackContext handles the kind:experience case) */}
      <TrackChatWidget
        trackId={experience.id}
        sessionId={sessionId}
        visitorName={visitorName}
        chatConfig={getTrackChatConfig(experience.themeJson)}
      />
      {/* Geo capture + end-of-session summary email beacon */}
      <SessionSignals sessionId={sessionId} />
      <CookieBanner />
    </>
  )
}
