'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { tracks, trackAssets, assets } from '@/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import * as cheerio from 'cheerio'

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v')
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('?')[0] || null
  } catch {}
  return null
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
  const cleaned = raw
    .split(/\s*\|\s*|\s+menua\/|\s+menu[A-Z]|\s+-\s+[A-Z]{2,}/).shift()!
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.substring(0, 120) || titleFromUrl(fallbackUrl)
}

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 64)
}

export async function createTrack(
  orgId: string,
  data: { title: string; layout: 'binge' | 'hub' | 'single'; status: 'draft' | 'published' },
  assetIds: string[],
  gateConfigJson?: object | null
) {
  const slug = slugify(data.title) + '-' + Math.random().toString(36).substring(2, 6)

  const [track] = await db.insert(tracks).values({
    organizationId: orgId,
    title: data.title,
    slug,
    layout: data.layout,
    status: data.status,
    gateConfigJson: gateConfigJson ?? null,
  }).returning()

  if (assetIds.length > 0) {
    await db.insert(trackAssets).values(
      assetIds.map((assetId, i) => ({ trackId: track.id, assetId, position: i }))
    )
  }

  revalidatePath('/dashboard/tracks')
  redirect(`/dashboard/tracks/${track.id}`)
}

export async function updateTrack(
  trackId: string,
  data: { title: string; layout: 'binge' | 'hub' | 'single'; status: 'draft' | 'published' },
  assetIds: string[],
  gateConfigJson?: object | null
) {
  await db.update(tracks)
    .set({ title: data.title, layout: data.layout, status: data.status, gateConfigJson: gateConfigJson ?? null, updatedAt: new Date() })
    .where(eq(tracks.id, trackId))

  await db.delete(trackAssets).where(eq(trackAssets.trackId, trackId))

  if (assetIds.length > 0) {
    await db.insert(trackAssets).values(
      assetIds.map((assetId, i) => ({ trackId, assetId, position: i }))
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
      if (isYouTube || url.includes('vimeo.com')) {
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
    } catch (err: any) {
      errors.push({ url, error: err.message })
    }
  }

  revalidatePath('/dashboard/assets')
  return { results, errors }
}
