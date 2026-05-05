import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { users } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { Layers, Clock } from 'lucide-react'
import Link from 'next/link'

export default async function PendingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Not logged in → go sign up
  if (!user) redirect('/signup')

  // Already has an org → go to dashboard
  const rows = await db.select().from(users).where(eq(users.id, user.id))
  if (rows[0]) redirect('/dashboard')

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background px-4">
      <div className="w-full max-w-md text-center space-y-6">
        {/* Logo */}
        <div className="flex justify-center">
          <div className="w-14 h-14 bg-primary rounded-2xl flex items-center justify-center shadow-lg">
            <Layers className="w-7 h-7 text-primary-foreground" />
          </div>
        </div>

        {/* Icon + heading */}
        <div className="space-y-3">
          <div className="flex justify-center">
            <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
              <Clock className="w-6 h-6 text-amber-600" />
            </div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Your account is pending approval</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Thanks for signing up! Our team will review your request and activate
            your workspace. You&apos;ll be able to sign in once it&apos;s ready.
          </p>
        </div>

        {/* Info box */}
        <div className="rounded-xl border bg-muted/40 px-5 py-4 text-sm text-muted-foreground text-left space-y-1">
          <p className="font-medium text-foreground">What happens next?</p>
          <ul className="space-y-1 mt-2 list-disc list-inside">
            <li>Our team reviews your signup request</li>
            <li>We set up your organisation workspace</li>
            <li>You&apos;ll receive an email once access is granted</li>
          </ul>
        </div>

        <p className="text-xs text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{user.email}</span>.{' '}
          <Link href="/api/auth/signout" className="text-primary hover:underline">
            Sign out
          </Link>
        </p>
      </div>
    </div>
  )
}
