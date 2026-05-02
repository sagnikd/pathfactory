'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { format } from 'date-fns'

export default function LeadClientList({ leads, timelines }: any) {
  const [selectedVisitorId, setSelectedVisitorId] = useState<string | null>(null)

  const downloadCSV = () => {
    const headers = ['ID', 'Email', 'Score', 'Created At']
    const rows = leads.map((l: any) => [
      l.id,
      l.email,
      l.score || 0,
      new Date(l.createdAt).toISOString()
    ])
    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(","), ...rows.map((e: any) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "leads.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
              {leads.map((lead: any) => (
                <div 
                  key={lead.id} 
                  className={`flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50 transition-colors ${selectedVisitorId === lead.visitorId ? 'bg-muted/50 rounded-md' : ''}`}
                  onClick={() => setSelectedVisitorId(lead.visitorId)}
                >
                  <div>
                    <p className="font-medium text-lg">{lead.email}</p>
                    <p className="text-sm text-muted-foreground">Captured on {format(new Date(lead.createdAt), 'MMM d, yyyy')}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-xl font-bold text-primary">{lead.score || 0}</p>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Score</p>
                    </div>
                  </div>
                </div>
              ))}
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
