'use client'

import { useEffect } from 'react'
import { clientGeoLookup } from '@/lib/geoLookup'

/**
 * Headless client component that wires up visitor session signals on public
 * pages that are otherwise server-rendered (e.g. experience hubs):
 *
 *   1. Resolves the visitor's geo client-side and persists it to
 *      session.deviceJson via /api/session-geo (so the summary email can
 *      report company/location).
 *   2. Fires a single end-of-session summary email via navigator.sendBeacon
 *      to /api/session-summary when the visitor leaves the page. The API
 *      atomically claims the session, so duplicate beacons send one email.
 *
 * TrackViewer wires the same behavior inline; this component covers pages
 * that don't render TrackViewer.
 */
export function SessionSignals({ sessionId }: { sessionId: string | null }) {
  // 1. Geo → session.deviceJson
  useEffect(() => {
    if (!sessionId) return
    ;(async () => {
      try {
        const geo = await clientGeoLookup()
        await fetch('/api/session-geo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            country: geo.country,
            city: geo.city,
            company: geo.company,
          }),
        })
      } catch {
        // Best-effort — never block the visitor
      }
    })()
  }, [sessionId])

  // 2. End-of-session summary beacon
  useEffect(() => {
    if (!sessionId) return
    let sent = false

    const sendSummary = () => {
      if (sent) return
      sent = true
      try {
        const blob = new Blob([JSON.stringify({ sessionId })], { type: 'application/json' })
        navigator.sendBeacon('/api/session-summary', blob)
      } catch {
        // Best-effort
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') sendSummary()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', sendSummary)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', sendSummary)
    }
  }, [sessionId])

  return null
}
