import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { users } from '@/db/schema'
import { eq } from 'drizzle-orm'

export const IMPERSONATE_COOKIE = 'impersonate_user_id'
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? ''

export type DashboardAuthContext = {
  authUserId: string
  authEmail: string
  isSuperAdmin: boolean
  dbUser: {
    id: string
    email: string
    organizationId: string
    role: 'admin' | 'editor'
    createdAt: Date
  }
  isImpersonating: boolean
}

export async function getDashboardAuthContext(): Promise<DashboardAuthContext> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const authEmail = user.email ?? ''
  const isSuperAdmin = !!SUPER_ADMIN_EMAIL && authEmail === SUPER_ADMIN_EMAIL

  const [ownUser] = await db.select().from(users).where(eq(users.id, user.id))
  if (!ownUser) redirect('/signup?error=' + encodeURIComponent('Account setup incomplete. Please sign up again.'))

  let effectiveUser = ownUser
  let isImpersonating = false

  if (isSuperAdmin) {
    const cookieStore = await cookies()
    const impersonatedUserId = cookieStore.get(IMPERSONATE_COOKIE)?.value
    if (impersonatedUserId && impersonatedUserId !== ownUser.id) {
      const [impersonatedUser] = await db.select().from(users).where(eq(users.id, impersonatedUserId))
      if (impersonatedUser) {
        effectiveUser = impersonatedUser
        isImpersonating = true
      }
    }
  }

  return {
    authUserId: user.id,
    authEmail,
    isSuperAdmin,
    dbUser: {
      id: effectiveUser.id,
      email: effectiveUser.email,
      organizationId: effectiveUser.organizationId,
      role: effectiveUser.role,
      createdAt: effectiveUser.createdAt,
    },
    isImpersonating,
  }
}
