import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { users, organizations } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { NavSidebar } from '@/components/NavSidebar'
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

  // Ensure a DB user row exists
  const [dbUser] = await db.select().from(users).where(eq(users.id, user.id))

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
    } else {
      // Regular user with no org — send them to sign up again (org not created)
      redirect('/signup?error=' + encodeURIComponent('Account setup incomplete. Please sign up again.'))
    }
  }

  return (
    <div className="flex min-h-screen w-full bg-muted/30">
      <NavSidebar isSuperAdmin={isSuperAdmin} isImpersonating={isImpersonating} />
      <div className="flex flex-col flex-1 sm:pl-60">
        <main className="flex-1 p-6 md:p-8">
          {children}
        </main>
      </div>
    </div>
  )
}
