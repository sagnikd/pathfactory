'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function GateOverlay({ trackId, visitorId, children, enabled = true }: any) {
  const [unlocked, setUnlocked] = useState(!enabled)
  const [loading, setLoading] = useState(false)
  const [email, setEmail] = useState('')

  useEffect(() => {
    if (!enabled) return;
    const isUnlocked = localStorage.getItem(`unlocked_${trackId}`)
    if (isUnlocked === 'true') {
      setUnlocked(true)
    }
  }, [trackId, enabled])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId, visitorId, email })
      })
      if (res.ok) {
        localStorage.setItem(`unlocked_${trackId}`, 'true')
        setUnlocked(true)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  if (unlocked) {
    return <>{children}</>
  }

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* Blurred background content */}
      <div className="absolute inset-0 filter blur-md pointer-events-none opacity-30 select-none">
        {children}
      </div>
      
      {/* Form overlay */}
      <div className="absolute inset-0 flex items-center justify-center z-10 p-4 bg-background/40 backdrop-blur-sm">
        <Card className="w-full max-w-md shadow-2xl border-2">
          <CardHeader>
            <CardTitle>Access this content</CardTitle>
            <CardDescription>
              Please enter your email to continue viewing this track.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="email">Email address</Label>
                <Input 
                  id="email" 
                  type="email" 
                  required 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com" 
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Submitting...' : 'Continue'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
