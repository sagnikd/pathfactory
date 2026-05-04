'use client'

import { useState, useEffect } from 'react'
import { initializeTracking, trackEvent } from '@/lib/tracking'
import { Progress } from '@/components/ui/progress'
import dynamic from 'next/dynamic'
import { GateOverlay, type GateConfig } from '@/components/GateOverlay'
import { createClient } from '@/lib/supabase/client'

const AssetViewer = dynamic(() => import('./AssetViewer').then(m => m.AssetViewer), { ssr: false })

type TrackViewerProps = {
  track: { id: string; title: string; layout?: 'binge' | 'hub' | 'single'; gateConfigJson?: unknown }
  assets: Array<{
    id: string
    title: string
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
  isKnownVisitor?: boolean
}

export default function TrackViewer({
  track,
  assets,
  org,
  sessionId,
  visitorId,
  returningVisitorName,
  isKnownVisitor = false,
}: TrackViewerProps) {
  function extractTags(metadataJson: unknown): string[] {
    if (!metadataJson || typeof metadataJson !== 'object') return []
    const maybeTags = (metadataJson as { tags?: unknown }).tags
    if (!Array.isArray(maybeTags)) return []
    return maybeTags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
  }

  const layout: 'binge' | 'hub' | 'single' = track.layout ?? 'binge'
  const [currentAssetIndex, setCurrentAssetIndex] = useState(0)
  const effectiveIndex = layout === 'single' ? 0 : currentAssetIndex
  const currentAsset = assets[effectiveIndex]
  const [trackingInitialized, setTrackingInitialized] = useState(false)

  const gateConfig = (track.gateConfigJson as GateConfig | null) ?? null
  // Gate is already cleared if: no gate, gate disabled, or visitor is known (bypassGate)
  const gateActiveOnLoad = !!(gateConfig?.enabled) && !isKnownVisitor
  const [gateCleared, setGateCleared] = useState(!gateActiveOnLoad)

  useEffect(() => {
    initializeTracking().then(() => setTrackingInitialized(true))
  }, [])

  // 1. Back-fill geo for the session (best-effort).
  // 2. Broadcast a visitor-alert so the dashboard notification bell fires
  //    immediately — uses Supabase broadcast (no Realtime table config needed).
  useEffect(() => {
    if (!sessionId || !org.id) return

    const orgId = org.id
    const trackTitle = track.title
    const trackId = track.id

    ;(async () => {
      try {
        const geoRes = await fetch('/api/session-geo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        })
        const geo = geoRes.ok ? await geoRes.json() : {}

        // Broadcast to the org's notification channel so the dashboard bell fires
        const supabase = createClient()
        await supabase.channel(`visitor-alerts:${orgId}`)
          .send({
            type: 'broadcast',
            event: 'new-session',
            payload: {
              id:         sessionId,
              trackId,
              trackTitle,
              company:    geo.company    ?? null,
              country:    geo.country    ?? null,
              city:       geo.city       ?? null,
              startedAt:  new Date().toISOString(),
            },
          })
      } catch {
        // Best-effort — never block the visitor
      }
    })()
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (trackingInitialized && currentAsset && sessionId) {
      trackEvent({ sessionId, assetId: currentAsset.id, eventType: 'view' })
    }
  }, [effectiveIndex, trackingInitialized, currentAsset, sessionId])

  const progress = ((effectiveIndex + 1) / assets.length) * 100

  const handleNext = () => {
    if (currentAssetIndex < assets.length - 1) setCurrentAssetIndex(prev => prev + 1)
  }

  const handlePrevious = () => {
    if (currentAssetIndex > 0) setCurrentAssetIndex(prev => prev - 1)
  }

  if (!currentAsset) {
    return <div className="p-8 text-center">No assets in this track.</div>
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="flex min-h-14 items-center justify-between gap-3 px-3 sm:px-4 py-2 border-b shrink-0 bg-background/95 backdrop-blur">
        <div className="min-w-0">
          <div className="font-bold text-sm sm:text-base truncate">{org.name} — {track.title}</div>
          {typeof returningVisitorName === 'string' && returningVisitorName.trim() && (
            <p className="text-[11px] sm:text-xs text-muted-foreground truncate">
              Welcome {returningVisitorName} from {org.name}
            </p>
          )}
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
                        {asset.title}
                      </div>
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
            >
              <AssetViewer
                key={currentAsset.id}
                asset={currentAsset}
                sessionId={sessionId}
                gateCleared={gateCleared}
                onComplete={handleNext}
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
          >
            <AssetViewer
              key={currentAsset.id}
              asset={currentAsset}
              sessionId={sessionId}
              gateCleared={gateCleared}
              onComplete={layout === 'binge' ? handleNext : undefined}
            />
          </GateOverlay>
        </main>
      )}

      {/* Navigation */}
      {layout === 'binge' && (
        <div className="grid grid-cols-2 gap-2 p-2 sm:p-3 border-t shrink-0 bg-background">
          <button
            onClick={handlePrevious}
            disabled={currentAssetIndex === 0}
            className="w-full px-3 py-2.5 text-sm font-medium bg-primary/85 text-primary-foreground rounded-md hover:bg-primary disabled:opacity-50"
          >
            Previous
          </button>
          <button
            onClick={handleNext}
            disabled={currentAssetIndex === assets.length - 1}
            className="w-full px-3 py-2.5 text-sm font-medium bg-primary text-primary-foreground rounded-md disabled:opacity-50"
          >
            Next Asset
          </button>
        </div>
      )}
    </div>
  )
}
