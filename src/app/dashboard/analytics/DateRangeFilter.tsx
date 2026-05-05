'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback } from 'react'
import { CalendarIcon } from 'lucide-react'

const PRESETS = [
  { label: 'Last 7 days',  days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'All time',     days: 0 },
]

function toDateInput(d: Date) {
  return d.toISOString().slice(0, 10)
}

export function DateRangeFilter() {
  const router     = useRouter()
  const pathname   = usePathname()
  const searchParams = useSearchParams()

  const from = searchParams.get('from') ?? ''
  const to   = searchParams.get('to')   ?? ''

  const push = useCallback((params: Record<string, string>) => {
    const sp = new URLSearchParams(searchParams.toString())
    Object.entries(params).forEach(([k, v]) => {
      if (v) sp.set(k, v); else sp.delete(k)
    })
    router.push(`${pathname}?${sp.toString()}`)
  }, [router, pathname, searchParams])

  function applyPreset(days: number) {
    if (days === 0) {
      push({ from: '', to: '' })
    } else {
      const now   = new Date()
      const start = new Date(now)
      start.setDate(now.getDate() - days)
      push({ from: toDateInput(start), to: toDateInput(now) })
    }
  }

  // Which preset is currently active?
  function activePreset() {
    if (!from && !to) return 0 // "All time"
    const diffDays = from
      ? Math.round((Date.now() - new Date(from).getTime()) / 86_400_000)
      : null
    if (diffDays === null) return null
    for (const p of PRESETS) {
      if (p.days !== 0 && Math.abs(diffDays - p.days) <= 1) return p.days
    }
    return null
  }

  const active = activePreset()

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Preset buttons */}
      <div className="flex gap-1 rounded-lg border bg-muted/40 p-1">
        {PRESETS.map(p => (
          <button
            key={p.days}
            onClick={() => applyPreset(p.days)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              active === p.days
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Custom date inputs */}
      <div className="flex items-center gap-1.5 text-sm">
        <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground" />
        <input
          type="date"
          value={from}
          max={to || toDateInput(new Date())}
          onChange={e => push({ from: e.target.value, to })}
          className="h-8 rounded-md border bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <span className="text-muted-foreground text-xs">to</span>
        <input
          type="date"
          value={to}
          min={from}
          max={toDateInput(new Date())}
          onChange={e => push({ from, to: e.target.value })}
          className="h-8 rounded-md border bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>
    </div>
  )
}
