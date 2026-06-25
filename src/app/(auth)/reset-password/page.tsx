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

  // Establish a session from the recovery link. Supabase delivers the token in
  // several shapes depending on project config, so handle them all:
  //   ?code=...                        → PKCE, exchangeCodeForSession
  //   ?token_hash=...&type=recovery    → verifyOtp
  //   #access_token=...&type=recovery  → auto-detected by supabase-js (hash)
  useEffect(() => {
    const supabase = createClient()
    const expired = 'This reset link is invalid, expired, or already used. Please request a new one.'

    // Hash-token links are auto-detected by supabase-js and fire an auth event
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setReady(true)
    })

    ;(async () => {
      const code = searchParams.get('code')
      const tokenHash = searchParams.get('token_hash')
      const type = searchParams.get('type')

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) setError(expired); else setReady(true)
        return
      }
      if (tokenHash) {
        const { error } = await supabase.auth.verifyOtp({
          type: (type as 'recovery') || 'recovery',
          token_hash: tokenHash,
        })
        if (error) setError(expired); else setReady(true)
        return
      }
      // No query token — maybe a hash-based link; give supabase-js a moment to
      // detect it, then check for a live session.
      const { data } = await supabase.auth.getSession()
      if (data.session) {
        setReady(true)
      } else {
        setTimeout(async () => {
          const { data: retry } = await supabase.auth.getSession()
          if (retry.session) setReady(true)
          else setError('Invalid or expired reset link. Please request a new one.')
        }, 600)
      }
    })()

    return () => sub.subscription.unsubscribe()
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
