'use client'

import { useState, useEffect, useRef } from 'react'
import { initializeTracking, trackEvent } from '@/lib/tracking'
import { Progress } from '@/components/ui/progress'
import dynamic from 'next/dynamic'
import { GateOverlay, type GateConfig } from '@/components/GateOverlay'
import { clientGeoLookup } from '@/lib/geoLookup'
import { TrackChatWidget } from '@/components/TrackChatWidget'
import { getTrackChatConfig } from '@/lib/trackChatConfig'
import { Download, Megaphone, ChevronLeft, ChevronRight } from 'lucide-react'

function LinkedInIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={props.className} aria-hidden="true">
      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.03-1.85-3.03-1.86 0-2.15 1.45-2.15 2.94v5.66H9.35V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.59 0 4.25 2.37 4.25 5.44v6.3zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z" />
    </svg>
  )
}

function FacebookIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={props.className} aria-hidden="true">
      <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5 3.66 9.15 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.51 1.49-3.9 3.77-3.9 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56v1.87h2.78l-.44 2.91h-2.34V22c4.78-.79 8.44-4.94 8.44-9.94z" />
    </svg>
  )
}

const AssetViewer = dynamic(() => import('./AssetViewer').then(m => m.AssetViewer), { ssr: false })

type TrackViewerProps = {
  track: { id: string; title: string; layout?: 'binge' | 'hub' | 'single'; gateConfigJson?: unknown; themeJson?: unknown }
  assets: Array<{
    id: string
    title: string
    displayTitle?: string | null
    subCopy?: string | null
    type?: 'pdf' | 'video' | 'article' | 'image'
    thumbnailUrl?: string | null
    sourceUrl?: string | null
    fileUrl?: string | null
    metadataJson?: unknown
  }>
  org: { id: string; name: string }
  sessionId: string | null
  visitorId: string | null
  returningVisitorName?: string | null
  returningVisitorCompany?: string | null
  isKnownVisitor?: boolean
  initialAssetIndex?: number
}

export default function TrackViewer({
  track,
  assets,
  org,
  sessionId,
  visitorId,
  returningVisitorName,
  returningVisitorCompany,
  isKnownVisitor = false,
  initialAssetIndex = 0,
}: TrackViewerProps) {
  function extractTags(metadataJson: unknown): string[] {
    if (!metadataJson || typeof metadataJson !== 'object') return []
    const maybeTags = (metadataJson as { tags?: unknown }).tags
    if (!Array.isArray(maybeTags)) return []
    return maybeTags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
  }

  const layout: 'binge' | 'hub' | 'single' = track.layout ?? 'binge'
  const [currentAssetIndex, setCurrentAssetIndex] = useState(initialAssetIndex)
  const effectiveIndex = layout === 'single' ? 0 : currentAssetIndex
  const currentAsset = assets[effectiveIndex]
  const [trackingInitialized, setTrackingInitialized] = useState(false)

  const gateConfig = (track.gateConfigJson as GateConfig | null) ?? null
  // Gate is already cleared if: no gate, gate disabled, or visitor is known (bypassGate)
  const gateActiveOnLoad = !!(gateConfig?.enabled) && !isKnownVisitor
  const [gateCleared, setGateCleared] = useState(!gateActiveOnLoad)
  // Fields submitted via the gate form on this session (first-time visitors)
  const [submittedFields, setSubmittedFields] = useState<Record<string, string> | null>(null)

  const chatConfig = getTrackChatConfig(track.themeJson)
  // Incremented each time the visitor clicks "Summarize" on the current asset —
  // TrackChatWidget watches this to pop open and ask for a summary.
  const [summarizeToken, setSummarizeToken] = useState(0)
  const handleSummarize = () => setSummarizeToken((t) => t + 1)

  // Incremented when the sidebar CTA is set to "open chat" — TrackChatWidget
  // watches this to pop open and post its canned opening message.
  const [ctaChatToken, setCtaChatToken] = useState(0)
  const handleCtaChat = () => setCtaChatToken((t) => t + 1)

  // ── Proactive engagement trigger (only when a custom system prompt is
  // configured) — pops the chat open on its own once the visitor has viewed
  // 3+ assets, spent 90+s on one asset, or scrolled 50%+ of a document.
  // Fires at most once per page load.
  const [proactiveToken, setProactiveToken] = useState(0)
  const proactiveFiredRef = useRef(false)
  const viewedAssetIdsRef = useRef<Set<string>>(new Set())
  const dwellSecondsRef = useRef(0)

  const handleProactiveTrigger = () => {
    if (proactiveFiredRef.current) return
    proactiveFiredRef.current = true
    setProactiveToken((t) => t + 1)
  }

  const handleScrollProgress = (pct: number) => {
    if (pct >= 50) handleProactiveTrigger()
  }

  useEffect(() => {
    if (!chatConfig.systemPrompt || !currentAsset) return
    viewedAssetIdsRef.current.add(currentAsset.id)
    dwellSecondsRef.current = 0
    if (viewedAssetIdsRef.current.size >= 3) handleProactiveTrigger()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAsset?.id, chatConfig.systemPrompt])

  useEffect(() => {
    if (!chatConfig.systemPrompt) return
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible' && document.hasFocus()) {
        dwellSecondsRef.current += 1
        if (dwellSecondsRef.current >= 90) handleProactiveTrigger()
      }
    }, 1000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAsset?.id, chatConfig.systemPrompt])

  const brand = (track.themeJson as {
    brand?: {
      logoUrl?: string
      cta?: { enabled?: boolean; label?: string; action?: 'link' | 'chat'; url?: string; chatMessage?: string }
    }
  } | null)?.brand ?? null
  const brandCta = brand?.cta?.enabled ? brand.cta : null

  useEffect(() => {
    initializeTracking().then(() => setTrackingInitialized(true))
  }, [])

  // Client-side geo lookup (visitor's own IP — no shared server rate-limit),
  // persisted to session.deviceJson via /api/session-geo so the end-of-session
  // summary email can report the visitor's company/location.
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
            city:    geo.city,
            company: geo.company,
          }),
        })
      } catch {
        // Best-effort — never block the visitor
      }
    })()
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Send a single end-of-session summary email when the visitor leaves the page
  // (tab close, navigation, or backgrounding). Uses sendBeacon so the request
  // survives page teardown. The API atomically claims the session so duplicate
  // beacons (visibilitychange + pagehide) only ever send one email; it also
  // applies its own "meaningful engagement" threshold before emailing.
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

  // view event now fired by AssetViewer after 15 s of active engagement

  // Keep URL in sync with current asset so each asset has a shareable link
  useEffect(() => {
    if (layout === 'single') return
    const url = new URL(window.location.href)
    url.searchParams.set('asset', String(effectiveIndex + 1))
    window.history.replaceState(null, '', url.toString())
  }, [effectiveIndex, layout])

  // Keep browser tab title in sync with the currently viewed asset
  useEffect(() => {
    if (currentAsset) {
      document.title = `${currentAsset.displayTitle ?? currentAsset.title} — ${track.title}`
    }
  }, [currentAsset, track.title])

  const progress = ((effectiveIndex + 1) / assets.length) * 100

  // Computed post-mount to avoid an SSR/CSR hydration mismatch (server has no window).
  const [shareUrl, setShareUrl] = useState('')
  useEffect(() => { setShareUrl(window.location.href) }, [])

  const downloadHref = currentAsset?.fileUrl || (currentAsset?.type === 'pdf' ? currentAsset?.sourceUrl : null) || null

  const handleCtaClick = () => {
    if (!brandCta) return
    if (brandCta.action === 'chat') handleCtaChat()
    else if (brandCta.url) window.open(brandCta.url, '_blank', 'noopener,noreferrer')
  }

  const handleNext = () => {
    if (currentAssetIndex < assets.length - 1) setCurrentAssetIndex(prev => prev + 1)
  }

  const handlePrevious = () => {
    if (currentAssetIndex > 0) setCurrentAssetIndex(prev => prev - 1)
  }

  const prevAsset = currentAssetIndex > 0 ? assets[currentAssetIndex - 1] : null
  const nextAsset = currentAssetIndex < assets.length - 1 ? assets[currentAssetIndex + 1] : null
  const assetThumb = (asset: typeof currentAsset) => asset?.thumbnailUrl || asset?.fileUrl || asset?.sourceUrl || null

  if (!currentAsset) {
    return <div className="p-8 text-center">No assets in this track.</div>
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="flex min-h-14 items-center justify-between gap-3 px-3 sm:px-4 py-2 border-b shrink-0 bg-background/95 backdrop-blur">
        <div className="min-w-0">
          <div className="font-bold text-sm sm:text-base truncate">{org.name} — {track.title}</div>
          {(() => {
            // Returning visitor: data comes from DB (server-side)
            if (isKnownVisitor && returningVisitorName?.trim()) {
              const company = returningVisitorCompany ?? null
              return (
                <p className="text-[11px] sm:text-xs text-muted-foreground truncate">
                  Welcome back, {returningVisitorName}{company ? ` from ${company}` : ''}
                </p>
              )
            }
            // First-time visitor: just submitted the gate form this session
            if (submittedFields) {
              const name    = submittedFields.firstName?.trim()
                           || submittedFields.email?.split('@')[0]?.replace(/[._-]+/g, ' ').trim()
                           || null
              const company = submittedFields.company?.trim() || null
              if (name) return (
                <p className="text-[11px] sm:text-xs text-muted-foreground truncate">
                  Welcome, {name}{company ? ` from ${company}` : ''}
                </p>
              )
            }
            return null
          })()}
        </div>
        <div className="text-xs sm:text-sm text-muted-foreground shrink-0">
          {effectiveIndex + 1} / {assets.length}
        </div>
      </header>

      {/* Progress bar */}
      {layout !== 'single' && <Progress value={progress} className="h-1 rounded-none shrink-0" />}

      {/* Main content */}
      {layout === 'hub' ? (
        <main className="flex-1 overflow-hidden bg-muted/20 flex flex-col lg:flex-row">
          <aside className="w-full lg:w-80 lg:border-r bg-background overflow-y-auto p-2 sm:p-3 space-y-2 max-h-56 lg:max-h-none border-b lg:border-b-0">
            {(brand?.logoUrl || brandCta) && (
              <div className="flex flex-col items-center text-center space-y-4 pb-4 mb-1 border-b">
                {brand?.logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={brand.logoUrl} alt={org.name} className="max-h-20 max-w-[220px] w-full object-contain" />
                )}
                <div className="flex items-center justify-center gap-2">
                  <a
                    href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Share on LinkedIn"
                    className="w-8 h-8 rounded-md border flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
                  >
                    <LinkedInIcon className="w-4 h-4" />
                  </a>
                  <a
                    href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Share on Facebook"
                    className="w-8 h-8 rounded-md border flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
                  >
                    <FacebookIcon className="w-4 h-4" />
                  </a>
                  {gateCleared && downloadHref && (
                    <a
                      href={downloadHref}
                      download
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Download current asset"
                      className="w-8 h-8 rounded-md border flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                    </a>
                  )}
                </div>
                {brandCta && (
                  <button
                    onClick={handleCtaClick}
                    className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors"
                  >
                    <Megaphone className="w-4 h-4" />
                    {brandCta.label || "Let's talk"}
                  </button>
                )}
              </div>
            )}
            {assets.map((asset, index) => {
              const active = index === effectiveIndex
              const tags = extractTags(asset.metadataJson)
              const fallbackTag = asset.type ? asset.type.toUpperCase() : 'ASSET'
              const thumb = asset.thumbnailUrl || asset.fileUrl || asset.sourceUrl || null
              return (
                <button
                  key={asset.id}
                  onClick={() => setCurrentAssetIndex(index)}
                  className={`w-full text-left rounded-lg border p-2.5 transition-colors ${
                    active
                      ? 'bg-primary/5 border-primary/40 shadow-sm'
                      : 'bg-card hover:bg-muted/50 border-border'
                  }`}
                >
                  <div className="flex gap-3 items-start">
                    <div className="w-16 h-12 rounded overflow-hidden bg-muted shrink-0 border">
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={thumb}
                          alt={asset.title}
                          className="w-full h-full object-cover object-left-top"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[10px] text-muted-foreground">No image</div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`font-medium text-sm line-clamp-2 ${active ? 'text-primary' : 'text-foreground'}`}>
                        {asset.displayTitle ?? asset.title}
                      </div>
                      {asset.subCopy && (
                        <div className="text-xs text-foreground/70 line-clamp-2 mt-0.5 leading-snug">{asset.subCopy}</div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1">
                        {(tags.length > 0 ? tags.slice(0, 3) : [fallbackTag]).map((tag) => (
                          <span
                            key={tag}
                            className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${
                              tag.toLowerCase() === 'pdf' || asset.type === 'pdf'
                                ? 'border-red-300 text-red-700 bg-red-50'
                                : 'border-primary/40 text-primary bg-primary/5'
                            }`}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </aside>
          <div className="flex-1 overflow-hidden relative">
            <GateOverlay
              trackId={track.id}
              visitorId={visitorId}
              gateConfig={gateConfig}
              bypassGate={isKnownVisitor}
              onUnlock={() => setGateCleared(true)}
              onSubmit={fields => setSubmittedFields(fields)}
            >
              <AssetViewer
                key={currentAsset.id}
                asset={currentAsset}
                sessionId={sessionId}
                gateCleared={gateCleared}
                onSummarize={chatConfig.enabled ? handleSummarize : undefined}
                showInlineDownload={false}
                onScrollProgress={handleScrollProgress}
              />
            </GateOverlay>
          </div>
        </main>
      ) : (
        <main className="flex-1 overflow-hidden relative bg-muted/20">
          <GateOverlay
            trackId={track.id}
            visitorId={visitorId}
            gateConfig={gateConfig}
            bypassGate={isKnownVisitor}
            onUnlock={() => setGateCleared(true)}
            onSubmit={fields => setSubmittedFields(fields)}
          >
            <AssetViewer
              key={currentAsset.id}
              asset={currentAsset}
              sessionId={sessionId}
              gateCleared={gateCleared}
              onSummarize={chatConfig.enabled ? handleSummarize : undefined}
              onScrollProgress={handleScrollProgress}
            />
          </GateOverlay>

          {layout === 'binge' && prevAsset && (
            <div className="group absolute left-3 top-1/2 -translate-y-1/2 z-20 flex items-center gap-3">
              <button
                onClick={handlePrevious}
                aria-label="Previous asset"
                className="w-11 h-11 shrink-0 rounded-full bg-background/85 backdrop-blur border shadow-md flex items-center justify-center text-foreground hover:bg-background transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                onClick={handlePrevious}
                aria-label={`Go to previous asset: ${prevAsset.displayTitle ?? prevAsset.title}`}
                className="w-72 text-left opacity-0 group-hover:opacity-100 transition-opacity duration-150 rounded-xl border bg-background/95 backdrop-blur shadow-xl overflow-hidden hover:border-primary/40"
              >
                <div className="w-full h-36 bg-muted shrink-0">
                  {assetThumb(prevAsset) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={assetThumb(prevAsset)!} alt="" className="w-full h-full object-cover object-left-top" />
                  ) : null}
                </div>
                <div className="p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Previous</p>
                  <p className="text-sm font-semibold line-clamp-2 mt-0.5">{prevAsset.displayTitle ?? prevAsset.title}</p>
                </div>
              </button>
            </div>
          )}

          {layout === 'binge' && nextAsset && (
            <div className="group absolute right-3 top-1/2 -translate-y-1/2 z-20 flex flex-row-reverse items-center gap-3">
              <button
                onClick={handleNext}
                aria-label="Next asset"
                className="w-11 h-11 shrink-0 rounded-full bg-background/85 backdrop-blur border shadow-md flex items-center justify-center text-foreground hover:bg-background transition-colors"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
              <button
                onClick={handleNext}
                aria-label={`Go to next asset: ${nextAsset.displayTitle ?? nextAsset.title}`}
                className="w-72 text-left opacity-0 group-hover:opacity-100 transition-opacity duration-150 rounded-xl border bg-background/95 backdrop-blur shadow-xl overflow-hidden hover:border-primary/40"
              >
                <div className="w-full h-36 bg-muted shrink-0">
                  {assetThumb(nextAsset) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={assetThumb(nextAsset)!} alt="" className="w-full h-full object-cover object-left-top" />
                  ) : null}
                </div>
                <div className="p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Next</p>
                  <p className="text-sm font-semibold line-clamp-2 mt-0.5">{nextAsset.displayTitle ?? nextAsset.title}</p>
                </div>
              </button>
            </div>
          )}
        </main>
      )}
      <TrackChatWidget
        trackId={track.id}
        sessionId={sessionId}
        visitorName={isKnownVisitor ? returningVisitorName : null}
        currentAssetId={currentAsset?.id}
        chatConfig={chatConfig}
        summarizeToken={summarizeToken}
        ctaChatToken={ctaChatToken}
        ctaChatMessage={brand?.cta?.chatMessage}
        proactiveToken={proactiveToken}
        proactiveAssetTitle={currentAsset?.displayTitle ?? currentAsset?.title}
      />
    </div>
  )
}
