'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { tracks } from '@/db/schema'
import { eq } from 'drizzle-orm'

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 64)
}

type ExperienceTheme = {
  kind: 'experience'
  seoTitle: string | null
  viewMode: 'showcase' | 'catalog'
  bannerImageUrl: string | null
  headline: string | null
  subheadline: string | null
  ctaText: string | null
  ctaUrl: string | null
  ctaColor: string | null
  ctaPlacement: 'underHeadline' | 'topLeft' | 'topRight'
  selectedTrackIds: string[]
  sectionHeadlines: Record<string, string>
}

export async function createExperience(
  orgId: string,
  data: {
    title: string
    status: 'draft' | 'published'
    seoTitle: string
    viewMode: 'showcase' | 'catalog'
    bannerImageUrl: string
    headline: string
    subheadline: string
    ctaText: string
    ctaUrl: string
    ctaColor: string
    ctaPlacement: 'underHeadline' | 'topLeft' | 'topRight'
    selectedTrackIds: string[]
    sectionHeadlines: Record<string, string>
  }
) {
  const slug = slugify(data.title) + '-' + Math.random().toString(36).substring(2, 6)

  const themeJson: ExperienceTheme = {
    kind: 'experience',
    seoTitle: data.seoTitle.trim() || null,
    viewMode: data.viewMode,
    bannerImageUrl: data.bannerImageUrl.trim() || null,
    headline: data.headline.trim() || null,
    subheadline: data.subheadline.trim() || null,
    ctaText: data.ctaText.trim() || null,
    ctaUrl: data.ctaUrl.trim() || null,
    ctaColor: data.ctaColor.trim() || null,
    ctaPlacement: data.ctaPlacement,
    selectedTrackIds: data.selectedTrackIds,
    sectionHeadlines: data.sectionHeadlines,
  }

  const [experience] = await db.insert(tracks).values({
    organizationId: orgId,
    title: data.title,
    slug,
    layout: 'hub',
    status: data.status,
    gateConfigJson: null,
    themeJson,
  }).returning()

  revalidatePath('/dashboard/experiences')
  redirect(`/dashboard/experiences/${experience.id}`)
}

export async function updateExperience(
  experienceId: string,
  data: {
    title: string
    status: 'draft' | 'published'
    seoTitle: string
    viewMode: 'showcase' | 'catalog'
    bannerImageUrl: string
    headline: string
    subheadline: string
    ctaText: string
    ctaUrl: string
    ctaColor: string
    ctaPlacement: 'underHeadline' | 'topLeft' | 'topRight'
    selectedTrackIds: string[]
    sectionHeadlines: Record<string, string>
  }
) {
  const themeJson: ExperienceTheme = {
    kind: 'experience',
    seoTitle: data.seoTitle.trim() || null,
    viewMode: data.viewMode,
    bannerImageUrl: data.bannerImageUrl.trim() || null,
    headline: data.headline.trim() || null,
    subheadline: data.subheadline.trim() || null,
    ctaText: data.ctaText.trim() || null,
    ctaUrl: data.ctaUrl.trim() || null,
    ctaColor: data.ctaColor.trim() || null,
    ctaPlacement: data.ctaPlacement,
    selectedTrackIds: data.selectedTrackIds,
    sectionHeadlines: data.sectionHeadlines,
  }

  await db.update(tracks)
    .set({
      title: data.title,
      status: data.status,
      themeJson,
      updatedAt: new Date(),
    })
    .where(eq(tracks.id, experienceId))

  revalidatePath('/dashboard/experiences')
  revalidatePath(`/dashboard/experiences/${experienceId}`)
}

export async function deleteExperience(experienceId: string) {
  await db.delete(tracks).where(eq(tracks.id, experienceId))
  revalidatePath('/dashboard/experiences')
  redirect('/dashboard/experiences')
}
