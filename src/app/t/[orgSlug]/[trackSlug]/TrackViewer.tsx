'use client'

import { useState, useEffect } from 'react'
import { initializeTracking, trackEvent } from '@/lib/tracking'
import { Progress } from '@/components/ui/progress'
import dynamic from 'next/dynamic'
import { GateOverlay, type GateConfig } from '@/components/GateOverlay'

const AssetViewer = dynamic(() => import('./AssetViewer').then(m => m.AssetViewer), { ssr: false })

type TrackViewerProps = {
  track: { id: string; title: string; layout?: 'binge' | 'hub' | 'single'; gateConfigJson?: unknown }
  assets: Array<{ id: string; title: string }>
  org: { name: string }
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
  const layout: 'binge' | 'hub' | 'single' = track.layout ?? 'binge'
  const [currentAssetIndex, setCurrentAssetIndex] = useState(0)
  const effectiveIndex = layout === 'single' ? 0 : currentAssetIndex
  const currentAsset = assets[effectiveIndex]
  const [trackingInitialized, setTrackingInitialized] = useState(false)

  useEffect(() => {
    initializeTracking().then(() => setTrackingInitialized(true))
  }, [])

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

  const gateConfig = (track.gateConfigJson as GateConfig | null) ?? null

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="flex h-14 items-center justify-between px-4 border-b shrink-0 bg-background/95 backdrop-blur">
        <div>
          <div className="font-bold">{org.name} — {track.title}</div>
          {typeof returningVisitorName === 'string' && returningVisitorName.trim() && (
            <p className="text-xs text-muted-foreground">
              Welcome back, {returningVisitorName}
            </p>
          )}
        </div>
        <div className="text-sm text-muted-foreground">
          {effectiveIndex + 1} / {assets.length}
        </div>
      </header>

      {/* Progress bar */}
      {layout !== 'single' && <Progress value={progress} className="h-1 rounded-none shrink-0" />}

      {/* Main content */}
      {layout === 'hub' ? (
        <main className="flex-1 overflow-hidden bg-muted/20 flex">
          <aside className="w-72 border-r bg-background/90 overflow-y-auto p-3 space-y-2">
            {assets.map((asset, index) => {
              const active = index === effectiveIndex
              return (
                <button
                  key={asset.id}
                  onClick={() => setCurrentAssetIndex(index)}
                  className={`w-full text-left rounded-md border px-3 py-2 text-sm transition-colors ${
                    active
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background hover:bg-muted border-border'
                  }`}
                >
                  <div className="font-medium line-clamp-1">{asset.title}</div>
                  <div className={`text-xs mt-1 ${active ? 'text-primary-foreground/90' : 'text-muted-foreground'}`}>
                    Asset {index + 1}
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
            >
              <AssetViewer
                key={currentAsset.id}
                asset={currentAsset}
                sessionId={sessionId}
                onComplete={undefined}
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
          >
            <AssetViewer
              key={currentAsset.id}
              asset={currentAsset}
              sessionId={sessionId}
              onComplete={layout === 'binge' ? handleNext : undefined}
            />
          </GateOverlay>
        </main>
      )}

      {/* Navigation */}
      {layout === 'binge' && (
        <div className="flex h-14 items-center justify-between px-4 border-t shrink-0 bg-background">
          <button
            onClick={handlePrevious}
            disabled={currentAssetIndex === 0}
            className="px-4 py-2 text-sm font-medium bg-primary/85 text-primary-foreground rounded-md hover:bg-primary disabled:opacity-50"
          >
            Previous
          </button>
          <button
            onClick={handleNext}
            disabled={currentAssetIndex === assets.length - 1}
            className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md disabled:opacity-50"
          >
            Next Asset
          </button>
        </div>
      )}
    </div>
  )
}
