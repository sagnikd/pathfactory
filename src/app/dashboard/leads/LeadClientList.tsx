'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { format } from 'date-fns'
import type { ScoreBreakdown } from '@/lib/leadScore'

export default function LeadClientList({ leads, timelines, liveScores }: {
  leads: any[]
  timelines: Record<string, any[]>
  liveScores: Record<string, ScoreBreakdown>
}) {
  const [selectedVisitorId, setSelectedVisitorId] = useState<string | null>(null)

  // Friendly column labels for known field names
  const FIELD_LABELS: Record<string, string> = {
    email:     'Email',
    firstName: 'First Name',
    lastName:  'Last Name',
    company:   'Company',
    jobTitle:  'Job Title',
    phone:     'Phone',
    country:   'Country',
    city:      'City',
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

  const selectedTimeline = selectedVisitorId ? timelines[selectedVisitorId] || [] : []

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
      <div className="col-span-1 md:col-span-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Captured Leads</CardTitle>
            <Button onClick={downloadCSV} variant="outline" size="sm">Download CSV</Button>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {leads.map((lead: any) => {
                const fields    = (lead.formResponsesJson as Record<string, string>) || {}
                const scoreData = liveScores[lead.visitorId]
                const score     = scoreData?.total ?? lead.score ?? 0

                // Extra form fields to show inline
                const extraFields = Object.entries(fields)
                  .filter(([k, v]) => k !== 'email' && v)
                  .map(([k, v]) => ({ label: FIELD_LABELS[k] || k, value: v }))

                // Score colour: green ≥60, amber 30-59, muted <30
                const scoreColour =
                  score >= 60 ? 'text-green-600 dark:text-green-400' :
                  score >= 30 ? 'text-amber-500' :
                  'text-muted-foreground'

                return (
                  <div
                    key={lead.id}
                    className={`flex items-start justify-between gap-4 p-4 cursor-pointer hover:bg-muted/50 transition-colors rounded-lg ${selectedVisitorId === lead.visitorId ? 'bg-muted/50' : ''}`}
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

                    {/* Score + breakdown */}
                    <div className="text-right shrink-0 group relative">
                      <p className={`text-xl font-bold ${scoreColour}`}>{score}</p>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Score</p>

                      {/* Breakdown tooltip on hover */}
                      {scoreData && (
                        <div className="absolute right-0 top-full mt-1.5 z-10 w-52 rounded-lg border bg-popover p-3 shadow-lg text-xs hidden group-hover:block">
                          <p className="font-semibold text-sm mb-2">Score breakdown</p>
                          {[
                            { label: 'Assets viewed',      value: scoreData.breadth,     hint: '×5 per asset' },
                            { label: 'Time on page',       value: scoreData.dwell,       hint: '×2 per 10 s' },
                            { label: 'Deep reads',         value: scoreData.depth,       hint: '×3 per scroll milestone' },
                            { label: 'Videos started',     value: scoreData.videoPlay,   hint: '×5 per play' },
                            { label: 'Videos completed',   value: scoreData.videoFinish, hint: '×10 per completion' },
                            { label: 'Return visits',      value: scoreData.returnVisit, hint: '×20 per extra session' },
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
                )
              })}
              {leads.length === 0 && <p className="text-muted-foreground p-4">No leads captured yet.</p>}
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
                {selectedTimeline.map((event: any, idx: number) => (
                  <div key={idx} className="relative">
                    <div className="absolute -left-[1.35rem] w-3 h-3 bg-primary rounded-full mt-1.5 shadow-[0_0_0_4px_rgba(255,255,255,1)] dark:shadow-[0_0_0_4px_rgba(3,7,18,1)]" />
                    <p className="text-sm font-medium leading-snug">
                      <span className="capitalize">{event.eventType.replace('_', ' ')}</span> on <span className="font-semibold text-foreground/80">{event.assetTitle}</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{format(new Date(event.ts), 'MMM d, h:mm a')}</p>
                  </div>
                ))}
                {selectedTimeline.length === 0 && <p className="text-sm text-muted-foreground">No events found.</p>}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
