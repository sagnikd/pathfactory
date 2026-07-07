'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { format } from 'date-fns'
import { Trash2 } from 'lucide-react'
import type { ScoreBreakdown } from '@/lib/leadScore'

type AnonVisit = {
  visitorId:    string
  company:      string | null
  country:      string | null
  city:         string | null
  trackTitle:   string
  dwellSeconds: number
  lastSeen:     Date | string
}

function formatDwell(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

export default function LeadClientList({ leads, timelines, liveScores, anonymousTraffic }: {
  leads: any[]
  timelines: Record<string, any[]>
  liveScores: Record<string, ScoreBreakdown>
  anonymousTraffic: AnonVisit[]
}) {
  const [localLeads, setLocalLeads] = useState<any[]>(leads)
  const [selectedVisitorId, setSelectedVisitorId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function deleteLead(e: React.MouseEvent, leadId: string) {
    e.stopPropagation()
    if (!confirm('Delete this lead? This cannot be undone.')) return
    setDeletingId(leadId)
    try {
      const res = await fetch('/api/leads', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leadId }) })
      if (res.ok) {
        setLocalLeads(prev => prev.filter(l => l.id !== leadId))
        if (selectedVisitorId) {
          const deleted = localLeads.find(l => l.id === leadId)
          if (deleted?.visitorId === selectedVisitorId) setSelectedVisitorId(null)
        }
      }
    } finally {
      setDeletingId(null)
    }
  }

  // Friendly column labels for known field names
  const FIELD_LABELS: Record<string, string> = {
    email:        'Email',
    firstName:    'First Name',
    lastName:     'Last Name',
    company:      'Company',
    jobTitle:     'Job Title',
    phone:        'Phone',
    country:      'Country',
    city:         'City',
    industry:     'Industry',
    source:       'Source',
    utm_source:   'Source',
    utm_medium:   'Medium',
    utm_campaign: 'Campaign',
  }

  // Strip random short suffixes appended by some form builders (e.g. "industry_g2uz" → "industry").
  // A suffix is 4-8 lowercase alphanum chars after the last underscore.
  function cleanFieldKey(key: string): string {
    const m = /^(.+?)_[a-z0-9]{4,8}$/.exec(key)
    return m ? m[1] : key
  }

  // Consent / legal checkbox fields tend to have extremely long keys that start
  // with "i_am_" or "i_agree_" — they're useful for compliance but not for the
  // inline lead card summary. Skip them there (they are still in the CSV export).
  function isConsentField(key: string): boolean {
    return /^i_(am|agree|confirm|acknowledge)_/i.test(key)
  }

  // Human-readable label for any field key. Known keys (including compound
  // ones like utm_medium) are checked before suffix-stripping — otherwise
  // cleanFieldKey mistakes the real word after the underscore (e.g. "medium",
  // "source", "campaign") for a random form-builder suffix and collapses
  // utm_source/utm_medium/utm_campaign all down to the same "utm" key.
  function fieldLabel(rawKey: string): string {
    if (FIELD_LABELS[rawKey]) return FIELD_LABELS[rawKey]
    const key = cleanFieldKey(rawKey)
    return FIELD_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }

  // Wrap a cell value in quotes if it contains commas, quotes or newlines
  function csvCell(val: unknown): string {
    const str = String(val ?? '')
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  const downloadCSV = () => {
    // Collect every field key that appears in any lead's formResponsesJson,
    // preserving a sensible order (known fields first, then custom ones)
    const knownOrder = ['email', 'firstName', 'lastName', 'company', 'jobTitle', 'phone', 'country', 'city']
    const allKeys = new Set<string>()
    leads.forEach((l: any) => {
      const fields = (l.formResponsesJson as Record<string, string>) || {}
      Object.keys(fields).forEach(k => allKeys.add(k))
    })
    const orderedKeys = [
      ...knownOrder.filter(k => allKeys.has(k)),
      ...[...allKeys].filter(k => !knownOrder.includes(k)),
    ]

    const headers = [
      'Lead ID',
      ...orderedKeys.map(k => FIELD_LABELS[k] || k),
      'Score',
      'Captured At',
    ]

    const rows = leads.map((l: any) => {
      const fields = (l.formResponsesJson as Record<string, string>) || {}
      return [
        csvCell(l.id),
        ...orderedKeys.map(k => csvCell(fields[k] ?? '')),
        csvCell(liveScores[l.visitorId]?.total ?? l.score ?? 0),
        csvCell(new Date(l.createdAt).toISOString()),
      ]
    })

    const csv = [headers.map(csvCell).join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href     = url
    link.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const selectedTimeline = selectedVisitorId
    ? (timelines[selectedVisitorId] || [])
        .filter((event: any) => !String(event.eventType).toLowerCase().includes('dwell'))
        .filter(
          (event: any, idx: number, arr: any[]) =>
            arr.findIndex((e) => e.assetId === event.assetId && e.sessionId === event.sessionId) === idx
        )
        .sort((a: any, b: any) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
    : []

  return (
    <>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
      <div className="col-span-1 md:col-span-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Captured Leads</CardTitle>
            <Button onClick={downloadCSV} variant="outline" size="sm">Download CSV</Button>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {localLeads.map((lead: any) => {
                const fields    = (lead.formResponsesJson as Record<string, string>) || {}
                const scoreData = liveScores[lead.visitorId]
                const score     = scoreData?.total ?? lead.score ?? 0

                // Extra form fields to show inline — skip email (shown as heading),
                // consent checkbox blobs, and empty values.
                const extraFields = Object.entries(fields)
                  .filter(([k, v]) => k !== 'email' && v && !isConsentField(k))
                  .map(([k, v]) => ({ label: fieldLabel(k), value: v }))

                // Score colour: green ≥60, amber 30-59, muted <30
                const scoreColour =
                  score >= 60 ? 'text-green-600 dark:text-green-400' :
                  score >= 30 ? 'text-amber-500' :
                  'text-muted-foreground'

                return (
                  <div
                    key={lead.id}
                    className={`group/row flex items-start justify-between gap-4 p-4 cursor-pointer hover:bg-muted/50 transition-colors rounded-lg ${selectedVisitorId === lead.visitorId ? 'bg-muted/50' : ''}`}
                    onClick={() => setSelectedVisitorId(lead.visitorId)}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-base truncate">{lead.email}</p>

                      {extraFields.length > 0 && (
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                          {extraFields.map(({ label, value }) => (
                            <span key={label} className="text-xs text-muted-foreground">
                              <span className="font-medium text-foreground/60">{label}:</span>{' '}
                              {value}
                            </span>
                          ))}
                        </div>
                      )}

                      <p className="text-xs text-muted-foreground mt-1">
                        Captured {format(new Date(lead.createdAt), 'MMM d, yyyy')}
                      </p>
                    </div>

                    <div className="flex items-start gap-3 shrink-0">
                      {/* Delete button — visible on row hover */}
                      <button
                        onClick={(e) => deleteLead(e, lead.id)}
                        disabled={deletingId === lead.id}
                        className="mt-1 p-1 rounded opacity-0 group-hover/row:opacity-100 transition-opacity hover:bg-destructive/10 hover:text-destructive text-muted-foreground disabled:opacity-40"
                        title="Delete lead"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>

                      {/* Score + breakdown */}
                      <div className="text-right group relative">
                        <p className={`text-xl font-bold ${scoreColour}`}>{score}</p>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Score</p>

                        {/* Breakdown tooltip on hover */}
                        {scoreData && (
                          <div className="absolute right-0 top-full mt-1.5 z-10 w-52 rounded-lg border bg-popover p-3 shadow-lg text-xs hidden group-hover:block">
                            <p className="font-semibold text-sm mb-2">Score breakdown</p>
                            {[
                              { label: 'Assets viewed',      value: scoreData.breadth },
                              { label: 'Time on page',       value: scoreData.dwell },
                              { label: 'Deep reads',         value: scoreData.depth },
                              { label: 'Videos started',     value: scoreData.videoPlay },
                              { label: 'Videos completed',   value: scoreData.videoFinish },
                              { label: 'Return visits',      value: scoreData.returnVisit },
                            ].map(row => (
                              <div key={row.label} className="flex items-center justify-between gap-2 py-0.5">
                                <span className="text-muted-foreground">{row.label}</span>
                                <span className="font-medium tabular-nums">{row.value}</span>
                              </div>
                            ))}
                            <div className="border-t mt-2 pt-2 flex justify-between font-semibold">
                              <span>Total</span>
                              <span>{score}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
              {localLeads.length === 0 && <p className="text-muted-foreground p-4">No leads captured yet.</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="col-span-1">
        <Card className="h-[600px] flex flex-col sticky top-4">
          <CardHeader>
            <CardTitle>Visitor Timeline</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto">
            {!selectedVisitorId ? (
              <div className="h-full flex items-center justify-center text-center p-4">
                <p className="text-muted-foreground text-sm">Select a lead from the list to view their engagement timeline across all your assets.</p>
              </div>
            ) : (
              <div className="space-y-6 border-l-2 border-primary/20 ml-3 pl-4 pb-4 mt-2">
                {(() => {
                  const seenSessions = new Set<string>()
                  return selectedTimeline.map((event: any, idx: number) => {
                    const isFirstOfSession = !seenSessions.has(event.sessionId)
                    if (isFirstOfSession) seenSessions.add(event.sessionId)
                    const src = event.utmSource?.trim()
                    const med = event.utmMedium?.trim()
                    const sourceLabel = src
                      ? [src, med].filter(Boolean).join(' / ')
                      : null
                    return (
                      <div key={idx} className="relative">
                        {isFirstOfSession && sourceLabel && (
                          <span className="inline-flex items-center gap-1 mb-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary uppercase tracking-wide">
                            ↗ via {sourceLabel}
                          </span>
                        )}
                        <div className="absolute -left-[1.35rem] w-3 h-3 bg-primary rounded-full mt-1.5 shadow-[0_0_0_4px_rgba(255,255,255,1)] dark:shadow-[0_0_0_4px_rgba(3,7,18,1)]" />
                        <p className="text-sm font-medium leading-snug">
                          <span className="capitalize">{event.eventType.replace('_', ' ')}</span> on <span className="font-semibold text-foreground/80">{event.assetTitle}</span>
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {format(new Date(event.ts), 'MMM d, h:mm a')}
                          {event.dwellSeconds > 0 && (
                            <span className="ml-1.5 text-muted-foreground/70">({formatDwell(event.dwellSeconds)})</span>
                          )}
                        </p>
                      </div>
                    )
                  })
                })()}
                {selectedTimeline.length === 0 && <p className="text-sm text-muted-foreground">No events found.</p>}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>

    {/* ── Anonymous Traffic ──────────────────────────────────────────── */}
    <div className="mt-8">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle>Anonymous Traffic</CardTitle>
            <p className="text-sm text-muted-foreground mt-0.5">
              Visitors who haven't submitted the lead form yet — sorted by time watched
            </p>
          </div>
          <span className="text-sm font-medium text-muted-foreground">
            {anonymousTraffic.length} visitor{anonymousTraffic.length !== 1 ? 's' : ''}
          </span>
        </CardHeader>
        <CardContent className="p-0">
          {anonymousTraffic.length === 0 ? (
            <p className="text-sm text-muted-foreground p-6">No anonymous traffic yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    <th className="text-left px-4 py-3">Company / Visitor</th>
                    <th className="text-left px-4 py-3">Location</th>
                    <th className="text-left px-4 py-3">Track viewed</th>
                    <th className="text-left px-4 py-3">Time watched</th>
                    <th className="text-left px-4 py-3">Last seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {anonymousTraffic.map((v, i) => (
                    <tr key={v.visitorId} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        {v.company ? (
                          <span className="font-medium">{v.company}</span>
                        ) : (
                          <span className="text-muted-foreground italic">Anonymous #{i + 1}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {[v.city, v.country].filter(Boolean).join(', ') || '—'}
                      </td>
                      <td className="px-4 py-3 max-w-[200px] truncate" title={v.trackTitle}>
                        {v.trackTitle}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`font-medium tabular-nums ${
                          v.dwellSeconds >= 120 ? 'text-green-600 dark:text-green-400'
                          : v.dwellSeconds >= 30 ? 'text-amber-500'
                          : 'text-muted-foreground'
                        }`}>
                          {formatDwell(v.dwellSeconds)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {format(new Date(v.lastSeen), 'MMM d, h:mm a')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
    </>
  )
}
