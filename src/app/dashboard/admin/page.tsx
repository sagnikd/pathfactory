import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { organizations, users, assets, tracks } from '@/db/schema'
import { eq, count } from 'drizzle-orm'
import { OrgCard } from './OrgCard'

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? ''

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.email !== SUPER_ADMIN_EMAIL) redirect('/dashboard')

  const allOrgs = await db.select().from(organizations).orderBy(organizations.createdAt)

  const orgsWithData = await Promise.all(
    allOrgs.map(async (org) => {
      const [{ value: assetCount }] = await db
        .select({ value: count() }).from(assets).where(eq(assets.organizationId, org.id))
      const [{ value: trackCount }] = await db
        .select({ value: count() }).from(tracks).where(eq(tracks.organizationId, org.id))
      const orgUsers = await db
        .select({ id: users.id, email: users.email, role: users.role })
        .from(users).where(eq(users.organizationId, org.id))
      return {
        ...org,
        assetCount: Number(assetCount),
        trackCount: Number(trackCount),
        userCount: orgUsers.length,
        orgUsers,
      }
    })
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Admin Console</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {allOrgs.length} organisation{allOrgs.length !== 1 ? 's' : ''} — click the arrow to manage members
        </p>
      </div>

      <div className="grid gap-4">
        {orgsWithData.map(({ orgUsers, ...org }) => (
          <OrgCard key={org.id} org={org} orgUsers={orgUsers} />
        ))}

        {allOrgs.length === 0 && (
          <div className="flex h-48 items-center justify-center rounded-xl border border-dashed text-muted-foreground text-sm">
            No organisations yet
          </div>
        )}
      </div>
    </div>
  )
}
