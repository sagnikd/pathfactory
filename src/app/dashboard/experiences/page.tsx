import { db } from '@/db'
import { organizations, tracks } from '@/db/schema'
import { eq, desc } from 'drizzle-orm'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Plus, ArrowRight } from 'lucide-react'
import { getDashboardAuthContext } from '@/lib/auth/impersonation'

function toPublicOrgSegment(slug: string): string {
  return slug.replace(/-[a-z0-9]{4}$/i, '')
}

export default async function ExperiencesPage() {
  const { dbUser } = await getDashboardAuthContext()
  const [org] = await db.select().from(organizations).where(eq(organizations.id, dbUser.organizationId))

  const rows = await db.select().from(tracks)
    .where(eq(tracks.organizationId, dbUser.organizationId))
    .orderBy(desc(tracks.createdAt))

  const experiences = rows.filter((t) => {
    const theme = (t.themeJson as { kind?: string } | null) ?? null
    return theme?.kind === 'experience'
  })
  const publicOrgSegment = org?.slug ? toPublicOrgSegment(org.slug) : ''

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Experiences</h1>
          <p className="text-muted-foreground text-sm mt-1">Build a single page with multiple tracks and searchable content</p>
        </div>
        <Link href="/dashboard/experiences/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New Experience
          </Button>
        </Link>
      </div>

      {experiences.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          No experiences yet. Create one to combine multiple tracks on one page.
        </div>
      ) : (
        <div className="grid gap-3">
          {experiences.map((exp) => (
            <div key={exp.id} className="rounded-xl border bg-card px-5 py-4 flex items-center justify-between">
              <div>
                <p className="font-medium">{exp.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">/e/{publicOrgSegment}/{exp.slug}</p>
              </div>
              <Link href={`/dashboard/experiences/${exp.id}`}>
                <Button variant="ghost" size="sm">
                  Edit <ArrowRight className="ml-1.5 h-3 w-3" />
                </Button>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
