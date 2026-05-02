'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { organizations, users } from '@/db/schema'

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

  const data = {
    email: formData.get('email') as string,
    password: formData.get('password') as string,
    orgName: formData.get('orgName') as string,
  }

  const { data: authData, error } = await supabase.auth.signUp({
    email: data.email,
    password: data.password,
  })

  if (error) {
    redirect('/signup?error=' + encodeURIComponent(error.message))
  }

  if (authData.user) {
    try {
      const slug = data.orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Math.random().toString(36).substring(2, 6);
      
      const [org] = await db.insert(organizations).values({
        name: data.orgName,
        slug: slug,
      }).returning();

      await db.insert(users).values({
        id: authData.user.id,
        email: data.email,
        organizationId: org.id,
        role: 'admin'
      });
    } catch (dbError) {
      console.error(dbError);
      redirect('/signup?error=' + encodeURIComponent('Failed to create organization'))
    }
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}
