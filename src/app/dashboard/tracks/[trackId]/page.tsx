import { db } from '@/db'
import { assets, tracks, trackAssets, organizations } from '@/db/schema'
import { eq, desc, asc } from 'drizzle-orm'
import { TrackBuilder } from '@/components/TrackBuilder'
import Link from 'next/link'
import { ChevronLeft, ExternalLink } from 'lucide-react'
import { notFound } from 'next/navigation'
import { deleteTrack } from '../actions'
import { Button } from '@/components/ui/button'
import { getDashboardAuthContext } from '@/lib/auth/impersonation'

export default async function EditTrackPage({
  params,
}: {
  params: Promise<{ trackId: string }>
}) {
  const { trackId } = await params

  const { dbUser } = await getDashboardAuthContext()

  const [org] = await db.select().from(organizations).where(eq(organizations.id, dbUser.organizationId))

  const [track] = await db.select().from(tracks)
    .where(eq(tracks.id, trackId))

  if (!track || track.organizationId !== dbUser.organizationId) notFound()

  const orgAssets = await db.select().from(assets)
    .where(eq(assets.organizationId, dbUser.organizationId))
    .orderBy(desc(assets.createdAt))

  const orderedTrackAssets = await db.select({
    assetId: trackAssets.assetId,
    displayTitle: trackAssets.displayTitle,
    subCopy: trackAssets.subCopy,
  }).from(trackAssets)
    .where(eq(trackAssets.trackId, trackId))
    .orderBy(asc(trackAssets.position))

  const assetIds = orderedTrackAssets.map((ta) => ta.assetId)
  const assetOverrides = Object.fromEntries(
    orderedTrackAssets
      .filter((ta) => ta.displayTitle || ta.subCopy)
      .map((ta) => [ta.assetId, { displayTitle: ta.displayTitle ?? undefined, subCopy: ta.subCopy ?? undefined }])
  )

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link
            href="/dashboard/tracks"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to Tracks
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Edit Track</h1>
          <Link
            href={`/t/${org?.slug}/${track.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-1 text-sm text-primary hover:underline"
          >
            /t/{org?.slug}/{track.slug}
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
        <form action={deleteTrack.bind(null, trackId)}>
          <Button type="submit" variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10">
            Delete track
          </Button>
        </form>
      </div>
      <TrackBuilder
        orgId={dbUser.organizationId}
        orgAssets={orgAssets}
        initialTrack={{
          id: track.id,
          title: track.title,
          layout: track.layout,
          status: track.status,
          assetIds,
          assetOverrides,
          themeJson: (track.themeJson as ({
            seoTitle?: string
          } & Record<string, unknown>) | null) ?? null,
          gateConfigJson: track.gateConfigJson as null | {
            enabled: boolean
            delaySeconds: number
            heading: string
            description: string
            fields: Array<{
              name: string
              label: string
              type: 'email' | 'text' | 'tel'
              enabled: boolean
              required: boolean
            }>
          },
        }}
      />
    </div>
  )
}
