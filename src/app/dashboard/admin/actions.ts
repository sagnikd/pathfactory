'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { users, organizations, pendingSignups } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { IMPERSONATE_COOKIE } from '@/lib/auth/impersonation'

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

/** Permanently delete an organization and all linked data (cascade). */
export async function deleteOrganization(
  orgId: string
): Promise<{ success: boolean; error?: string }> {
  await assertSuperAdmin()

  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId))
  if (!org) return { success: false, error: 'Organisation not found' }

  // Keep the bootstrap super-admin org protected.
  if (org.slug === 'pathfactory-admin') {
    return { success: false, error: 'Cannot delete the super admin organisation.' }
  }

  await db.delete(organizations).where(eq(organizations.id, orgId))
  revalidatePath('/dashboard/admin')
  return { success: true }
}

export async function impersonateUser(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  await assertSuperAdmin()

  const [target] = await db.select().from(users).where(eq(users.id, userId))
  if (!target) return { success: false, error: 'User not found' }

  const cookieStore = await cookies()
  cookieStore.set(IMPERSONATE_COOKIE, target.id, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 8,
  })

  revalidatePath('/dashboard')
  return { success: true }
}

export async function stopImpersonation(): Promise<{ success: boolean }> {
  await assertSuperAdmin()
  const cookieStore = await cookies()
  cookieStore.delete(IMPERSONATE_COOKIE)
  revalidatePath('/dashboard')
  return { success: true }
}

/**
 * Provision a pending signup: create a new org with the given name and
 * wire up the user row so they can log in to the dashboard.
 */
export async function provisionUser(
  pendingId: string,
  orgName: string
): Promise<{ success: boolean; error?: string }> {
  await assertSuperAdmin()

  const trimmed = orgName.trim()
  if (!trimmed) return { success: false, error: 'Organisation name is required' }

  const [pending] = await db.select().from(pendingSignups).where(eq(pendingSignups.id, pendingId))
  if (!pending) return { success: false, error: 'Pending signup not found' }

  try {
    const slug =
      trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-') +
      '-' +
      Math.random().toString(36).substring(2, 6)

    const [org] = await db.insert(organizations).values({ name: trimmed, slug }).returning()

    await db.insert(users).values({
      id: pending.authUserId,
      email: pending.email,
      organizationId: org.id,
      role: 'admin',
    })

    await db.delete(pendingSignups).where(eq(pendingSignups.id, pendingId))

    revalidatePath('/dashboard/admin')
    return { success: true }
  } catch (err) {
    console.error('[provisionUser]', err)
    return { success: false, error: 'Failed to provision — check logs.' }
  }

}

/** Dismiss/reject a pending signup without provisioning them. */
export async function dismissPendingSignup(
  pendingId: string
): Promise<{ success: boolean; error?: string }> {
  await assertSuperAdmin()
  await db.delete(pendingSignups).where(eq(pendingSignups.id, pendingId))
  revalidatePath('/dashboard/admin')
  return { success: true }
}
