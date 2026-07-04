'use client'

import { getVisitorFingerprint } from './visitor'

export type EventType = "view" | "scroll_25" | "scroll_50" | "scroll_75" | "scroll_100" | "video_play" | "video_pause" | "video_complete" | "click" | "dwell_tick"

export interface TrackEventPayload {
  sessionId: string;
  assetId: string;
  eventType: EventType;
  payloadJson?: any;
}

interface QueuedEvent extends TrackEventPayload {
  ts: string;
}

let eventQueue: QueuedEvent[] = [];
let flushInterval: NodeJS.Timeout | null = null;
let currentVisitorId: string | null = null;

function hasRejectedCookies(): boolean {
  if (typeof document === 'undefined') return false
  return document.cookie.split('; ').some((c) => c === 'cookie_consent=rejected')
}

export async function initializeTracking() {
  // Visitor explicitly rejected cookies — don't fingerprint, don't (re)set
  // the visitorId tracking cookie, don't queue/flush analytics events.
  if (hasRejectedCookies()) return null

  currentVisitorId = await getVisitorFingerprint();

  if (typeof window !== 'undefined') {
    // Persist fingerprint as a cookie so server-side page.tsx can read it
    // on any track visit and recognise returning / known visitors.
    // 1-year expiry, path=/ so it's sent on all track URLs.
    const maxAge = 60 * 60 * 24 * 365
    document.cookie = `visitorId=${currentVisitorId}; path=/; max-age=${maxAge}; SameSite=Lax`

    if (!flushInterval) {
      flushInterval = setInterval(flushQueue, 5000);
    }

    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flushQueue();
      }
    });
  }

  return currentVisitorId;
}

export function trackEvent(event: TrackEventPayload) {
  if (!event.sessionId || hasRejectedCookies()) return
  eventQueue.push({
    ...event,
    ts: new Date().toISOString()
  });
}

export async function flushQueue() {
  if (eventQueue.length === 0) return;
  
  const eventsToSend = [...eventQueue];
  eventQueue = []; // Clear queue immediately
  
  try {
    const res = await fetch('/api/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      keepalive: true, // Use keepalive for visibilitychange
      body: JSON.stringify({ events: eventsToSend })
    });
    
    if (!res.ok) {
      // Re-queue on failure
      eventQueue = [...eventsToSend, ...eventQueue];
    }
  } catch (error) {
    // Re-queue on error
    eventQueue = [...eventsToSend, ...eventQueue];
  }
}
