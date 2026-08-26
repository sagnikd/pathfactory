'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useState, useRef, useEffect } from 'react'
import { ListFilter, ChevronDown, X, Check } from 'lucide-react'

export function TrackFilter({ tracks }: { tracks: { id: string; title: string }[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const rawParam = searchParams.get('trackIds') ?? ''
  const urlIds = rawParam.split(',').filter(Boolean)

  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  // Local pending state — immediate checkbox feedback without page reload per click
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set(urlIds))
  const containerRef = useRef<HTMLDivElement>(null)

  // Sync pendingIds from URL whenever dropdown is closed (handles back/forward)
  useEffect(() => {
    if (!open) {
      setPendingIds(new Set(urlIds))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawParam])

  function applyAndClose() {
    setOpen(false)
    setSearch('')
    const urlStr = [...urlIds].sort().join(',')
    const pendingStr = [...pendingIds].sort().join(',')
    if (urlStr === pendingStr) return
    const sp = new URLSearchParams(searchParams.toString())
    if (pendingIds.size > 0) sp.set('trackIds', [...pendingIds].join(','))
    else sp.delete('trackIds')
    router.push(`${pathname}?${sp.toString()}`)
    router.refresh()
  }

  function clearAll() {
    setPendingIds(new Set())
    const sp = new URLSearchParams(searchParams.toString())
    sp.delete('trackIds')
    router.push(`${pathname}?${sp.toString()}`)
    router.refresh()
  }

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        applyAndClose()
      }
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pendingIds, rawParam])

  function toggleTrack(id: string) {
    setPendingIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const filtered = tracks.filter(t =>
    t.title.toLowerCase().includes(search.toLowerCase())
  )

  const label =
    pendingIds.size === 0
      ? 'All tracks'
      : pendingIds.size === 1
      ? (tracks.find(t => t.id === [...pendingIds][0])?.title ?? '1 track')
      : `${pendingIds.size} tracks`

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 h-8 px-3 text-xs border border-input rounded-md bg-background hover:bg-accent transition-colors"
      >
        <ListFilter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="max-w-[160px] truncate">{label}</span>
        {pendingIds.size > 0 && (
          <span
            role="button"
            tabIndex={0}
            onClick={e => { e.stopPropagation(); clearAll() }}
            onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); clearAll() } }}
            className="ml-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="w-3 h-3" />
          </span>
        )}
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+4px)] z-50 w-64 rounded-md border border-border bg-popover shadow-md">
          <div className="p-2 border-b border-border">
            <input
              autoFocus
              type="text"
              placeholder="Search tracks..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full h-7 px-2 text-xs rounded border border-input bg-background outline-none"
            />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">No tracks found</div>
            ) : (
              filtered.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleTrack(t.id)}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent text-left"
                >
                  <span className={`flex items-center justify-center w-3.5 h-3.5 rounded border shrink-0 ${pendingIds.has(t.id) ? 'bg-primary border-primary text-primary-foreground' : 'border-input'}`}>
                    {pendingIds.has(t.id) && <Check className="w-2.5 h-2.5" />}
                  </span>
                  <span className="truncate">{t.title}</span>
                </button>
              ))
            )}
          </div>
          <div className="p-2 border-t border-border flex gap-2">
            {pendingIds.size > 0 && (
              <button
                type="button"
                onClick={() => setPendingIds(new Set())}
                className="flex-1 h-6 text-xs text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={applyAndClose}
              className="flex-1 h-6 text-xs font-medium bg-primary text-primary-foreground rounded hover:opacity-90"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
