'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { deleteAbmAccount, updateAbmAccount } from './actions'

type AbmAccountRow = {
  id: string
  accountName: string
  domains: string[]
  priority: string
  ownerEmail: string | null
  notes: string | null
  status: string
}

export default function AbmAccountsEditor({ accounts }: { accounts: AbmAccountRow[] }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const handleSave = (formData: FormData) => {
    startTransition(async () => {
      await updateAbmAccount(formData)
      setEditingId(null)
      router.refresh()
    })
  }

  const handleDelete = (formData: FormData) => {
    if (!window.confirm('Delete this ABM account? This cannot be undone.')) return
    startTransition(async () => {
      await deleteAbmAccount(formData)
      if (editingId === String(formData.get('accountId') ?? '')) setEditingId(null)
      router.refresh()
    })
  }

  return (
    <div className="space-y-2">
      {accounts.map((a) => {
        const isEditing = editingId === a.id
        return (
          <div key={a.id} className="rounded-lg border p-3 space-y-3">
            {!isEditing ? (
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{a.accountName}</div>
                  <div className="text-xs text-muted-foreground mt-1">Domains: {a.domains.join(', ') || '—'}</div>
                  <div className="text-xs text-muted-foreground">Priority: {a.priority} • Status: {a.status}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => setEditingId(a.id)}>
                  <Pencil className="h-3.5 w-3.5 mr-1.5" />
                  Edit
                </Button>
              </div>
            ) : (
              <form action={handleSave} className="grid gap-3 md:grid-cols-2">
                <input type="hidden" name="accountId" value={a.id} />
                <div className="space-y-1.5">
                  <Label>Account name</Label>
                  <Input name="accountName" defaultValue={a.accountName} required />
                </div>
                <div className="space-y-1.5">
                  <Label>Domains</Label>
                  <Input name="domains" defaultValue={a.domains.join(', ')} required />
                </div>
                <div className="space-y-1.5">
                  <Label>Priority</Label>
                  <Input name="priority" defaultValue={a.priority} />
                </div>
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Input name="status" defaultValue={a.status} />
                </div>
                <div className="space-y-1.5">
                  <Label>Owner email</Label>
                  <Input name="ownerEmail" type="email" defaultValue={a.ownerEmail ?? ''} />
                </div>
                <div className="space-y-1.5">
                  <Label>Notes</Label>
                  <Input name="notes" defaultValue={a.notes ?? ''} />
                </div>
                <div className="md:col-span-2 flex items-center gap-2">
                  <Button size="sm" type="submit" disabled={isPending}>Save changes</Button>
                  <Button size="sm" variant="outline" type="button" onClick={() => setEditingId(null)} disabled={isPending}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}

            <form action={handleDelete}>
              <input type="hidden" name="accountId" value={a.id} />
              <Button variant="destructive" size="sm" type="submit" disabled={isPending}>Delete</Button>
            </form>
          </div>
        )
      })}
    </div>
  )
}
