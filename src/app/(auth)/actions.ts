'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { pendingSignups } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { isPersonalEmail } from '@/lib/workEmail'

export async function login(formData: FormData) {
  const supabase = await createClient()

  const data = {
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  }

  const { error } = await supabase.auth.signInWithPassword(data)

  if (error) {
    redirect('/login?error=' + encodeURIComponent(error.message))
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}

export async function signup(formData: FormData) {
  const supabase = await createClient()

  const email    = (formData.get('email')    as string).trim().toLowerCase()
  const password =  formData.get('password') as string

  if (isPersonalEmail(email)) {
    redirect('/signup?error=' + encodeURIComponent('Please use your work email address to sign up.'))
  }

  const { data: authData, error } = await supabase.auth.signUp({ email, password })

  if (error) {
    redirect('/signup?error=' + encodeURIComponent(error.message))
  }

  if (authData.user) {
    try {
      // Upsert so re-submitting after email confirmation doesn't error
      await db.insert(pendingSignups)
        .values({ authUserId: authData.user.id, email })
        .onConflictDoNothing()
    } catch (dbError) {
      console.error('[signup] pending_signups insert failed:', dbError)
      // Don't block the user — they still have an auth account
    }
  }

  // Don't grant dashboard access until super admin provisions an org
  redirect('/pending')
}
