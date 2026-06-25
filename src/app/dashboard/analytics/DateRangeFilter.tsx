'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useState } from 'react'
import { CalendarIcon } from 'lucide-react'

const PRESETS = [
  { label: 'Last 7 days',  days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'All time',     days: 0 },
]

function toDateInput(d: Date) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDateInput(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null
  }
  return date
}

export function DateRangeFilter() {
  const router     = useRouter()
  const pathname   = usePathname()
  const searchParams = useSearchParams()
  const [today] = useState(() => new Date())

  const from = searchParams.get('from') ?? ''
  const to   = searchParams.get('to')   ?? ''

  function push(params: Record<string, string>) {
    const sp = new URLSearchParams(searchParams.toString())
    Object.entries(params).forEach(([k, v]) => {
      if (v) sp.set(k, v); else sp.delete(k)
    })
    router.push(`${pathname}?${sp.toString()}`)
    // Force the server component to re-fetch with the new search params.
    // Without this, the Next.js router cache may serve the old RSC payload.
    router.refresh()
  }

  function applyPreset(days: number) {
    if (days === 0) {
      push({ from: '', to: '' })
    } else {
      const start = new Date(today)
      start.setDate(today.getDate() - days)
      push({ from: toDateInput(start), to: toDateInput(today) })
    }
  }

  // Which preset is currently active?
  function activePreset() {
    if (!from && !to) return 0 // "All time"
    const fromDate = from ? parseDateInput(from) : null
    if (!fromDate) return null
    const diffDays = Math.round((today.getTime() - fromDate.getTime()) / 86_400_000)
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
          max={to || toDateInput(today)}
          onChange={e => push({ from: e.target.value, to })}
          className="h-8 rounded-md border bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <span className="text-muted-foreground text-xs">to</span>
        <input
          type="date"
          value={to}
          min={from}
          max={toDateInput(today)}
          onChange={e => push({ from, to: e.target.value })}
          className="h-8 rounded-md border bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>
    </div>
  )
}
