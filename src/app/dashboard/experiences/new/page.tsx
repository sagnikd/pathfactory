import { db } from '@/db'
import { tracks } from '@/db/schema'
import { eq, desc } from 'drizzle-orm'
import { getDashboardAuthContext } from '@/lib/auth/impersonation'
import { ExperienceBuilder } from '@/components/ExperienceBuilder'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'

export default async function NewExperiencePage() {
  const { dbUser } = await getDashboardAuthContext()

  const rows = await db.select().from(tracks)
    .where(eq(tracks.organizationId, dbUser.organizationId))
    .orderBy(desc(tracks.createdAt))

  const orgTracks = rows
    .filter((t) => {
      const theme = (t.themeJson as { kind?: string } | null) ?? null
      return theme?.kind !== 'experience'
    })
    .map((t) => ({ id: t.id, title: t.title, slug: t.slug, status: t.status }))

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/experiences"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Experiences
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">New Experience</h1>
      </div>
      <ExperienceBuilder orgId={dbUser.organizationId} orgTracks={orgTracks} />
    </div>
  )
}
