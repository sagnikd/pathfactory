'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'

// ── Types (mirror page.tsx) ───────────────────────────────────────────────────
export type VisitorRow      = { visitor_id: string; identifier: string; views: number; sessions_count: number; dwell_secs: number }
export type AccountRow      = { company: string; contacts: number; views: number; sessions_count: number; dwell_secs: number }
export type DwellRow        = { asset_id: string; title: string; dwell_secs: number; views: number }
export type BingeRow        = { asset_id: string; title: string; total_sessions: number; binge_sessions: number; binge_rate: number }
export type TrackStatRow    = { track_id: string; title: string; slug: string; layout: string; sessions_count: number; unique_visitors: number; total_dwell_secs: number; views: number }
export type ExperienceStatRow = { track_id: string; title: string; track_count: number; sessions_count: number; unique_visitors: number; total_dwell_secs: number; views: number }

function fmtHMS(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':')
}

type SortDir = 'asc' | 'desc'

function SortIcon({ col, sortCol, sortDir }: { col: string; sortCol: string; sortDir: SortDir }) {
  if (col !== sortCol) return <ChevronsUpDown className="inline w-3 h-3 ml-0.5 opacity-40" />
  return sortDir === 'desc'
    ? <ChevronDown className="inline w-3 h-3 ml-0.5 text-primary" />
    : <ChevronUp   className="inline w-3 h-3 ml-0.5 text-primary" />
}

function useSortedRows<T extends object>(rows: T[], defaultCol: keyof T, defaultDir: SortDir = 'desc') {
  const [sortCol, setSortCol] = useState<keyof T>(defaultCol)
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir)

  function toggle(col: keyof T) {
    if (col === sortCol) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortCol(col); setSortDir('desc') }
  }

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortCol], bv = b[sortCol]
    const cmp = typeof av === 'string'
      ? (av as string).localeCompare(bv as string)
      : (av as number) - (bv as number)
    return sortDir === 'desc' ? -cmp : cmp
  })

  return { sorted, sortCol: sortCol as string, sortDir, toggle: toggle as (col: string) => void }
}

// ── Shared th button ──────────────────────────────────────────────────────────
const thBase = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground select-none'
const tdBase = 'px-3 py-2.5 text-sm'
const trBase = 'border-t border-border/60 hover:bg-muted/30 transition-colors'

function Th({ label, col, sortCol, sortDir, onSort, right, className = '' }: {
  label: string; col: string; sortCol: string; sortDir: SortDir
  onSort: (col: string) => void; right?: boolean; className?: string
}) {
  return (
    <th
      className={`${thBase} ${right ? 'text-right' : 'text-left'} ${className} cursor-pointer hover:text-foreground transition-colors`}
      onClick={() => onSort(col)}
    >
      {label}
      <SortIcon col={col} sortCol={sortCol} sortDir={sortDir} />
    </th>
  )
}

// ── Top Visitors ──────────────────────────────────────────────────────────────
export function TopVisitorsTable({ rows }: { rows: VisitorRow[] }) {
  const { sorted, sortCol, sortDir, toggle } = useSortedRows(rows, 'dwell_secs')
  if (!rows.length) return <p className="text-sm text-muted-foreground px-4 py-6">No data yet.</p>
  return (
    <table className="w-full">
      <thead>
        <tr>
          <th className={`${thBase} text-left pl-4 w-[40%]`}>#&nbsp;&nbsp;Visitor</th>
          <Th label="Views"     col="views"         sortCol={sortCol} sortDir={sortDir} onSort={toggle} right />
          <Th label="Sessions"  col="sessions_count" sortCol={sortCol} sortDir={sortDir} onSort={toggle} right />
          <Th label="View Time" col="dwell_secs"    sortCol={sortCol} sortDir={sortDir} onSort={toggle} right className="pr-4" />
        </tr>
      </thead>
      <tbody>
        {sorted.map((v, i) => (
          <tr key={v.visitor_id} className={trBase}>
            <td className={`${tdBase} pl-4 font-medium truncate max-w-[180px]`}>
              <span className="text-muted-foreground mr-2">{i + 1}</span>
              {v.identifier}
            </td>
            <td className={`${tdBase} text-right tabular-nums`}>{v.views}</td>
            <td className={`${tdBase} text-right tabular-nums`}>{v.sessions_count}</td>
            <td className={`${tdBase} text-right tabular-nums pr-4`}>{fmtHMS(v.dwell_secs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Top Accounts ──────────────────────────────────────────────────────────────
export function TopAccountsTable({ rows }: { rows: AccountRow[] }) {
  const { sorted, sortCol, sortDir, toggle } = useSortedRows(rows, 'contacts')
  if (!rows.length) return <p className="text-sm text-muted-foreground px-4 py-6">No company data yet — fill the lead form to populate this.</p>
  return (
    <table className="w-full">
      <thead>
        <tr>
          <th className={`${thBase} text-left pl-4 w-[35%]`}>#&nbsp;&nbsp;Account</th>
          <Th label="Contacts"  col="contacts"       sortCol={sortCol} sortDir={sortDir} onSort={toggle} right />
          <Th label="Views"     col="views"          sortCol={sortCol} sortDir={sortDir} onSort={toggle} right />
          <Th label="Sessions"  col="sessions_count" sortCol={sortCol} sortDir={sortDir} onSort={toggle} right />
          <Th label="View Time" col="dwell_secs"     sortCol={sortCol} sortDir={sortDir} onSort={toggle} right className="pr-4" />
        </tr>
      </thead>
      <tbody>
        {sorted.map((a, i) => (
          <tr key={a.company} className={trBase}>
            <td className={`${tdBase} pl-4 font-medium truncate max-w-[160px]`}>
              <span className="text-muted-foreground mr-2">{i + 1}</span>
              {a.company}
            </td>
            <td className={`${tdBase} text-right tabular-nums`}>
              {a.contacts > 0
                ? <span className="inline-flex items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold px-2 py-0.5 min-w-[1.5rem]">{a.contacts}</span>
                : <span className="text-muted-foreground">—</span>}
            </td>
            <td className={`${tdBase} text-right tabular-nums`}>{a.views}</td>
            <td className={`${tdBase} text-right tabular-nums`}>{a.sessions_count}</td>
            <td className={`${tdBase} text-right tabular-nums pr-4`}>{fmtHMS(a.dwell_secs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Top 5 by Engagement Time ──────────────────────────────────────────────────
export function TopDwellTable({ rows }: { rows: DwellRow[] }) {
  const { sorted, sortCol, sortDir, toggle } = useSortedRows(rows, 'dwell_secs')
  if (!rows.length) return <p className="text-sm text-muted-foreground px-4 py-6">No engagement data yet.</p>
  return (
    <table className="w-full">
      <thead>
        <tr>
          <th className={`${thBase} text-left pl-4`}>#&nbsp;&nbsp;Asset</th>
          <Th label="Views"      col="views"      sortCol={sortCol} sortDir={sortDir} onSort={toggle} right />
          <Th label="View Time"  col="dwell_secs" sortCol={sortCol} sortDir={sortDir} onSort={toggle} right className="pr-4" />
        </tr>
      </thead>
      <tbody>
        {sorted.map((a, i) => (
          <tr key={a.asset_id} className={trBase}>
            <td className={`${tdBase} pl-4 font-medium truncate max-w-[200px]`}>
              <span className="text-muted-foreground mr-2">{i + 1}</span>
              {a.title}
            </td>
            <td className={`${tdBase} text-right tabular-nums`}>{a.views}</td>
            <td className={`${tdBase} text-right tabular-nums pr-4 font-medium text-primary`}>{fmtHMS(a.dwell_secs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Top 5 by Binge Rate ───────────────────────────────────────────────────────
export function TopBingeTable({ rows }: { rows: BingeRow[] }) {
  const { sorted, sortCol, sortDir, toggle } = useSortedRows(rows, 'binge_rate')
  if (!rows.length) return <p className="text-sm text-muted-foreground px-4 py-6">No multi-asset sessions yet.</p>
  return (
    <table className="w-full">
      <thead>
        <tr>
          <th className={`${thBase} text-left pl-4`}>#&nbsp;&nbsp;Asset</th>
          <Th label="Sessions"   col="total_sessions" sortCol={sortCol} sortDir={sortDir} onSort={toggle} right />
          <Th label="Binge Rate" col="binge_rate"     sortCol={sortCol} sortDir={sortDir} onSort={toggle} right className="pr-4" />
        </tr>
      </thead>
      <tbody>
        {sorted.map((a, i) => (
          <tr key={a.asset_id} className={trBase}>
            <td className={`${tdBase} pl-4 truncate max-w-[200px]`}>
              <span className="text-muted-foreground mr-2">{i + 1}</span>
              <span className="font-medium">{a.title}</span>
            </td>
            <td className={`${tdBase} text-right tabular-nums`}>{a.total_sessions}</td>
            <td className={`${tdBase} text-right tabular-nums pr-4 font-semibold`}>
              <span className={a.binge_rate >= 80 ? 'text-green-600' : a.binge_rate >= 50 ? 'text-yellow-600' : 'text-muted-foreground'}>
                {a.binge_rate}%
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Track Performance ─────────────────────────────────────────────────────────
const layoutColors: Record<string, string> = {
  binge:  'border-primary/40 text-primary bg-primary/5',
  hub:    'border-orange-300 text-orange-700 bg-orange-50',
  single: 'border-border text-muted-foreground bg-muted/50',
}

export function TrackStatsTable({ rows }: { rows: TrackStatRow[] }) {
  const { sorted, sortCol, sortDir, toggle } = useSortedRows(rows, 'sessions_count')
  if (!rows.length) return <p className="text-sm text-muted-foreground px-4 py-6">No track data yet.</p>
  return (
    <table className="w-full">
      <thead>
        <tr>
          <th className={`${thBase} text-left pl-4 w-[40%]`}>#&nbsp;&nbsp;Track</th>
          <Th label="Sessions" col="sessions_count"  sortCol={sortCol} sortDir={sortDir} onSort={toggle} right />
          <Th label="Visitors" col="unique_visitors"  sortCol={sortCol} sortDir={sortDir} onSort={toggle} right />
          <Th label="Views"    col="views"            sortCol={sortCol} sortDir={sortDir} onSort={toggle} right />
          <Th label="Dwell"    col="total_dwell_secs" sortCol={sortCol} sortDir={sortDir} onSort={toggle} right className="pr-4" />
        </tr>
      </thead>
      <tbody>
        {sorted.map((t, i) => (
          <tr key={t.track_id} className={trBase}>
            <td className={`${tdBase} pl-4`} style={{ maxWidth: 180 }}>
              <div className="flex items-start gap-1.5 min-w-0">
                <span className="text-muted-foreground shrink-0">{i + 1}</span>
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{t.title}</div>
                  <span className={`mt-0.5 inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${layoutColors[t.layout] ?? layoutColors.single}`}>
                    {t.layout}
                  </span>
                </div>
              </div>
            </td>
            <td className={`${tdBase} text-right tabular-nums`}>{t.sessions_count}</td>
            <td className={`${tdBase} text-right tabular-nums`}>{t.unique_visitors}</td>
            <td className={`${tdBase} text-right tabular-nums`}>{t.views}</td>
            <td className={`${tdBase} text-right tabular-nums pr-4 font-medium text-primary`}>{fmtHMS(t.total_dwell_secs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Experience Performance ────────────────────────────────────────────────────
export function ExperienceStatsTable({ rows }: { rows: ExperienceStatRow[] }) {
  const { sorted, sortCol, sortDir, toggle } = useSortedRows(rows, 'sessions_count')
  if (!rows.length) return <p className="text-sm text-muted-foreground px-4 py-6">No experience data yet.</p>
  return (
    <table className="w-full">
      <thead>
        <tr>
          <th className={`${thBase} text-left pl-4 w-[38%]`}>#&nbsp;&nbsp;Experience</th>
          <Th label="Tracks"   col="track_count"     sortCol={sortCol} sortDir={sortDir} onSort={toggle} right />
          <Th label="Sessions" col="sessions_count"  sortCol={sortCol} sortDir={sortDir} onSort={toggle} right />
          <Th label="Visitors" col="unique_visitors"  sortCol={sortCol} sortDir={sortDir} onSort={toggle} right />
          <Th label="Dwell"    col="total_dwell_secs" sortCol={sortCol} sortDir={sortDir} onSort={toggle} right className="pr-4" />
        </tr>
      </thead>
      <tbody>
        {sorted.map((e, i) => (
          <tr key={e.track_id} className={trBase}>
            <td className={`${tdBase} pl-4 font-medium truncate max-w-[160px]`}>
              <span className="text-muted-foreground mr-2">{i + 1}</span>
              {e.title}
            </td>
            <td className={`${tdBase} text-right tabular-nums`}>
              <span className="inline-flex items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold px-2 py-0.5 min-w-[1.5rem]">{e.track_count}</span>
            </td>
            <td className={`${tdBase} text-right tabular-nums`}>{e.sessions_count}</td>
            <td className={`${tdBase} text-right tabular-nums`}>{e.unique_visitors}</td>
            <td className={`${tdBase} text-right tabular-nums pr-4 font-medium text-primary`}>{fmtHMS(e.total_dwell_secs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Combined export (one import in page.tsx) ──────────────────────────────────
export function AnalyticsTables({ visitors, accounts, dwell, binge }: {
  visitors: VisitorRow[]
  accounts: AccountRow[]
  dwell:    DwellRow[]
  binge:    BingeRow[]
}) {
  return (
    <>
      {/* Row 1: Top Visitors + Top Accounts */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top Visitors</CardTitle>
            <p className="text-xs text-muted-foreground">Click column headers to sort</p>
          </CardHeader>
          <CardContent className="p-0">
            <TopVisitorsTable rows={visitors} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top Accounts</CardTitle>
            <p className="text-xs text-muted-foreground">Lead form + IP geo · contacts = captured emails · click to sort</p>
          </CardHeader>
          <CardContent className="p-0">
            <TopAccountsTable rows={accounts} />
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Top 5 by Engagement Time + Top 5 by Binge Rate */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top 5 Content by Engagement Time</CardTitle>
            <p className="text-xs text-muted-foreground">Total dwell time · click to sort</p>
          </CardHeader>
          <CardContent className="p-0">
            <TopDwellTable rows={dwell} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top 5 Content by Binge Rate</CardTitle>
            <p className="text-xs text-muted-foreground">% of sessions that consumed multiple assets · click to sort</p>
          </CardHeader>
          <CardContent className="p-0">
            <TopBingeTable rows={binge} />
          </CardContent>
        </Card>
      </div>
    </>
  )
}
