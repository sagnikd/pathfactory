import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { organizations, users, assets, tracks, pendingSignups } from '@/db/schema'
import { eq, count } from 'drizzle-orm'
import { OrgCard } from './OrgCard'
import { PendingSignupsList } from './PendingSignupsList'

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? ''

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.email !== SUPER_ADMIN_EMAIL) redirect('/dashboard')

  const pending = await db.select().from(pendingSignups).orderBy(pendingSignups.createdAt)

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
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Admin Console</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {allOrgs.length} organisation{allOrgs.length !== 1 ? 's' : ''} · {pending.length} pending
        </p>
      </div>

      {/* Pending signups */}
      <div className="rounded-xl border bg-card">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div>
            <h2 className="font-semibold text-sm">Pending Signups</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Approve a signup by entering an organisation name and clicking Approve.
            </p>
          </div>
          {pending.length > 0 && (
            <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-700 text-xs font-semibold px-2.5 py-0.5">
              {pending.length} waiting
            </span>
          )}
        </div>
        <div className="px-5">
          <PendingSignupsList pending={pending} />
        </div>
      </div>

      {/* Organisations */}
      <div className="space-y-4">
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
          Organisations
        </h2>
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
    </div>
  )
}
