'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Layers } from 'lucide-react'
import { Suspense } from 'react'

function ResetPasswordForm() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [loading, setLoading]   = useState(false)
  const [ready, setReady]       = useState(false)   // true once code exchanged
  const [error, setError]       = useState<string | null>(null)
  const router       = useRouter()
  const searchParams = useSearchParams()

  // Exchange the one-time code from the email link for a live session.
  // Without this step Supabase has no session and updateUser fails.
  useEffect(() => {
    const code = searchParams.get('code')
    if (!code) {
      setError('Invalid or expired reset link. Please request a new one.')
      return
    }
    const supabase = createClient()
    supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
      if (error) {
        setError('This reset link has expired or already been used. Please request a new one.')
      } else {
        setReady(true)
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 6)  { setError('Password must be at least 6 characters'); return }

    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/dashboard')
    }
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
          <h1 className="text-3xl font-bold tracking-tight">Set new password</h1>
          <p className="text-muted-foreground text-sm">Choose a new password for your account.</p>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
            {!ready && (
              <a href="/forgot-password" className="block mt-2 underline">Request a new link</a>
            )}
          </div>
        )}

        {!ready && !error && (
          <p className="text-sm text-muted-foreground animate-pulse">Verifying link…</p>
        )}

        {ready && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password" type="password" required minLength={6}
                placeholder="Min 6 characters" className="h-11"
                value={password} onChange={e => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirm password</Label>
              <Input
                id="confirm" type="password" required minLength={6}
                placeholder="Repeat password" className="h-11"
                value={confirm} onChange={e => setConfirm(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full h-11" disabled={loading}>
              {loading ? 'Updating…' : 'Update password'}
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  )
}
