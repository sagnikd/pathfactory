'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { trackEvent } from '@/lib/tracking'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { ExternalLink } from 'lucide-react'

pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

// ─── URL helpers ─────────────────────────────────────────────────────────────

function getYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v')
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('?')[0]
  } catch {}
  return null
}

function getVimeoEmbedUrl(url: string): string | null {
  try {
    const match = url.match(/vimeo\.com\/(\d+)/)
    if (!match) return null
    return `https://player.vimeo.com/video/${match[1]}?dnt=1`
  } catch { return null }
}

function isCloudinaryPlayerUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.hostname === 'player.cloudinary.com' && u.pathname.startsWith('/embed')
  } catch {
    return false
  }
}

function withCloudinaryStartOffset(url: string, seconds: number): string {
  try {
    const u = new URL(url)
    if (!(u.hostname === 'player.cloudinary.com' && u.pathname.startsWith('/embed'))) return url
    const start = Math.max(0, Math.floor(seconds))
    if (start <= 0) return url
    u.searchParams.set('source[transformation][start_offset]', String(start))
    return u.toString()
  } catch {
    return url
  }
}

function formatTime(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}


// ─── Root viewer ─────────────────────────────────────────────────────────────

export function AssetViewer({ asset, sessionId, onComplete }: any) {
  const [showCountdown, setShowCountdown] = useState(false)
  const [countdown, setCountdown] = useState(3)

  const handleAssetComplete = () => {
    if (onComplete) { setShowCountdown(true); setCountdown(3) }
  }

  // ── Dwell-time tracking ──────────────────────────────────────────────────
  // Fire a `view` event immediately when this asset is displayed, then emit
  // a `dwell_tick` every 10 seconds the tab is visible.  When the user switches
  // tabs the ticker pauses; when they return it resumes.  Cleanup on unmount.
  useEffect(() => {
    trackEvent({ sessionId, assetId: asset.id, eventType: 'view' })

    let tickInterval: ReturnType<typeof setInterval> | null = null

    const startTicking = () => {
      if (tickInterval) return
      tickInterval = setInterval(() => {
        trackEvent({ sessionId, assetId: asset.id, eventType: 'dwell_tick' })
      }, 10_000)
    }

    const stopTicking = () => {
      if (tickInterval) { clearInterval(tickInterval); tickInterval = null }
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') stopTicking()
      else startTicking()
    }

    if (document.visibilityState === 'visible') startTicking()
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      stopTicking()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [asset.id, sessionId]) // re-runs when user navigates to a different asset
  // ────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!showCountdown) return
    if (countdown > 0) {
      const t = setTimeout(() => setCountdown(c => c - 1), 1000)
      return () => clearTimeout(t)
    }
    setShowCountdown(false)
    onComplete()
  }, [showCountdown, countdown, onComplete])

  const sourceUrl: string = asset.fileUrl || asset.sourceUrl || ''
  const treatAsCloudinaryVideo = asset.type === 'article' && isCloudinaryPlayerUrl(sourceUrl)

  return (
    <div className="relative w-full h-full">
      {(asset.type === 'video' || treatAsCloudinaryVideo) && <VideoViewer asset={asset} sessionId={sessionId} onComplete={handleAssetComplete} />}
      {asset.type === 'pdf'     && <PdfViewer     asset={asset} sessionId={sessionId} onComplete={handleAssetComplete} />}
      {asset.type === 'article' && /\.pdf(\?|$)/i.test(asset.sourceUrl || '') && <PdfViewer asset={asset} sessionId={sessionId} onComplete={handleAssetComplete} />}
      {asset.type === 'article' && !treatAsCloudinaryVideo && !/\.pdf(\?|$)/i.test(asset.sourceUrl || '') && <ArticleViewer asset={asset} sessionId={sessionId} onComplete={handleAssetComplete} />}
      {asset.type === 'image'   && <ImageViewer   asset={asset}                       onComplete={handleAssetComplete} />}

      {showCountdown && (
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center gap-6">
          <p className="text-2xl font-bold">Up next in {countdown}…</p>
          <div className="flex gap-3">
            <button
              onClick={() => { setShowCountdown(false); onComplete() }}
              className="px-5 py-2 bg-primary text-primary-foreground rounded-lg font-medium text-sm"
            >
              Skip wait
            </button>
            <button
              onClick={() => setShowCountdown(false)}
              className="px-5 py-2 bg-muted text-foreground rounded-lg font-medium text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Video viewer (YouTube / Vimeo / direct file) ────────────────────────────

function VideoViewer({ asset, sessionId, onComplete }: any) {
  const raw: string = asset.fileUrl || asset.sourceUrl || ''
  const isYouTube = raw.includes('youtube.com') || raw.includes('youtu.be')
  const isVimeo   = raw.includes('vimeo.com')
  const isCloudinary = isCloudinaryPlayerUrl(raw)

  if (isCloudinary) {
    return <CloudinaryViewer url={raw} asset={asset} sessionId={sessionId} onComplete={onComplete} />
  }

  if (isYouTube) {
    return <YouTubeViewer url={raw} asset={asset} sessionId={sessionId} onComplete={onComplete} />
  }

  if (isVimeo || isCloudinary) {
    const embedUrl = getVimeoEmbedUrl(raw)
    return (
      <div className="w-full h-full flex flex-col bg-black">
        <div className="flex-1 relative">
          <iframe
            src={isCloudinary ? raw : (embedUrl ?? raw)}
            className="absolute inset-0 w-full h-full border-0"
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
          />
        </div>
        {onComplete && (
          <div className="shrink-0 h-14 bg-background border-t flex items-center justify-end px-4">
            <button
              onClick={() => { trackEvent({ sessionId, assetId: asset.id, eventType: 'video_complete' }); onComplete() }}
              className="px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium"
            >
              Mark complete &amp; continue
            </button>
          </div>
        )}
      </div>
    )
  }

  // Direct video file (mp4, etc.)
  return (
    <div className="w-full h-full bg-black flex items-center justify-center">
      <video
        src={raw}
        controls
        className="max-w-full max-h-full"
        onPlay={() => trackEvent({ sessionId, assetId: asset.id, eventType: 'video_play' })}
        onPause={() => trackEvent({ sessionId, assetId: asset.id, eventType: 'video_pause' })}
        onEnded={() => { trackEvent({ sessionId, assetId: asset.id, eventType: 'video_complete' }); onComplete?.() }}
      />
    </div>
  )
}

function CloudinaryViewer({ url, asset, sessionId, onComplete }: any) {
  const storageKey = `cloudinary-time-${asset.id}`
  const initialSavedTime = Math.floor(parseFloat(localStorage.getItem(storageKey) ?? '0') || 0)
  const [resumeFrom, setResumeFrom] = useState(initialSavedTime)
  const [src, setSrc] = useState(() => withCloudinaryStartOffset(url, initialSavedTime))
  const loadedAtRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const handleLoad = useCallback(() => {
    loadedAtRef.current = Date.now()
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      const pos = resumeFrom + (Date.now() - loadedAtRef.current) / 1000
      localStorage.setItem(storageKey, String(pos))
    }, 5000)
    trackEvent({ sessionId, assetId: asset.id, eventType: 'video_play' })
  }, [resumeFrom, storageKey, sessionId, asset.id])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (loadedAtRef.current > 0) {
        const pos = resumeFrom + (Date.now() - loadedAtRef.current) / 1000
        if (pos > resumeFrom + 3) localStorage.setItem(storageKey, String(pos))
      }
    }
  }, [resumeFrom, storageKey])

  const handleContinue = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    localStorage.removeItem(storageKey)
    trackEvent({ sessionId, assetId: asset.id, eventType: 'video_complete' })
    onComplete?.()
  }

  const handleReplayFromStart = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    loadedAtRef.current = 0
    localStorage.removeItem(storageKey)
    setResumeFrom(0)
    try {
      const u = new URL(url)
      u.searchParams.set('source[transformation][start_offset]', '0')
      u.searchParams.set('_replay', String(Date.now()))
      setSrc(u.toString())
    } catch {
      setSrc(`${url}${url.includes('?') ? '&' : '?'}source%5Btransformation%5D%5Bstart_offset%5D=0&_replay=${Date.now()}`)
    }
  }

  return (
    <div className="w-full h-full flex flex-col bg-black">
      {resumeFrom > 5 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-foreground/90 text-background text-xs px-3 py-1.5 rounded-full shadow-lg pointer-events-none">
          Resuming from {formatTime(resumeFrom)}
        </div>
      )}
      <div className="flex-1 relative">
        <iframe
          src={src}
          className="absolute inset-0 w-full h-full border-0"
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          onLoad={handleLoad}
        />
      </div>
      {onComplete && (
        <div className="shrink-0 h-14 bg-background border-t flex items-center justify-end px-4">
          <button
            onClick={handleReplayFromStart}
            className="px-4 py-2 mr-2 bg-muted text-foreground rounded-lg text-sm font-medium"
          >
            Replay from start
          </button>
          <button
            onClick={handleContinue}
            className="px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium"
          >
            Mark complete &amp; continue
          </button>
        </div>
      )}
    </div>
  )
}

// ─── YouTube viewer — plain iframe only ──────────────────────────────────────
// YT.Player directly mutates React-owned DOM nodes (replaces them) which causes
// React's "insertBefore" / "NotFoundError" crash on every re-render.
// A plain <iframe> is owned by React — no external mutations, no crashes, no
// black screen. Position is saved via wall-clock estimation (±5 s accuracy).

function YouTubeViewer({ url, asset, sessionId, onComplete }: any) {
  const storageKey  = `yt-time-${asset.id}`
  const savedTime   = Math.floor(parseFloat(localStorage.getItem(storageKey) ?? '0') || 0)
  const loadedAtRef = useRef(0)
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const videoId     = getYouTubeVideoId(url)

  const handleLoad = useCallback(() => {
    loadedAtRef.current = Date.now()
    clearInterval(timerRef.current!)
    timerRef.current = setInterval(() => {
      const pos = savedTime + (Date.now() - loadedAtRef.current) / 1000
      localStorage.setItem(storageKey, String(pos))
    }, 5000)
    trackEvent({ sessionId, assetId: asset.id, eventType: 'video_play' })
  }, [savedTime, storageKey, sessionId, asset.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      clearInterval(timerRef.current!)
      if (loadedAtRef.current > 0) {
        const pos = savedTime + (Date.now() - loadedAtRef.current) / 1000
        if (pos > savedTime + 3) localStorage.setItem(storageKey, String(pos))
      }
    }
  }, [storageKey, savedTime]) // eslint-disable-line react-hooks/exhaustive-deps

  const src = videoId
    ? `https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1${savedTime > 5 ? `&start=${savedTime}` : ''}`
    : null

  if (!src) return <div className="absolute inset-0 bg-black" />

  return (
    <div className="absolute inset-0 flex flex-col bg-black">
      {savedTime > 5 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-foreground/90 text-background text-xs px-3 py-1.5 rounded-full shadow-lg pointer-events-none">
          Resuming from {formatTime(savedTime)}
        </div>
      )}
      <iframe
        src={src}
        className="flex-1 w-full border-0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        onLoad={handleLoad}
      />
      {onComplete && (
        <div className="shrink-0 h-14 bg-background border-t flex items-center justify-end px-4">
          <button
            onClick={() => {
              clearInterval(timerRef.current!)
              localStorage.removeItem(storageKey)
              trackEvent({ sessionId, assetId: asset.id, eventType: 'video_complete' })
              onComplete()
            }}
            className="px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium"
          >
            Mark complete &amp; continue
          </button>
        </div>
      )}
    </div>
  )
}

// ─── PDF viewer ──────────────────────────────────────────────────────────────

function PdfViewer({ asset, sessionId, onComplete }: any) {
  const [numPages, setNumPages] = useState<number>(0)
  const [scrollPct, setScrollPct] = useState(0)
  const [resumed, setResumed] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const storageKey = `pdf-scroll-${asset.id}`

  const pdfSrc = asset.fileUrl
    ? asset.fileUrl
    : `/api/pdf-proxy?url=${encodeURIComponent(asset.sourceUrl)}`

  // After pages render, restore saved scroll position
  useEffect(() => {
    if (numPages === 0) return
    const saved = localStorage.getItem(storageKey)
    if (!saved) return
    // Wait for react-pdf to render all page canvases
    const t = setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = Number(saved)
        setResumed(true)
        setTimeout(() => setResumed(false), 2500)
      }
    }, 400)
    return () => clearTimeout(t)
  }, [numPages, storageKey])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return

    // Update reading progress bar
    const pct = el.scrollHeight <= el.clientHeight
      ? 100
      : (el.scrollTop / (el.scrollHeight - el.clientHeight)) * 100
    setScrollPct(Math.round(pct))

    // Debounced save
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      localStorage.setItem(storageKey, String(el.scrollTop))
    }, 400)
  }, [storageKey])

  return (
    <div className="w-full h-full flex flex-col bg-muted/30">
      {/* Reading progress bar */}
      <div className="shrink-0 h-1 bg-muted w-full">
        <div
          className="h-full bg-primary transition-all duration-200"
          style={{ width: `${scrollPct}%` }}
        />
      </div>

      {/* "Resumed" toast */}
      {resumed && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-20 bg-foreground text-background text-xs px-3 py-1.5 rounded-full shadow-lg animate-in fade-in slide-in-from-top-2">
          Resumed from where you left off
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto flex flex-col items-center py-8 gap-6 px-4"
      >
        <Document
          file={pdfSrc}
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
          onLoadError={(err) => console.error('PDF load error:', err)}
          className="flex flex-col items-center gap-6 w-full"
        >
          {Array.from({ length: numPages }, (_, i) => (
            <div key={i} className="shadow-xl bg-white w-full max-w-4xl">
              <Page
                pageNumber={i + 1}
                width={Math.min(typeof window !== 'undefined' ? window.innerWidth - 64 : 800, 900)}
              />
            </div>
          ))}
        </Document>
        {numPages === 0 && (
          <div className="text-sm text-muted-foreground animate-pulse mt-16">Loading PDF…</div>
        )}
      </div>

      <div className="shrink-0 h-14 bg-background border-t flex items-center justify-between px-4">
        <span className="text-sm text-muted-foreground">
          {numPages > 0 ? `${numPages} pages · ${scrollPct}% read` : 'Loading…'}
        </span>
        <button
          onClick={onComplete}
          className="px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium"
        >
          Finish document
        </button>
      </div>
    </div>
  )
}

// ─── Article viewer ──────────────────────────────────────────────────────────

function ArticleViewer({ asset, sessionId, onComplete }: any) {
  const [iframeBlocked, setIframeBlocked] = useState(false)
  const url: string = asset.sourceUrl || ''

  // Some sites block iframe via X-Frame-Options. We can't detect this reliably,
  // so we show a fallback card alongside an always-visible "open in tab" button.
  return (
    <div className="w-full h-full flex flex-col">
      {/* address bar */}
      <div className="shrink-0 flex items-center gap-3 bg-muted/60 border-b px-4 py-2">
        <span className="flex-1 text-xs text-muted-foreground truncate">{url}</span>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 flex items-center gap-1.5 text-xs text-primary font-medium hover:underline"
        >
          Open in new tab
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      {/* iframe — will be blank if site sets X-Frame-Options */}
      <iframe
        src={url}
        className="flex-1 border-0 w-full"
        onError={() => setIframeBlocked(true)}
      />

      <div className="shrink-0 h-14 bg-background border-t flex items-center justify-end px-4">
        <button
          onClick={() => {
            trackEvent({ sessionId, assetId: asset.id, eventType: 'scroll_100' })
            onComplete?.()
          }}
          className="px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium"
        >
          Mark as read
        </button>
      </div>
    </div>
  )
}

// ─── Image viewer ─────────────────────────────────────────────────────────────

function ImageViewer({ asset, onComplete }: any) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-muted/10 p-8">
      <div className="flex-1 flex items-center justify-center overflow-hidden w-full">
        <img
          src={asset.fileUrl || asset.thumbnailUrl || asset.sourceUrl}
          alt={asset.title}
          className="max-w-full max-h-full object-contain shadow-md rounded-lg"
        />
      </div>
      <div className="shrink-0 mt-8">
        <button
          onClick={onComplete}
          className="px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium"
        >
          Continue
        </button>
      </div>
    </div>
  )
}
