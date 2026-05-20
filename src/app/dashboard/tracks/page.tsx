import { db } from '@/db'
import { tracks, trackAssets } from '@/db/schema'
import { eq, desc, count } from 'drizzle-orm'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Plus, LayoutDashboard, ArrowRight } from 'lucide-react'
import { getDashboardAuthContext } from '@/lib/auth/impersonation'

export default async function TracksPage() {
  const { dbUser } = await getDashboardAuthContext()

  const orgTracks = await db.select().from(tracks)
    .where(eq(tracks.organizationId, dbUser.organizationId))
    .orderBy(desc(tracks.createdAt))
  const regularTracks = orgTracks.filter((track) => {
    const theme = (track.themeJson as { kind?: string } | null) ?? null
    return theme?.kind !== 'experience'
  })

  const assetCounts = await db
    .select({ trackId: trackAssets.trackId, count: count() })
    .from(trackAssets)
    .groupBy(trackAssets.trackId)

  const countMap = Object.fromEntries(assetCounts.map((r) => [r.trackId, r.count]))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tracks</h1>
          <p className="text-muted-foreground text-sm mt-1">Build and manage your content journeys</p>
        </div>
        <Link href="/dashboard/tracks/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New Track
          </Button>
        </Link>
      </div>

      {regularTracks.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed gap-4">
          <div className="w-12 h-12 bg-accent rounded-xl flex items-center justify-center">
            <LayoutDashboard className="w-6 h-6 text-primary" />
          </div>
          <div className="text-center space-y-1">
            <h3 className="font-semibold">No tracks yet</h3>
            <p className="text-sm text-muted-foreground">Create your first content track to get started</p>
          </div>
          <Link href="/dashboard/tracks/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Track
            </Button>
          </Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {regularTracks.map((track) => (
            <Link
              key={track.id}
              href={`/dashboard/tracks/${track.id}`}
              className="flex items-center justify-between rounded-xl border bg-card px-5 py-4 hover:border-primary/30 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="w-9 h-9 bg-accent rounded-lg flex items-center justify-center shrink-0">
                  <LayoutDashboard className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{track.title}</span>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      track.status === 'published'
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-muted-foreground'
                    }`}>
                      {track.status}
                    </span>
                    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs capitalize text-muted-foreground">
                      {track.layout}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {countMap[track.id] ?? 0} assets · /{track.slug}
                  </p>
                </div>
              </div>
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                Edit <ArrowRight className="h-3 w-3" />
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
