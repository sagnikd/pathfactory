'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { tracks, trackAssets, assets, trackSlugRedirects } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import * as cheerio from 'cheerio'

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v')
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('?')[0] || null
  } catch {}
  return null
}

function isCloudinaryPlayerUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.hostname === 'player.cloudinary.com' && u.pathname.startsWith('/embed')
  } catch {
    return false
  }
}

function titleFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '')
    const name = last.replace(/\.[^/.]+$/, '').replace(/[-_]+/g, ' ').trim()
    return name || u.hostname
  } catch {
    return url.substring(0, 80)
  }
}

function cleanTitle(raw: string, fallbackUrl: string): string {
  if (!raw) return titleFromUrl(fallbackUrl)
  // Some CMSes (portal/portlet-based sites in particular) concatenate
  // accessibility labels straight into the page <title> with no whitespace
  // — e.g. "...MarketingHubsDisplay content menuDisplay portlet menua/icons/
  // social/linkedin_filled..." — so a plain \s+ split misses the boundary.
  // Cut at the first known junk marker regardless of surrounding whitespace.
  const junkMarkerIndex = raw.search(/Display\s*(content|portlet)\s*menu|a\/icons\/social\//i)
  const withoutJunk = junkMarkerIndex > 0 ? raw.slice(0, junkMarkerIndex) : raw
  const cleaned = withoutJunk
    .split(/\s*\|\s*|\s+menua\/|\s+menu[A-Z]|\s+-\s+[A-Z]{2,}/).shift()!
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.substring(0, 120) || titleFromUrl(fallbackUrl)
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

function pageScreenshotUrl(url: string): string {
  return `https://image.thum.io/get/width/1200/crop/720/noanimate/${url}`
}

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 64)
}

// Slugs only need to be unique per-org (see org_slug_idx) — a random suffix
// makes a collision astronomically unlikely, but check anyway rather than
// trust it blindly, same defensive style used for visitor fingerprint races.
async function generateUniqueSlug(orgId: string, name: string, excludeTrackId?: string): Promise<string> {
  const base = slugify(name)
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = base + '-' + Math.random().toString(36).substring(2, 6)
    const existing = await db.select({ id: tracks.id }).from(tracks)
      .where(and(eq(tracks.organizationId, orgId), eq(tracks.slug, candidate)))
      .limit(1)
    if (!existing.length || existing[0].id === excludeTrackId) return candidate
  }
  // Vanishingly unlikely fallback — timestamp guarantees uniqueness.
  return `${base}-${Date.now().toString(36)}`
}

type AssetEntry = { assetId: string; displayTitle?: string | null; subCopy?: string | null }

export async function createTrack(
  orgId: string,
  data: { title: string; externalTitle?: string | null; layout: 'binge' | 'hub' | 'single'; status: 'draft' | 'published' },
  assetEntries: AssetEntry[],
  gateConfigJson?: object | null,
  themeJson?: object | null
) {
  const externalTitle = data.externalTitle?.trim() || null
  const slug = await generateUniqueSlug(orgId, externalTitle || data.title)

  const [track] = await db.insert(tracks).values({
    organizationId: orgId,
    title: data.title,
    externalTitle,
    slug,
    layout: data.layout,
    status: data.status,
    gateConfigJson: gateConfigJson ?? null,
    themeJson: themeJson ?? null,
  }).returning()

  if (assetEntries.length > 0) {
    await db.insert(trackAssets).values(
      assetEntries.map((e, i) => ({
        trackId: track.id,
        assetId: e.assetId,
        position: i,
        displayTitle: e.displayTitle ?? null,
        subCopy: e.subCopy ?? null,
      }))
    )
  }

  revalidatePath('/dashboard/tracks')
  redirect(`/dashboard/tracks/${track.id}`)
}

export async function updateTrack(
  trackId: string,
  data: { title: string; externalTitle?: string | null; layout: 'binge' | 'hub' | 'single'; status: 'draft' | 'published' },
  assetEntries: AssetEntry[],
  gateConfigJson?: object | null,
  themeJson?: object | null
) {
  const [current] = await db.select({
    slug: tracks.slug,
    title: tracks.title,
    externalTitle: tracks.externalTitle,
    organizationId: tracks.organizationId,
  }).from(tracks).where(eq(tracks.id, trackId))

  const externalTitle = data.externalTitle?.trim() || null
  let newSlug: string | undefined

  if (current) {
    const oldName = current.externalTitle?.trim() || current.title
    const newName = externalTitle || data.title
    if (oldName !== newName) {
      newSlug = await generateUniqueSlug(current.organizationId, newName, trackId)
      await db.insert(trackSlugRedirects).values({
        organizationId: current.organizationId,
        oldSlug: current.slug,
        trackId,
      })
    }
  }

  await db.update(tracks)
    .set({
      title: data.title,
      externalTitle,
      ...(newSlug ? { slug: newSlug } : {}),
      layout: data.layout,
      status: data.status,
      gateConfigJson: gateConfigJson ?? null,
      themeJson: themeJson ?? null,
      updatedAt: new Date(),
    })
    .where(eq(tracks.id, trackId))

  await db.delete(trackAssets).where(eq(trackAssets.trackId, trackId))

  if (assetEntries.length > 0) {
    await db.insert(trackAssets).values(
      assetEntries.map((e, i) => ({
        trackId,
        assetId: e.assetId,
        position: i,
        displayTitle: e.displayTitle ?? null,
        subCopy: e.subCopy ?? null,
      }))
    )
  }

  revalidatePath('/dashboard/tracks')
  revalidatePath(`/dashboard/tracks/${trackId}`)
}

export async function deleteTrack(trackId: string) {
  await db.delete(tracks).where(eq(tracks.id, trackId))
  revalidatePath('/dashboard/tracks')
  redirect('/dashboard/tracks')
}

export async function bulkImportUrls(orgId: string, rawUrls: string) {
  const urls = rawUrls
    .split(/[\n,]+/)
    .map((u) => u.trim())
    .filter((u) => u.startsWith('http'))

  const results: { url: string; assetId: string; title: string }[] = []
  const errors: { url: string; error: string }[] = []

  for (const url of urls) {
    try {
      let type: 'video' | 'article' | 'image' | 'pdf' = 'article'
      let title = titleFromUrl(url)
      let thumbnailUrl: string | null = null
      let description: string | null = null

      const isYouTube = url.includes('youtube.com') || url.includes('youtu.be')
      if (isYouTube || url.includes('vimeo.com') || isCloudinaryPlayerUrl(url)) {
        type = 'video'
        if (isYouTube) {
          const videoId = extractYouTubeId(url)
          if (videoId) {
            thumbnailUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
            try {
              const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`)
              if (res.ok) {
                const d = await res.json()
                title = d.title ?? title
              }
            } catch {}
          }
        }
      } else if (/\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i.test(url)) {
        type = 'image'
        thumbnailUrl = url
      } else if (/\.pdf(\?.*)?$/i.test(url)) {
        type = 'pdf'
        thumbnailUrl = pageScreenshotUrl(url)
      } else {
        try {
          const response = await fetch(url, { headers: { 'User-Agent': 'PathFactory-Bot/1.0' } })
          if (response.ok) {
            const html = await response.text()
            const $ = cheerio.load(html)
            const ogTitle = $('meta[property="og:title"]').attr('content')
            const pageTitle = $('title').text()
            title = cleanTitle(ogTitle || pageTitle, url)
            thumbnailUrl = $('meta[property="og:image"]').attr('content') || null
            description = $('meta[property="og:description"]').attr('content')?.substring(0, 300) || null
          }
        } catch {}
        if (!thumbnailUrl) {
          thumbnailUrl = pageScreenshotUrl(url)
        }
      }

      const [asset] = await db.insert(assets).values({
        organizationId: orgId,
        type,
        title,
        description,
        sourceUrl: url,
        thumbnailUrl,
      }).returning()

      results.push({ url, assetId: asset.id, title: asset.title })
    } catch (err: unknown) {
      errors.push({ url, error: getErrorMessage(err) })
    }
  }

  revalidatePath('/dashboard/assets')
  return { results, errors }
}
