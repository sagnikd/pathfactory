'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { users, organizations } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? ''

async function assertSuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.email !== SUPER_ADMIN_EMAIL) redirect('/dashboard')
}

/** Add an existing user (by email) to an org, or change their org. */
export async function addUserToOrg(
  orgId: string,
  email: string,
  role: 'admin' | 'editor'
): Promise<{ success: boolean; error?: string; user?: { id: string; email: string; role: string } }> {
  await assertSuperAdmin()

  if (!email.trim()) return { success: false, error: 'Email is required' }

  // Check org exists
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId))
  if (!org) return { success: false, error: 'Organisation not found' }

  // Find user by email in our users table
  const [existingUser] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()))

  if (!existingUser) {
    return {
      success: false,
      error: `No account found for ${email}. Ask them to sign up first, then add them here.`,
    }
  }

  // Update their org
  await db.update(users)
    .set({ organizationId: orgId, role })
    .where(eq(users.email, email.trim().toLowerCase()))

  revalidatePath('/dashboard/admin')
  return { success: true, user: { id: existingUser.id, email: existingUser.email, role } }
}

/** Remove a user from an org (soft-delete: move to admin org so they don't lose access). */
export async function removeUserFromOrg(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  await assertSuperAdmin()

  await db.delete(users).where(eq(users.id, userId))

  revalidatePath('/dashboard/admin')
  return { success: true }
}
