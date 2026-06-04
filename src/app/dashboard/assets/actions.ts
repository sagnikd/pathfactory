'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/db'
import { assets } from '@/db/schema'
import { eq } from 'drizzle-orm'
import * as cheerio from 'cheerio'
import { getDashboardAuthContext } from '@/lib/auth/impersonation'
import { createClient as createSupabaseClient } from '@/lib/supabase/server'

// Download external image and re-host in own Supabase Storage.
// Returns the self-hosted public URL, or the original if anything fails.
async function mirrorThumbnail(externalUrl: string, assetId: string): Promise<string> {
  try {
    const res = await fetch(externalUrl, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return externalUrl
    const contentType = res.headers.get('content-type') ?? 'image/jpeg'
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg'
    const buffer = await res.arrayBuffer()
    const supabase = await createSupabaseClient()
    const path = `thumbnails/${assetId}/thumbnail.${ext}`
    const { error } = await supabase.storage
      .from('assets')
      .upload(path, buffer, { contentType, upsert: true })
    if (error) return externalUrl
    const { data } = supabase.storage.from('assets').getPublicUrl(path)
    return data.publicUrl
  } catch {
    return externalUrl // fallback to original — better broken than missing
  }
}

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

function pageScreenshotUrl(url: string): string {
  return `https://image.thum.io/get/width/1200/crop/720/noanimate/${url}`
}

export async function addUrlAsset(organizationId: string, url: string) {
  try {
    let type: 'video' | 'article' | 'image' | 'pdf' = 'article'
    let title = titleFromUrl(url)
    let thumbnailUrl: string | null = null
    let description: string | null = null

    const isYouTube = url.includes('youtube.com') || url.includes('youtu.be')
    const isVimeo = url.includes('vimeo.com')
    const isCloudinary = isCloudinaryPlayerUrl(url)

    if (isYouTube || isVimeo || isCloudinary) {
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
      thumbnailUrl = pageScreenshotUrl(url)
    } else if (/\.(mp4|mov|webm|m4v|avi|ogv|wmv)(\?.*)?$/i.test(url)) {
      type = 'video'
      title = titleFromUrl(url)
      thumbnailUrl = pageScreenshotUrl(url)
    } else {
      try {
        const response = await fetch(url, {
          headers: { 'User-Agent': 'PathFactory-Bot/1.0' },
          signal: AbortSignal.timeout(8000),
        })
        if (response.ok) {
          const contentType = response.headers.get('content-type') ?? ''
          // Never try to parse binary/media responses as HTML
          if (!contentType.includes('text/') && !contentType.includes('html') && !contentType.includes('xml')) {
            if (contentType.startsWith('video/') || contentType.startsWith('audio/')) {
              type = 'video'
            }
            thumbnailUrl = pageScreenshotUrl(url)
            // skip HTML parsing — fall through to insert
            const [asset] = await db.insert(assets).values({
              organizationId,
              type,
              title,
              description,
              sourceUrl: url,
              thumbnailUrl,
            }).returning()
            if (thumbnailUrl) {
              const hostedUrl = await mirrorThumbnail(thumbnailUrl, asset.id)
              if (hostedUrl !== thumbnailUrl) {
                await db.update(assets).set({ thumbnailUrl: hostedUrl }).where(eq(assets.id, asset.id))
                asset.thumbnailUrl = hostedUrl
              }
            }
            revalidatePath('/dashboard/assets')
            return { success: true, asset }
          }
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
      if (!thumbnailUrl) {
        thumbnailUrl = pageScreenshotUrl(url)
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

    // Mirror external thumbnail to own storage so it never breaks if source changes
    if (thumbnailUrl) {
      const hostedUrl = await mirrorThumbnail(thumbnailUrl, asset.id)
      if (hostedUrl !== thumbnailUrl) {
        await db.update(assets).set({ thumbnailUrl: hostedUrl }).where(eq(assets.id, asset.id))
        asset.thumbnailUrl = hostedUrl
      }
    }

    revalidatePath('/dashboard/assets')
    return { success: true, asset }
  } catch (error: unknown) {
    console.error(error)
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function updateAsset(
  assetId: string,
  data: { title: string; thumbnailUrl: string | null; tags?: string[] }
) {
  try {
    const [existing] = await db.select({ metadataJson: assets.metadataJson })
      .from(assets)
      .where(eq(assets.id, assetId))

    const currentMeta = (existing?.metadataJson as Record<string, unknown> | null) ?? {}
    const normalizedTags = (data.tags ?? [])
      .map((t) => t.trim())
      .filter(Boolean)

    await db.update(assets)
      .set({
        title: data.title,
        thumbnailUrl: data.thumbnailUrl,
        metadataJson: {
          ...currentMeta,
          tags: normalizedTags,
        },
        updatedAt: new Date(),
      })
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

export async function deleteAsset(assetId: string) {
  try {
    const { dbUser } = await getDashboardAuthContext()
    const [asset] = await db.select({
      id: assets.id,
      organizationId: assets.organizationId,
      thumbnailUrl: assets.thumbnailUrl,
    })
    .from(assets)
    .where(eq(assets.id, assetId))

    if (!asset) return { success: false, error: 'Asset not found' }
    if (asset.organizationId !== dbUser.organizationId) {
      return { success: false, error: 'Not authorized to delete this asset' }
    }

    // Delete uploaded thumbnail from Supabase Storage before removing DB record
    if (asset.thumbnailUrl) {
      try {
        const supabase = await createSupabaseClient()
        const url = new URL(asset.thumbnailUrl)
        // Extract path after /object/public/assets/
        const match = url.pathname.match(/\/object\/public\/assets\/(.+)/)
        if (match) {
          await supabase.storage.from('assets').remove([match[1]])
        }
      } catch {
        // Best-effort — don't block deletion on storage cleanup failure
      }
    }

    await db.delete(assets).where(eq(assets.id, assetId))
    revalidatePath('/dashboard/assets')
    revalidatePath('/dashboard/tracks')
    return { success: true }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}
