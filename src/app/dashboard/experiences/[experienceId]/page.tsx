import { db } from '@/db'
import { organizations, tracks } from '@/db/schema'
import { eq, desc } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { getDashboardAuthContext } from '@/lib/auth/impersonation'
import { ExperienceBuilder } from '@/components/ExperienceBuilder'
import Link from 'next/link'
import { ChevronLeft, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { deleteExperience } from '../actions'

function toPublicOrgSegment(slug: string): string {
  return slug.replace(/-[a-z0-9]{4}$/i, '')
}

export default async function EditExperiencePage({
  params,
}: {
  params: Promise<{ experienceId: string }>
}) {
  const { experienceId } = await params
  const { dbUser } = await getDashboardAuthContext()
  const [org] = await db.select().from(organizations).where(eq(organizations.id, dbUser.organizationId))
  const publicOrgSegment = org?.slug ? toPublicOrgSegment(org.slug) : ''

  const rows = await db.select().from(tracks)
    .where(eq(tracks.organizationId, dbUser.organizationId))
    .orderBy(desc(tracks.createdAt))

  const experience = rows.find((t) => t.id === experienceId)
  if (!experience) notFound()

  const theme = (experience.themeJson as {
    kind?: string
    seoTitle?: string | null
    viewMode?: 'showcase' | 'catalog'
    bannerImageUrl?: string | null
    headline?: string | null
    subheadline?: string | null
    ctaText?: string | null
    ctaUrl?: string | null
    ctaColor?: string | null
    ctaPlacement?: 'underHeadline' | 'topLeft' | 'topRight'
    selectedTrackIds?: string[]
    sectionHeadlines?: Record<string, string>
  } | null) ?? null

  if (theme?.kind !== 'experience') notFound()

  const orgTracks = rows
    .filter((t) => t.id !== experience.id)
    .filter((t) => {
      const tTheme = (t.themeJson as { kind?: string } | null) ?? null
      return tTheme?.kind !== 'experience'
    })
    .map((t) => ({ id: t.id, title: t.title, slug: t.slug, status: t.status }))

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link
            href="/dashboard/experiences"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to Experiences
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Edit Experience</h1>
          <Link
            href={`/e/${publicOrgSegment}/${experience.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-1 text-sm text-primary hover:underline"
          >
            /e/{publicOrgSegment}/{experience.slug}
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
        <form action={deleteExperience.bind(null, experience.id)}>
          <Button type="submit" variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10">
            Delete experience
          </Button>
        </form>
      </div>

      <ExperienceBuilder
        orgId={dbUser.organizationId}
        orgTracks={orgTracks}
        initialExperience={{
          id: experience.id,
          title: experience.title,
          status: experience.status,
          seoTitle: theme?.seoTitle ?? '',
          viewMode: theme?.viewMode ?? 'showcase',
          bannerImageUrl: theme?.bannerImageUrl ?? '',
          headline: theme?.headline ?? '',
          subheadline: theme?.subheadline ?? '',
          ctaText: theme?.ctaText ?? '',
          ctaUrl: theme?.ctaUrl ?? '',
          ctaColor: theme?.ctaColor ?? '#f97316',
          ctaPlacement: theme?.ctaPlacement ?? 'underHeadline',
          selectedTrackIds: theme?.selectedTrackIds ?? [],
          sectionHeadlines: theme?.sectionHeadlines ?? {},
        }}
      />
    </div>
  )
}
