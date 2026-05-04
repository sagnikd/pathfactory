import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { users, organizations, tracks } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { NavSidebar } from '@/components/NavSidebar'
import { NotificationBell } from '@/components/NotificationBell'
import { cookies } from 'next/headers'
import { IMPERSONATE_COOKIE } from '@/lib/auth/impersonation'

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? ''

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const isSuperAdmin = !!SUPER_ADMIN_EMAIL && user.email === SUPER_ADMIN_EMAIL
  const cookieStore = await cookies()
  const isImpersonating = isSuperAdmin && !!cookieStore.get(IMPERSONATE_COOKIE)?.value

  // Ensure a DB user row exists (guard DB errors so runtime doesn't white-screen)
  let dbUser: typeof users.$inferSelect | undefined
  try {
    const rows = await db.select().from(users).where(eq(users.id, user.id))
    dbUser = rows[0]
  } catch (error: unknown) {
    console.error('Dashboard DB user lookup failed:', error)
    redirect('/login?error=' + encodeURIComponent('Temporary database issue. Please try again.'))
  }

  if (!dbUser) {
    if (isSuperAdmin) {
      // Auto-provision the super-admin org (idempotent — catches duplicate slug)
      try {
        const [org] = await db.insert(organizations).values({
          name: 'Content Engagement Platform Admin',
          slug: 'pathfactory-admin',
        }).returning()
        await db.insert(users).values({
          id: user.id,
          email: user.email!,
          organizationId: org.id,
          role: 'admin',
        })
      } catch {
        // Org already exists — find it and wire up the user
        const [existing] = await db.select().from(organizations)
          .where(eq(organizations.slug, 'pathfactory-admin'))
        if (existing) {
          try {
            await db.insert(users).values({
              id: user.id,
              email: user.email!,
              organizationId: existing.id,
              role: 'admin',
            })
          } catch { /* user row already exists */ }
        }
      }
      try {
        const rows = await db.select().from(users).where(eq(users.id, user.id))
        dbUser = rows[0]
      } catch (error: unknown) {
        console.error('Dashboard super-admin auto-provision lookup failed:', error)
        redirect('/login?error=' + encodeURIComponent('Temporary database issue. Please try again.'))
      }
    } else {
      // Regular user with no org — send them to sign up again (org not created)
      redirect('/signup?error=' + encodeURIComponent('Account setup incomplete. Please sign up again.'))
    }
  }

  // Fetch org tracks for the notification bell
  const orgTracks = dbUser
    ? await db.select({ id: tracks.id, title: tracks.title })
        .from(tracks)
        .where(eq(tracks.organizationId, dbUser.organizationId))
    : []
  const orgTrackIds   = orgTracks.map(t => t.id)
  const trackTitles   = Object.fromEntries(orgTracks.map(t => [t.id, t.title]))

  return (
    <div className="flex min-h-screen w-full bg-muted/30">
      <NavSidebar isSuperAdmin={isSuperAdmin} isImpersonating={isImpersonating} />
      <div className="flex flex-col flex-1 sm:pl-60">
        {/* Top header with notification bell */}
        <header className="sticky top-0 z-20 h-14 flex items-center justify-end px-6 border-b bg-background/95 backdrop-blur shrink-0">
          <NotificationBell orgId={dbUser.organizationId} orgTrackIds={orgTrackIds} trackTitles={trackTitles} />
        </header>
        <main className="flex-1 p-6 md:p-8">
          {children}
        </main>
      </div>
    </div>
  )
}
