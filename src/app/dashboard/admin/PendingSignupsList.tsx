'use client'

import { useState, useTransition } from 'react'
import { provisionUser, dismissPendingSignup } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Check, X, Clock } from 'lucide-react'

type PendingSignup = {
  id: string
  email: string
  createdAt: Date
}

export function PendingSignupsList({ pending }: { pending: PendingSignup[] }) {
  if (pending.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No pending signups — you&apos;re all caught up.
      </p>
    )
  }

  return (
    <div className="divide-y">
      {pending.map(p => (
        <PendingRow key={p.id} pending={p} />
      ))}
    </div>
  )
}

function PendingRow({ pending }: { pending: PendingSignup }) {
  const [orgName, setOrgName] = useState('')
  const [error, setError]     = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleProvision() {
    if (!orgName.trim()) { setError('Enter an organisation name'); return }
    setError(null)
    startTransition(async () => {
      const res = await provisionUser(pending.id, orgName.trim())
      if (!res.success) setError(res.error ?? 'Unknown error')
    })
  }

  function handleDismiss() {
    startTransition(async () => {
      await dismissPendingSignup(pending.id)
    })
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 py-3">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Clock className="w-4 h-4 text-amber-500 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{pending.email}</p>
          <p className="text-xs text-muted-foreground">
            {new Date(pending.createdAt).toLocaleString('en-US', {
              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            })}
          </p>
        </div>
      </div>

      <div className="flex gap-2 items-start sm:items-center flex-col sm:flex-row shrink-0">
        <div className="flex gap-2 w-full sm:w-auto">
          <Input
            placeholder="Organisation name"
            value={orgName}
            onChange={e => setOrgName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleProvision()}
            className="h-8 text-sm w-full sm:w-48"
            disabled={isPending}
          />
          <Button
            size="sm"
            className="h-8 gap-1 shrink-0"
            onClick={handleProvision}
            disabled={isPending}
          >
            <Check className="w-3.5 h-3.5" />
            Approve
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={handleDismiss}
            disabled={isPending}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  )
}
