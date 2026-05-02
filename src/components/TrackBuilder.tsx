'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  FileText, Video, Link2, Image as ImageIcon,
  Plus, Trash2, ChevronUp, ChevronDown, Loader2,
  GripVertical, UploadCloud, X,
} from 'lucide-react'
import { createTrack, updateTrack, bulkImportUrls } from '@/app/dashboard/tracks/actions'

type Asset = {
  id: string
  title: string
  type: 'pdf' | 'video' | 'article' | 'image'
  thumbnailUrl: string | null
  sourceUrl: string | null
}

type TrackData = {
  id?: string
  title: string
  layout: 'binge' | 'hub' | 'single'
  status: 'draft' | 'published'
  assetIds: string[]
}

function AssetIcon({ type }: { type: Asset['type'] }) {
  if (type === 'pdf') return <FileText className="h-3.5 w-3.5" />
  if (type === 'video') return <Video className="h-3.5 w-3.5" />
  if (type === 'image') return <ImageIcon className="h-3.5 w-3.5" />
  return <Link2 className="h-3.5 w-3.5" />
}

export function TrackBuilder({
  orgId,
  orgAssets,
  initialTrack,
}: {
  orgId: string
  orgAssets: Asset[]
  initialTrack?: TrackData
}) {
  const [title, setTitle] = useState(initialTrack?.title ?? '')
  const [layout, setLayout] = useState<TrackData['layout']>(initialTrack?.layout ?? 'binge')
  const [status, setStatus] = useState<TrackData['status']>(initialTrack?.status ?? 'draft')
  const [selectedIds, setSelectedIds] = useState<string[]>(initialTrack?.assetIds ?? [])
  const [bulkUrls, setBulkUrls] = useState('')
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkResult, setBulkResult] = useState<{ count: number; errors: number } | null>(null)
  const [importedAssets, setImportedAssets] = useState<Asset[]>([])
  const [isPending, startTransition] = useTransition()

  const allAvailableAssets = [...orgAssets, ...importedAssets]
  const trackAssets = selectedIds
    .map((id) => allAvailableAssets.find((a) => a.id === id))
    .filter(Boolean) as Asset[]

  const libraryAssets = allAvailableAssets.filter((a) => !selectedIds.includes(a.id))

  function addAsset(asset: Asset) {
    setSelectedIds((prev) => [...prev, asset.id])
  }

  function removeAsset(id: string) {
    setSelectedIds((prev) => prev.filter((x) => x !== id))
  }

  function moveUp(index: number) {
    if (index === 0) return
    setSelectedIds((prev) => {
      const next = [...prev]
      ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
      return next
    })
  }

  function moveDown(index: number) {
    setSelectedIds((prev) => {
      if (index === prev.length - 1) return prev
      const next = [...prev]
      ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
      return next
    })
  }

  async function handleBulkImport() {
    if (!bulkUrls.trim()) return
    setBulkLoading(true)
    setBulkResult(null)
    const { results, errors } = await bulkImportUrls(orgId, bulkUrls)
    const newAssets: Asset[] = results.map((r) => ({
      id: r.assetId,
      title: r.title,
      type: 'article',
      thumbnailUrl: null,
      sourceUrl: r.url,
    }))
    setImportedAssets((prev) => [...prev, ...newAssets])
    setSelectedIds((prev) => [...prev, ...newAssets.map((a) => a.id)])
    setBulkResult({ count: results.length, errors: errors.length })
    setBulkUrls('')
    setBulkLoading(false)
  }

  function handleSave() {
    if (!title.trim()) return
    startTransition(async () => {
      if (initialTrack?.id) {
        await updateTrack(initialTrack.id, { title, layout, status }, selectedIds)
      } else {
        await createTrack(orgId, { title, layout, status }, selectedIds)
      }
    })
  }

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-4">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="track-title">Track title</Label>
          <Input
            id="track-title"
            placeholder="e.g. Getting Started with Product X"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="text-base h-11"
          />
        </div>
        <div className="flex gap-3 items-end">
          <div className="space-y-1.5">
            <Label>Layout</Label>
            <Select value={layout} onValueChange={(v) => setLayout(v as typeof layout)}>
              <SelectTrigger className="w-[130px] h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="binge">Binge</SelectItem>
                <SelectItem value="hub">Hub</SelectItem>
                <SelectItem value="single">Single</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger className="w-[130px] h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="published">Published</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleSave} disabled={isPending || !title.trim()} className="h-11 px-6">
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {initialTrack?.id ? 'Save changes' : 'Create track'}
          </Button>
        </div>
      </div>

      {/* Two-panel builder */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

        {/* Left: Track asset order */}
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <div>
            <h2 className="font-semibold text-sm">Track Content</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Drag or reorder assets for your visitor journey</p>
          </div>
          {trackAssets.length === 0 ? (
            <div className="flex h-32 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
              Add assets from the library →
            </div>
          ) : (
            <div className="space-y-2">
              {trackAssets.map((asset, i) => (
                <div
                  key={asset.id}
                  className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2.5"
                >
                  <span className="text-xs text-muted-foreground w-5 text-center shrink-0">{i + 1}</span>
                  <GripVertical className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <AssetIcon type={asset.type} />
                      <span className="text-sm font-medium truncate">{asset.title}</span>
                    </div>
                    {asset.sourceUrl && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{asset.sourceUrl}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => moveUp(i)}
                      disabled={i === 0}
                      className="p-1 rounded hover:bg-muted disabled:opacity-30 transition-colors"
                      title="Move up"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => moveDown(i)}
                      disabled={i === trackAssets.length - 1}
                      className="p-1 rounded hover:bg-muted disabled:opacity-30 transition-colors"
                      title="Move down"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => removeAsset(asset.id)}
                      className="p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-colors"
                      title="Remove"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground pt-1">
            {selectedIds.length} asset{selectedIds.length !== 1 ? 's' : ''} in track
          </p>
        </div>

        {/* Right: Asset library + bulk import */}
        <div className="space-y-4">

          {/* Bulk URL import */}
          <div className="rounded-xl border bg-card p-5 space-y-3">
            <div>
              <h2 className="font-semibold text-sm">Bulk Import URLs</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Paste URLs, one per line — articles, YouTube videos, PDFs</p>
            </div>
            <Textarea
              placeholder={`https://blog.example.com/post-1\nhttps://youtube.com/watch?v=...\nhttps://docs.example.com/page`}
              value={bulkUrls}
              onChange={(e) => setBulkUrls(e.target.value)}
              rows={4}
              className="resize-none font-mono text-xs"
            />
            {bulkResult && (
              <p className="text-xs">
                <span className="text-primary font-medium">✓ {bulkResult.count} imported</span>
                {bulkResult.errors > 0 && (
                  <span className="text-destructive ml-2">{bulkResult.errors} failed</span>
                )}
              </p>
            )}
            <Button
              onClick={handleBulkImport}
              disabled={bulkLoading || !bulkUrls.trim()}
              size="sm"
              className="w-full"
            >
              {bulkLoading ? (
                <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Importing…</>
              ) : (
                <><UploadCloud className="mr-2 h-3.5 w-3.5" /> Import & add to track</>
              )}
            </Button>
          </div>

          {/* Asset library */}
          <div className="rounded-xl border bg-card p-5 space-y-3">
            <div>
              <h2 className="font-semibold text-sm">Asset Library</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Click to add to track</p>
            </div>
            {libraryAssets.length === 0 ? (
              <div className="flex h-20 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
                {allAvailableAssets.length === 0
                  ? 'No assets yet — import URLs above or upload in Asset Library'
                  : 'All assets are in the track'}
              </div>
            ) : (
              <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                {libraryAssets.map((asset) => (
                  <button
                    key={asset.id}
                    onClick={() => addAsset(asset)}
                    className="w-full flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left hover:border-primary/40 hover:bg-accent transition-colors group"
                  >
                    <div className="w-7 h-7 bg-muted rounded flex items-center justify-center shrink-0 group-hover:bg-primary/10 transition-colors">
                      <AssetIcon type={asset.type} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{asset.title}</p>
                      {asset.sourceUrl && (
                        <p className="text-xs text-muted-foreground truncate">{asset.sourceUrl}</p>
                      )}
                    </div>
                    <Plus className="h-4 w-4 text-muted-foreground group-hover:text-primary shrink-0 transition-colors" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
