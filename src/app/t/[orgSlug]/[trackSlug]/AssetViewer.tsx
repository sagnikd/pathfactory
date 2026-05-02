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

  useEffect(() => {
    if (!showCountdown) return
    if (countdown > 0) {
      const t = setTimeout(() => setCountdown(c => c - 1), 1000)
      return () => clearTimeout(t)
    }
    setShowCountdown(false)
    onComplete()
  }, [showCountdown, countdown, onComplete])

  return (
    <div className="relative w-full h-full">
      {asset.type === 'video'   && <VideoViewer   asset={asset} sessionId={sessionId} onComplete={handleAssetComplete} />}
      {asset.type === 'pdf'     && <PdfViewer     asset={asset} sessionId={sessionId} onComplete={handleAssetComplete} />}
      {asset.type === 'article' && /\.pdf(\?|$)/i.test(asset.sourceUrl || '') && <PdfViewer asset={asset} sessionId={sessionId} onComplete={handleAssetComplete} />}
      {asset.type === 'article' && !/\.pdf(\?|$)/i.test(asset.sourceUrl || '') && <ArticleViewer asset={asset} sessionId={sessionId} onComplete={handleAssetComplete} />}
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

  if (isYouTube) {
    return <YouTubeViewer url={raw} asset={asset} sessionId={sessionId} onComplete={onComplete} />
  }

  if (isVimeo) {
    const embedUrl = getVimeoEmbedUrl(raw)
    return (
      <div className="w-full h-full flex flex-col bg-black">
        <div className="flex-1 relative">
          <iframe
            src={embedUrl ?? raw}
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

// ─── YouTube viewer — plain iframe + postMessage protocol (no YT.Player API) ──
// YT.Player replaces the iframe it targets, stripping our CSS classes → black box.
// Instead we use YouTube's underlying postMessage protocol directly.

function YouTubeViewer({ url, asset, sessionId, onComplete }: any) {
  const iframeRef  = useRef<HTMLIFrameElement>(null)
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null)
  const playRef    = useRef<{ startWall: number; startPos: number } | null>(null)
  const storageKey = `yt-time-${asset.id}`

  const videoId  = getYouTubeVideoId(url)
  const savedTime = Math.floor(parseFloat(localStorage.getItem(storageKey) ?? '0') || 0)
  const [resumed, setResumed] = useState(false)

  const src = videoId
    ? `https://www.youtube.com/embed/${videoId}?enablejsapi=1&rel=0&modestbranding=1${savedTime > 5 ? `&start=${savedTime}` : ''}`
    : null

  // Show "resuming" toast once on mount if there's a saved position
  useEffect(() => {
    if (savedTime > 5) {
      setResumed(true)
      const t = setTimeout(() => setResumed(false), 3000)
      return () => clearTimeout(t)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // postMessage event listener for YouTube state changes
  useEffect(() => {
    const savePos = () => {
      if (playRef.current) {
        const pos = playRef.current.startPos + (Date.now() - playRef.current.startWall) / 1000
        localStorage.setItem(storageKey, String(pos))
      }
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== 'https://www.youtube.com') return
      let data: any
      try { data = JSON.parse(event.data) } catch { return }

      if (data.event === 'onReady') {
        // Subscribe to state change events
        iframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({ event: 'command', func: 'addEventListener', args: ['onStateChange'] }),
          'https://www.youtube.com'
        )
      }

      if (data.event === 'onStateChange') {
        const state = data.info
        // 1 = playing, 2 = paused, 0 = ended
        if (state === 1) {
          trackEvent({ sessionId, assetId: asset.id, eventType: 'video_play' })
          const currentPos = parseFloat(localStorage.getItem(storageKey) ?? '0') || savedTime
          playRef.current = { startWall: Date.now(), startPos: currentPos }
          timerRef.current = setInterval(savePos, 3000)
        }
        if (state === 2) {
          clearInterval(timerRef.current!)
          savePos()
          playRef.current = null
          trackEvent({ sessionId, assetId: asset.id, eventType: 'video_pause' })
        }
        if (state === 0) {
          clearInterval(timerRef.current!)
          localStorage.removeItem(storageKey)
          trackEvent({ sessionId, assetId: asset.id, eventType: 'video_complete' })
          onComplete?.()
        }
      }
    }

    window.addEventListener('message', handleMessage)
    return () => {
      window.removeEventListener('message', handleMessage)
      clearInterval(timerRef.current!)
      savePos()
    }
  }, [asset.id, sessionId, storageKey, savedTime, onComplete])

  // Tell the iframe we're listening once it finishes loading
  const handleLoad = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'listening', id: 1 }),
      'https://www.youtube.com'
    )
  }, [])

  if (!src) return <div className="w-full h-full bg-black" />

  return (
    <div className="w-full h-full bg-black relative flex flex-col">
      {resumed && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-foreground/90 text-background text-xs px-3 py-1.5 rounded-full shadow-lg pointer-events-none">
          Resuming from {formatTime(savedTime)}
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={src}
        className="flex-1 w-full border-0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        onLoad={handleLoad}
      />
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
