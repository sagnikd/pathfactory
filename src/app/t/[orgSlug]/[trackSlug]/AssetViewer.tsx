'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { trackEvent } from '@/lib/tracking'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { ExternalLink, Sparkles } from 'lucide-react'

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

// Resume position for YouTube/Cloudinary iframes is a wall-clock estimate
// (no access to the real player position — see comment above YouTubeViewer).
// Cap how far it can drift so a backgrounded/idle tab left open for hours
// can't produce a nonsense "Resuming from 3:58:26".
const MAX_RESUME_SECONDS = 3 * 60 * 60 // 3 hours

function isPageActive(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus()
}

function formatTime(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}


// ─── Root viewer ─────────────────────────────────────────────────────────────

export function AssetViewer({ asset, sessionId, onSummarize, gateCleared = true, showInlineDownload = true, onScrollProgress }: any) {
  // ── Dwell-time tracking ──────────────────────────────────────────────────
  // Emit a `dwell_tick` every 10 s only while ALL of:
  //   1. Tab is visible (visibilitychange)
  //   2. Window has focus (focus/blur)
  //   3. Cursor is inside the browser viewport (mouseleave/mouseenter)
  //   4. User was active within the last 60 s (idle detection)
  useEffect(() => {
    const IDLE_MS = 15_000
    let viewFired = false
    let viewTimer: ReturnType<typeof setTimeout> | null = null
    let tickInterval: ReturnType<typeof setInterval> | null = null
    let cursorInPage = true
    let lastActivity = Date.now()

    const fireView = () => {
      if (viewFired) return
      viewFired = true
      trackEvent({ sessionId, assetId: asset.id, eventType: 'view' })
    }

    // Count as a view only after 15 s of active engagement
    viewTimer = setTimeout(fireView, 15_000)

    const recordActivity = () => { lastActivity = Date.now() }

    const isActive = () =>
      document.visibilityState === 'visible' &&
      document.hasFocus() &&
      cursorInPage &&
      Date.now() - lastActivity < IDLE_MS

    const startTicking = () => {
      if (tickInterval || !isActive()) return
      tickInterval = setInterval(() => {
        if (!isActive()) { stopTicking(); return }
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

    const handleFocus = () => startTicking()

    const handleBlur = () => {
      setTimeout(() => {
        if (document.activeElement?.tagName === 'IFRAME') return
        stopTicking()
      }, 0)
    }

    const handleMouseLeave = () => { cursorInPage = false; stopTicking() }
    const handleMouseEnter = () => { cursorInPage = true; recordActivity(); startTicking() }

    // Resume after idle if user moves mouse / types
    const handleActivity = () => {
      recordActivity()
      if (!tickInterval) startTicking()
    }

    if (isActive()) startTicking()

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus',     handleFocus)
    window.addEventListener('blur',      handleBlur)
    document.addEventListener('mouseleave', handleMouseLeave)
    document.addEventListener('mouseenter', handleMouseEnter)
    document.addEventListener('mousemove',  handleActivity)
    document.addEventListener('keydown',    handleActivity)
    document.addEventListener('scroll',     handleActivity, { passive: true })

    return () => {
      stopTicking()
      if (viewTimer) clearTimeout(viewTimer)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus',     handleFocus)
      window.removeEventListener('blur',      handleBlur)
      document.removeEventListener('mouseleave', handleMouseLeave)
      document.removeEventListener('mouseenter', handleMouseEnter)
      document.removeEventListener('mousemove',  handleActivity)
      document.removeEventListener('keydown',    handleActivity)
      document.removeEventListener('scroll',     handleActivity)
    }
  }, [asset.id, sessionId])
  // ────────────────────────────────────────────────────────────────────────

  const sourceUrl: string = asset.fileUrl || asset.sourceUrl || ''
  const treatAsCloudinaryVideo = asset.type === 'article' && isCloudinaryPlayerUrl(sourceUrl)

  return (
    <div className="relative w-full h-full">
      {(asset.type === 'video' || treatAsCloudinaryVideo) && <VideoViewer asset={asset} sessionId={sessionId} onSummarize={onSummarize} />}
      {asset.type === 'pdf'     && <PdfViewer     asset={asset} sessionId={sessionId} gateCleared={gateCleared} onSummarize={onSummarize} showInlineDownload={showInlineDownload} onScrollProgress={onScrollProgress} />}
      {asset.type === 'article' && /\.pdf(\?|$)/i.test(asset.sourceUrl || '') && <PdfViewer asset={asset} sessionId={sessionId} gateCleared={gateCleared} onSummarize={onSummarize} showInlineDownload={showInlineDownload} onScrollProgress={onScrollProgress} />}
      {asset.type === 'article' && !treatAsCloudinaryVideo && !/\.pdf(\?|$)/i.test(asset.sourceUrl || '') && <ArticleViewer asset={asset} sessionId={sessionId} onSummarize={onSummarize} />}
      {asset.type === 'image'   && <ImageViewer   asset={asset}                       onSummarize={onSummarize} />}
    </div>
  )
}

// ─── Video viewer (YouTube / Vimeo / direct file) ────────────────────────────

function VideoViewer({ asset, sessionId, onSummarize }: any) {
  const raw: string = asset.fileUrl || asset.sourceUrl || ''
  const isYouTube = raw.includes('youtube.com') || raw.includes('youtu.be')
  const isVimeo   = raw.includes('vimeo.com')
  const isCloudinary = isCloudinaryPlayerUrl(raw)

  if (isCloudinary) {
    return <CloudinaryViewer url={raw} asset={asset} sessionId={sessionId} onSummarize={onSummarize} />
  }

  if (isYouTube) {
    return <YouTubeViewer url={raw} asset={asset} sessionId={sessionId} onSummarize={onSummarize} />
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
        {onSummarize && (
          <div className="shrink-0 bg-background border-t flex items-center justify-end px-3 sm:px-4 py-2">
            <button
              onClick={() => { trackEvent({ sessionId, assetId: asset.id, eventType: 'video_complete' }); onSummarize() }}
              className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium"
            >
              <Sparkles className="h-4 w-4" />
              Summarize
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
        onEnded={() => { trackEvent({ sessionId, assetId: asset.id, eventType: 'video_complete' }); onSummarize?.() }}
      />
    </div>
  )
}

function CloudinaryViewer({ url, asset, sessionId, onSummarize }: any) {
  const storageKey = `cloudinary-time-${asset.id}`
  const initialSavedTime = Math.min(
    Math.floor(parseFloat(localStorage.getItem(storageKey) ?? '0') || 0),
    MAX_RESUME_SECONDS
  )
  const [resumeFrom, setResumeFrom] = useState(initialSavedTime)
  const [src, setSrc] = useState(() => withCloudinaryStartOffset(url, initialSavedTime))
  const loadedAtRef = useRef(0)
  const activeSecRef = useRef(0)
  const lastTickRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const handleLoad = useCallback(() => {
    loadedAtRef.current = Date.now()
    activeSecRef.current = 0
    lastTickRef.current = Date.now()
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      const now = Date.now()
      if (isPageActive()) activeSecRef.current += (now - lastTickRef.current) / 1000
      lastTickRef.current = now
      const pos = Math.min(resumeFrom + activeSecRef.current, resumeFrom + MAX_RESUME_SECONDS)
      localStorage.setItem(storageKey, String(pos))
    }, 5000)
    trackEvent({ sessionId, assetId: asset.id, eventType: 'video_play' })
  }, [resumeFrom, storageKey, sessionId, asset.id])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (loadedAtRef.current > 0) {
        const pos = Math.min(resumeFrom + activeSecRef.current, resumeFrom + MAX_RESUME_SECONDS)
        if (pos > resumeFrom + 3) localStorage.setItem(storageKey, String(pos))
      }
    }
  }, [resumeFrom, storageKey])

  const handleContinue = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    localStorage.removeItem(storageKey)
    trackEvent({ sessionId, assetId: asset.id, eventType: 'video_complete' })
    onSummarize?.()
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
      {onSummarize && (
        <div className="shrink-0 bg-background border-t flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 px-3 sm:px-4 py-2">
          <button
            onClick={handleReplayFromStart}
            className="w-full sm:w-auto px-4 py-2.5 bg-muted text-foreground rounded-lg text-sm font-medium"
          >
            Replay from start
          </button>
          <button
            onClick={handleContinue}
            className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium"
          >
            <Sparkles className="h-4 w-4" />
            Summarize
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
// black screen. Position is saved via wall-clock estimation while the tab is
// visible and focused (±5 s accuracy), capped at MAX_RESUME_SECONDS.

function YouTubeViewer({ url, asset, sessionId, onSummarize }: any) {
  const storageKey  = `yt-time-${asset.id}`
  const savedTime   = Math.min(
    Math.floor(parseFloat(localStorage.getItem(storageKey) ?? '0') || 0),
    MAX_RESUME_SECONDS
  )
  const loadedAtRef = useRef(0)
  const activeSecRef = useRef(0)
  const lastTickRef = useRef(0)
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const videoId     = getYouTubeVideoId(url)

  const handleLoad = useCallback(() => {
    loadedAtRef.current = Date.now()
    activeSecRef.current = 0
    lastTickRef.current = Date.now()
    clearInterval(timerRef.current!)
    timerRef.current = setInterval(() => {
      const now = Date.now()
      if (isPageActive()) activeSecRef.current += (now - lastTickRef.current) / 1000
      lastTickRef.current = now
      const pos = Math.min(savedTime + activeSecRef.current, savedTime + MAX_RESUME_SECONDS)
      localStorage.setItem(storageKey, String(pos))
    }, 5000)
    trackEvent({ sessionId, assetId: asset.id, eventType: 'video_play' })
  }, [savedTime, storageKey, sessionId, asset.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      clearInterval(timerRef.current!)
      if (loadedAtRef.current > 0) {
        const pos = Math.min(savedTime + activeSecRef.current, savedTime + MAX_RESUME_SECONDS)
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
      {onSummarize && (
        <div className="shrink-0 bg-background border-t flex items-center justify-end px-3 sm:px-4 py-2">
          <button
            onClick={() => {
              clearInterval(timerRef.current!)
              localStorage.removeItem(storageKey)
              trackEvent({ sessionId, assetId: asset.id, eventType: 'video_complete' })
              onSummarize()
            }}
            className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium"
          >
            <Sparkles className="h-4 w-4" />
            Summarize
          </button>
        </div>
      )}
    </div>
  )
}

// ─── PDF viewer ──────────────────────────────────────────────────────────────

function PdfViewer({ asset, sessionId, onSummarize, gateCleared = true, showInlineDownload = true, onScrollProgress }: any) {
  const [numPages, setNumPages] = useState<number>(0)
  const [scrollPct, setScrollPct] = useState(0)
  const [resumed, setResumed] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const storageKey = `pdf-scroll-${asset.id}`

  const pdfSrc = asset.fileUrl
    ? asset.fileUrl
    : `/api/pdf-proxy?url=${encodeURIComponent(asset.sourceUrl)}`
  const downloadHref = asset.fileUrl || asset.sourceUrl || pdfSrc

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
    const rounded = Math.round(pct)
    setScrollPct(rounded)
    onScrollProgress?.(rounded)

    // Debounced save
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      localStorage.setItem(storageKey, String(el.scrollTop))
    }, 400)
  }, [storageKey, onScrollProgress])

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
        onClick={(e) => {
          const anchor = (e.target as Element).closest('a')
          if (!anchor) return
          const href = anchor.getAttribute('href') || undefined
          // Annotation layer <a> tags are overlays — their textContent is "Link".
          // Use elementsFromPoint to read the actual text layer spans underneath.
          const rect = anchor.getBoundingClientRect()
          const cx = rect.left + rect.width / 2
          const cy = rect.top + rect.height / 2
          const textBelow = document.elementsFromPoint(cx, cy)
            .filter(el => el.tagName === 'SPAN' && el.closest('.react-pdf__Page__textContent'))
            .map(el => el.textContent?.trim())
            .filter(Boolean)
            .join(' ')
          const label = textBelow || anchor.getAttribute('aria-label') || anchor.getAttribute('title') || href || 'Link'
          trackEvent({ sessionId, assetId: asset.id, eventType: 'click', payloadJson: { label, href, source: 'pdf_link' } })
        }}
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

      <div className="shrink-0 bg-background border-t flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 px-3 sm:px-4 py-2">
        <span className="text-xs sm:text-sm text-muted-foreground">
          {numPages > 0 ? `${numPages} pages · ${scrollPct}% read` : 'Loading…'}
        </span>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          {gateCleared && showInlineDownload && (
            <a
              href={downloadHref}
              download
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto text-center px-4 py-2.5 bg-secondary text-secondary-foreground rounded-lg text-sm font-medium"
            >
              Download PDF
            </a>
          )}
          <button
            onClick={() => onSummarize?.()}
            disabled={!onSummarize}
            className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" />
            Summarize
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Article viewer ──────────────────────────────────────────────────────────

function ArticleViewer({ asset, sessionId, onSummarize }: any) {
  const [iframeBlocked, setIframeBlocked] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const url: string = asset.sourceUrl || ''

  // Detect clicks inside cross-origin iframe via window blur
  useEffect(() => {
    const handleBlur = () => {
      if (document.activeElement === iframeRef.current) {
        trackEvent({ sessionId, assetId: asset.id, eventType: 'click', payloadJson: { label: null, source: 'article_iframe' } })
        // Restore focus so subsequent blur events keep firing
        setTimeout(() => window.focus(), 0)
      }
    }
    window.addEventListener('blur', handleBlur)
    return () => window.removeEventListener('blur', handleBlur)
  }, [sessionId, asset.id])

  // Some sites block iframe via X-Frame-Options. We can't detect this reliably,
  // so we show a fallback card alongside an always-visible "open in tab" button.
  return (
    <div className="w-full h-full flex flex-col">
      {/* address bar */}
      <div className="shrink-0 flex items-center gap-3 bg-muted/60 border-b px-3 sm:px-4 py-2">
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
        ref={iframeRef}
        src={url}
        className="flex-1 border-0 w-full"
        onError={() => setIframeBlocked(true)}
      />

      <div className="shrink-0 bg-background border-t flex items-center justify-end px-3 sm:px-4 py-2">
        <button
          onClick={() => {
            trackEvent({ sessionId, assetId: asset.id, eventType: 'scroll_100' })
            onSummarize?.()
          }}
          className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium"
        >
          <Sparkles className="h-4 w-4" />
          Summarize
        </button>
      </div>
    </div>
  )
}

// ─── Image viewer ─────────────────────────────────────────────────────────────

function ImageViewer({ asset, onSummarize }: any) {
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
          onClick={onSummarize}
          className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium"
        >
          <Sparkles className="h-4 w-4" />
          Summarize
        </button>
      </div>
    </div>
  )
}
