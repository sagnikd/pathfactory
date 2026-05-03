'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/db'
import { assets } from '@/db/schema'
import { eq } from 'drizzle-orm'
import * as cheerio from 'cheerio'

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v')
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('?')[0] || null
  } catch {}
  return null
}

function cleanTitle(raw: string, fallbackUrl: string): string {
  if (!raw) return titleFromUrl(fallbackUrl)
  // Strip everything after common nav separators injected by some CMSes
  const cleaned = raw
    .split(/\s*\|\s*|\s+menua\/|\s+menu[A-Z]|\s+-\s+[A-Z]{2,}/).shift()!
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.substring(0, 120) || titleFromUrl(fallbackUrl)
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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

export async function addUrlAsset(organizationId: string, url: string) {
  try {
    let type: 'video' | 'article' | 'image' | 'pdf' = 'article'
    let title = titleFromUrl(url)
    let thumbnailUrl: string | null = null
    let description: string | null = null

    const isYouTube = url.includes('youtube.com') || url.includes('youtu.be')
    const isVimeo = url.includes('vimeo.com')

    if (isYouTube || isVimeo) {
      type = 'video'

      if (isYouTube) {
        const videoId = extractYouTubeId(url)
        if (videoId) {
          thumbnailUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
          try {
            const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`)
            if (res.ok) {
              const data = await res.json()
              title = data.title ?? title
            }
          } catch {}
        }
      }
    } else if (/\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i.test(url)) {
      type = 'image'
      thumbnailUrl = url
      title = titleFromUrl(url)
    } else if (/\.pdf(\?.*)?$/i.test(url)) {
      type = 'pdf'
      title = titleFromUrl(url)
    } else {
      try {
        const response = await fetch(url, {
          headers: { 'User-Agent': 'PathFactory-Bot/1.0' },
          signal: AbortSignal.timeout(8000),
        })
        if (response.ok) {
          const html = await response.text()
          const $ = cheerio.load(html)
          const ogTitle = $('meta[property="og:title"]').attr('content')
          const ogImage = $('meta[property="og:image"]').attr('content')
          const ogDesc = $('meta[property="og:description"]').attr('content')
          const pageTitle = $('title').text()

          // og:title is usually cleaner than <title> which can include nav
          title = cleanTitle(ogTitle || pageTitle, url)
          thumbnailUrl = ogImage || null
          description = ogDesc?.substring(0, 300) || null
        }
      } catch (e) {
        console.error('Failed to scrape URL', e)
      }
    }

    const [asset] = await db.insert(assets).values({
      organizationId,
      type,
      title,
      description,
      sourceUrl: url,
      thumbnailUrl,
    }).returning()

    revalidatePath('/dashboard/assets')
    return { success: true, asset }
  } catch (error: unknown) {
    console.error(error)
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function updateAsset(
  assetId: string,
  data: { title: string; thumbnailUrl: string | null }
) {
  try {
    await db.update(assets)
      .set({ title: data.title, thumbnailUrl: data.thumbnailUrl, updatedAt: new Date() })
      .where(eq(assets.id, assetId))
    revalidatePath('/dashboard/assets')
    return { success: true }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function addFileAsset(
  organizationId: string,
  fileData: { fileUrl: string; title: string; type: 'pdf' | 'image' | 'video'; thumbnailUrl?: string }
) {
  try {
    const [asset] = await db.insert(assets).values({
      organizationId,
      type: fileData.type,
      title: fileData.title,
      fileUrl: fileData.fileUrl,
      thumbnailUrl: fileData.thumbnailUrl ?? null,
    }).returning()

    revalidatePath('/dashboard/assets')
    return { success: true, asset }
  } catch (error: unknown) {
    console.error(error)
    return { success: false, error: getErrorMessage(error) }
  }
}
