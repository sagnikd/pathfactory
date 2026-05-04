'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Bell, Building2, Globe, X } from 'lucide-react'

type VisitorAlert = {
  id:          string
  trackId:     string
  trackTitle:  string
  company:     string | null
  country:     string | null
  city:        string | null
  startedAt:   string
  read:        boolean
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60)  return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

export function NotificationBell({
  orgTrackIds,
  trackTitles,
}: {
  orgTrackIds: string[]
  trackTitles: Record<string, string>
}) {
  const [alerts,   setAlerts]   = useState<VisitorAlert[]>([])
  const [open,     setOpen]     = useState(false)
  const [unread,   setUnread]   = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)

  // ── Supabase Realtime subscription ────────────────────────────────────────
  useEffect(() => {
    if (orgTrackIds.length === 0) return
    const supabase = createClient()

    const channel = supabase
      .channel('visitor-alerts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'sessions' },
        (payload) => {
          const row = payload.new as {
            id: string
            track_id: string
            started_at: string
            device_json?: { company?: string; country?: string; city?: string; ip?: string } | null
          }

          // Only surface sessions belonging to this org's tracks
          if (!orgTrackIds.includes(row.track_id)) return

          const device = row.device_json ?? {}
          const alert: VisitorAlert = {
            id:         row.id,
            trackId:    row.track_id,
            trackTitle: trackTitles[row.track_id] ?? 'Unknown Track',
            company:    device.company  ?? null,
            country:    device.country  ?? null,
            city:       device.city     ?? null,
            startedAt:  row.started_at,
            read:       false,
          }

          setAlerts(prev => [alert, ...prev].slice(0, 30))
          setUnread(n => n + 1)
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [orgTrackIds, trackTitles])

  // ── Close on outside click ─────────────────────────────────────────────────
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  function handleOpen() {
    setOpen(o => !o)
    setUnread(0)
    setAlerts(prev => prev.map(a => ({ ...a, read: true })))
  }

  function dismiss(id: string) {
    setAlerts(prev => prev.filter(a => a.id !== id))
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div ref={panelRef} className="relative">
      {/* Bell button */}
      <button
        onClick={handleOpen}
        className="relative p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        title="Visitor alerts"
      >
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 leading-none">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-xl border bg-popover shadow-xl z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <p className="text-sm font-semibold">Visitor Alerts</p>
            {alerts.length > 0 && (
              <button
                onClick={() => setAlerts([])}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear all
              </button>
            )}
          </div>

          {/* Alert list */}
          <div className="max-h-[420px] overflow-y-auto divide-y">
            {alerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                <Bell className="w-8 h-8 text-muted-foreground/40 mb-3" />
                <p className="text-sm font-medium text-muted-foreground">No visitor alerts yet</p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  You'll be notified when someone views your tracks
                </p>
              </div>
            ) : (
              alerts.map(alert => (
                <div
                  key={alert.id}
                  className={`flex items-start gap-3 px-4 py-3 hover:bg-muted/40 transition-colors ${!alert.read ? 'bg-primary/5' : ''}`}
                >
                  {/* Avatar */}
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Building2 className="w-4 h-4 text-primary" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-snug">
                      {alert.company
                        ? <span className="text-foreground">{alert.company}</span>
                        : <span className="text-muted-foreground italic">Anonymous visitor</span>
                      }
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      Viewing <span className="font-medium text-foreground/80">{alert.trackTitle}</span>
                    </p>
                    {(alert.city || alert.country) && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Globe className="w-3 h-3 shrink-0" />
                        {[alert.city, alert.country].filter(Boolean).join(', ')}
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground/60 mt-1">
                      {timeAgo(alert.startedAt)}
                    </p>
                  </div>

                  {/* Dismiss */}
                  <button
                    onClick={() => dismiss(alert.id)}
                    className="shrink-0 p-0.5 rounded hover:bg-muted text-muted-foreground/50 hover:text-muted-foreground transition-colors mt-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
