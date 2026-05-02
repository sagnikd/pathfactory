'use client'

import { useState, useEffect } from 'react'
import { initializeTracking, trackEvent } from '@/lib/tracking'
import { Progress } from '@/components/ui/progress'
import dynamic from 'next/dynamic'

const AssetViewer = dynamic(() => import('./AssetViewer').then(m => m.AssetViewer), { ssr: false })

import { GateOverlay } from '@/components/GateOverlay'

export default function TrackViewer({ track, assets, org, sessionId, visitorId }: any) {
  const [currentAssetIndex, setCurrentAssetIndex] = useState(0)
  const currentAsset = assets[currentAssetIndex]
  const [trackingInitialized, setTrackingInitialized] = useState(false)

  useEffect(() => {
    initializeTracking().then(() => setTrackingInitialized(true))
  }, [])

  useEffect(() => {
    if (trackingInitialized && currentAsset && sessionId) {
      trackEvent({
        sessionId,
        assetId: currentAsset.id,
        eventType: 'view'
      })
    }
  }, [currentAssetIndex, trackingInitialized, currentAsset, sessionId])

  const progress = ((currentAssetIndex + 1) / assets.length) * 100

  const handleNext = () => {
    if (currentAssetIndex < assets.length - 1) {
      setCurrentAssetIndex(prev => prev + 1)
    }
  }

  const handlePrevious = () => {
    if (currentAssetIndex > 0) {
      setCurrentAssetIndex(prev => prev - 1)
    }
  }

  if (!currentAsset) {
    return <div className="p-8 text-center">No assets in this track.</div>
  }

  const gateConfig = track.gateConfigJson || {}
  let needsGate = false;
  if (gateConfig.position === 'gate') {
    needsGate = true;
  } else if (gateConfig.position === 'after_asset_n' && currentAssetIndex >= (gateConfig.n || 1)) {
    needsGate = true;
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="flex h-14 items-center justify-between px-4 border-b shrink-0 bg-background/95 backdrop-blur">
        <div className="font-bold">{org.name} - {track.title}</div>
        <div className="text-sm text-muted-foreground">
          Asset {currentAssetIndex + 1} of {assets.length}
        </div>
      </header>

      {/* Progress Bar */}
      <Progress value={progress} className="h-1 rounded-none shrink-0" />

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden relative bg-muted/20">
        <GateOverlay trackId={track.id} visitorId={visitorId} enabled={needsGate}>
          <AssetViewer 
            key={currentAsset.id}
            asset={currentAsset} 
            sessionId={sessionId}
            onComplete={track.layout === 'binge' ? handleNext : undefined}
          />
        </GateOverlay>
      </main>

      {/* Navigation (for mobile or single view) */}
      <div className="flex h-14 items-center justify-between px-4 border-t shrink-0 bg-background">
        <button 
          onClick={handlePrevious} 
          disabled={currentAssetIndex === 0}
          className="px-4 py-2 text-sm disabled:opacity-50 font-medium"
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
    </div>
  )
}
