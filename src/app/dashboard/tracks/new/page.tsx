import { db } from '@/db'
import { assets, users } from '@/db/schema'
import { eq, desc } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { TrackBuilder } from '@/components/TrackBuilder'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'

export default async function NewTrackPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [dbUser] = await db.select().from(users).where(eq(users.id, user.id))
  if (!dbUser) return null

  const orgAssets = await db.select().from(assets)
    .where(eq(assets.organizationId, dbUser.organizationId))
    .orderBy(desc(assets.createdAt))

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/tracks"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Tracks
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">New Track</h1>
        <p className="text-muted-foreground text-sm mt-1">Build a content journey for your visitors</p>
      </div>
      <TrackBuilder orgId={dbUser.organizationId} orgAssets={orgAssets} />
    </div>
  )
}
