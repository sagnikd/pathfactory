import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Layers } from 'lucide-react'
import Link from 'next/link'

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>
}) {
  const params = await searchParams

  async function sendReset(formData: FormData) {
    'use server'
    const email = (formData.get('email') as string).trim().toLowerCase()
    const supabase = await createClient()
    const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl}/reset-password`,
    })
    if (error) {
      redirect('/forgot-password?error=' + encodeURIComponent(error.message))
    }
    redirect('/forgot-password?sent=1')
  }

  return (
    <div className="flex h-screen w-full items-center justify-center px-8 bg-background">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-primary rounded-xl flex items-center justify-center">
            <Layers className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-semibold text-xl tracking-tight">Content Engagement Platform</span>
        </div>

        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Reset your password</h1>
          <p className="text-muted-foreground text-sm">
            Enter your email and we&apos;ll send you a reset link.
          </p>
        </div>

        {params?.sent ? (
          <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
            Check your inbox — a reset link has been sent. It may take a minute to arrive.
          </div>
        ) : (
          <form action={sendReset} className="space-y-4">
            {params?.error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {params.error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email address</Label>
              <Input id="email" name="email" type="email" placeholder="you@company.com" required className="h-11" />
            </div>
            <Button type="submit" className="w-full h-11">
              Send reset link
            </Button>
          </form>
        )}

        <p className="text-center text-sm text-muted-foreground">
          <Link href="/login" className="text-primary font-medium hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
