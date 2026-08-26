'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useState, useRef, useEffect } from 'react'
import { ListFilter, ChevronDown, X, Check } from 'lucide-react'

export function TrackFilter({ tracks }: { tracks: { id: string; title: string }[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const rawParam = searchParams.get('trackIds') ?? ''
  const selectedIds = new Set(rawParam.split(',').filter(Boolean))

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function push(ids: Set<string>) {
    const sp = new URLSearchParams(searchParams.toString())
    if (ids.size > 0) sp.set('trackIds', Array.from(ids).join(','))
    else sp.delete('trackIds')
    router.push(`${pathname}?${sp.toString()}`)
    router.refresh()
  }

  function toggleTrack(id: string) {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    push(next)
  }

  function clearAll() {
    push(new Set())
  }

  const filtered = tracks.filter(t =>
    t.title.toLowerCase().includes(search.toLowerCase())
  )

  const label =
    selectedIds.size === 0
      ? 'All tracks'
      : selectedIds.size === 1
      ? (tracks.find(t => t.id === [...selectedIds][0])?.title ?? '1 track')
      : `${selectedIds.size} tracks`

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 h-8 px-3 text-xs border border-input rounded-md bg-background hover:bg-accent transition-colors"
      >
        <ListFilter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="max-w-[160px] truncate">{label}</span>
        {selectedIds.size > 0 && (
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
                  <span className={`flex items-center justify-center w-3.5 h-3.5 rounded border shrink-0 ${selectedIds.has(t.id) ? 'bg-primary border-primary text-primary-foreground' : 'border-input'}`}>
                    {selectedIds.has(t.id) && <Check className="w-2.5 h-2.5" />}
                  </span>
                  <span className="truncate">{t.title}</span>
                </button>
              ))
            )}
          </div>
          {selectedIds.size > 0 && (
            <div className="p-2 border-t border-border">
              <button
                type="button"
                onClick={clearAll}
                className="w-full h-6 text-xs text-muted-foreground hover:text-foreground"
              >
                Clear selection
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
