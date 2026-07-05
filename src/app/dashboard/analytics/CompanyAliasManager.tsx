'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Link2, X, Loader2 } from 'lucide-react'
import { mergeCompanies, deleteCompanyAlias } from './actions'

export type CompanyAlias = { id: string; aliasName: string; canonicalName: string }

export function CompanyAliasManager({ allCompanyNames, aliases }: {
  allCompanyNames: string[]
  aliases: CompanyAlias[]
}) {
  const [open, setOpen] = useState(false)
  const [aliasName, setAliasName] = useState('')
  const [canonicalName, setCanonicalName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [deletingId, setDeletingId] = useState<string | null>(null)

  function handleMerge() {
    setError(null)
    startTransition(async () => {
      const res = await mergeCompanies(aliasName, canonicalName)
      if (!res.success) { setError(res.error ?? 'Could not merge'); return }
      setAliasName('')
      setCanonicalName('')
    })
  }

  function handleDelete(id: string) {
    setDeletingId(id)
    startTransition(async () => {
      await deleteCompanyAlias(id)
      setDeletingId(null)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium hover:bg-muted transition-colors">
        <Link2 className="w-3.5 h-3.5" />
        Merge accounts
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Merge company names</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">
          For names automatic matching misses (e.g. &quot;HCLTech&quot; and &quot;HCL Technologies&quot; share no
          common words). Pick the name to fold in, and the name it should count toward.
        </p>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Fold this name in</label>
            <Select value={aliasName} onValueChange={(v) => setAliasName(v ?? '')}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a name…" />
              </SelectTrigger>
              <SelectContent>
                {allCompanyNames.map(name => (
                  <SelectItem key={name} value={name}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Count it toward</label>
            <Select value={canonicalName} onValueChange={(v) => setCanonicalName(v ?? '')}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a name…" />
              </SelectTrigger>
              <SelectContent>
                {allCompanyNames.map(name => (
                  <SelectItem key={name} value={name}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button onClick={handleMerge} disabled={!aliasName || !canonicalName || isPending} size="sm" className="w-full">
            {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Merge'}
          </Button>
        </div>

        {aliases.length > 0 && (
          <div className="space-y-1.5 border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground">Existing merges</p>
            <ul className="space-y-1 max-h-40 overflow-y-auto">
              {aliases.map(a => (
                <li key={a.id} className="flex items-center justify-between gap-2 text-xs bg-muted/40 rounded px-2 py-1.5">
                  <span className="truncate">
                    <span className="font-medium">{a.aliasName}</span>
                    <span className="text-muted-foreground"> → {a.canonicalName}</span>
                  </span>
                  <button
                    onClick={() => handleDelete(a.id)}
                    disabled={isPending}
                    className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                    title="Remove merge"
                  >
                    {deletingId === a.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
