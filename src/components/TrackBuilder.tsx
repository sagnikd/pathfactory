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
  Plus, ChevronUp, ChevronDown, Loader2,
  GripVertical, UploadCloud, X, Mail, ChevronRight,
} from 'lucide-react'
import { createTrack, updateTrack, bulkImportUrls } from '@/app/dashboard/tracks/actions'
import type { LeadField, GateConfig } from '@/components/GateOverlay'

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
  gateConfigJson?: GateConfig | null
}

const DEFAULT_LEAD_FIELDS: LeadField[] = [
  { name: 'email',     label: 'Work email',  type: 'email', enabled: true,  required: true  },
  { name: 'firstName', label: 'First name',  type: 'text',  enabled: true,  required: false },
  { name: 'lastName',  label: 'Last name',   type: 'text',  enabled: false, required: false },
  { name: 'company',   label: 'Company',     type: 'text',  enabled: false, required: false },
  { name: 'jobTitle',  label: 'Job title',   type: 'text',  enabled: false, required: false },
  { name: 'phone',     label: 'Phone',       type: 'tel',   enabled: false, required: false },
  { name: 'country',   label: 'Country',     type: 'text',  enabled: false, required: false },
  { name: 'city',      label: 'City',        type: 'text',  enabled: false, required: false },
]

// Names that belong to the built-in set — can be toggled but not deleted
const BUILTIN_NAMES = new Set(DEFAULT_LEAD_FIELDS.map(f => f.name))

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

  // ── Lead capture config ──────────────────────────────────────────────────
  const existingGate = initialTrack?.gateConfigJson
  const [lcOpen, setLcOpen] = useState(false)
  const [lcEnabled, setLcEnabled] = useState<boolean>(existingGate?.enabled ?? false)
  const [lcDelay, setLcDelay] = useState<number>(existingGate?.delaySeconds ?? 30)
  const [lcHeading, setLcHeading] = useState(existingGate?.heading ?? 'Continue reading')
  const [lcDescription, setLcDescription] = useState(existingGate?.description ?? 'Fill in your details to keep exploring.')
  const [lcFields, setLcFields] = useState<LeadField[]>(() => {
    const saved = existingGate?.fields
    if (!saved || saved.length === 0) return DEFAULT_LEAD_FIELDS
    // Merge: keep saved fields, append any new built-ins not yet in saved config
    const savedNames = new Set(saved.map((f: LeadField) => f.name))
    const newBuiltins = DEFAULT_LEAD_FIELDS.filter(f => !savedNames.has(f.name))
    return [...saved, ...newBuiltins]
  })

  const [newFieldLabel, setNewFieldLabel] = useState('')
  const [newFieldType,  setNewFieldType]  = useState<LeadField['type']>('text')

  function toggleField(name: string, key: 'enabled' | 'required') {
    setLcFields(prev => prev.map(f => {
      if (f.name !== name) return f
      if (f.name === 'email') return f                       // email always on + required
      if (key === 'required' && !f.enabled) return f         // can't require disabled field
      return { ...f, [key]: !f[key] }
    }))
  }

  function addCustomField() {
    const label = newFieldLabel.trim()
    if (!label) return
    // Generate a stable unique key from the label
    const base = label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    const name = base + '_' + Math.random().toString(36).slice(2, 6)
    setLcFields(prev => [...prev, { name, label, type: newFieldType, enabled: true, required: false }])
    setNewFieldLabel('')
    setNewFieldType('text')
  }

  function removeField(name: string) {
    if (BUILTIN_NAMES.has(name)) return   // built-ins can only be toggled off, not deleted
    setLcFields(prev => prev.filter(f => f.name !== name))
  }
  // ────────────────────────────────────────────────────────────────────────

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
    const gateConfigJson: GateConfig = {
      enabled: lcEnabled,
      delaySeconds: lcDelay,
      heading: lcHeading,
      description: lcDescription,
      fields: lcFields,
    }
    startTransition(async () => {
      if (initialTrack?.id) {
        await updateTrack(initialTrack.id, { title, layout, status }, selectedIds, gateConfigJson)
      } else {
        await createTrack(orgId, { title, layout, status }, selectedIds, gateConfigJson)
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

      {/* ── Lead Capture Config ─────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card overflow-hidden">
        {/* Collapsible header */}
        <button
          type="button"
          onClick={() => setLcOpen(o => !o)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/40 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${lcEnabled ? 'bg-primary/10' : 'bg-muted'}`}>
              <Mail className={`w-4 h-4 ${lcEnabled ? 'text-primary' : 'text-muted-foreground'}`} />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold">Lead Capture</p>
              <p className="text-xs text-muted-foreground">
                {lcEnabled
                  ? lcDelay === 0
                    ? 'Hard gate — form appears before content'
                    : `Form appears after ${lcDelay}s`
                  : 'Disabled'}
              </p>
            </div>
          </div>
          <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${lcOpen ? 'rotate-90' : ''}`} />
        </button>

        {lcOpen && (
          <div className="border-t px-5 pb-6 pt-5 space-y-6">

            {/* Enable toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Enable lead capture</p>
                <p className="text-xs text-muted-foreground mt-0.5">Show a form to visitors on this track</p>
              </div>
              <button
                type="button"
                onClick={() => setLcEnabled(v => !v)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${lcEnabled ? 'bg-primary' : 'bg-muted-foreground/30'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${lcEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            {lcEnabled && (
              <>
                {/* Delay */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    Delay before form appears
                  </Label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={0}
                      max={120}
                      step={5}
                      value={lcDelay}
                      onChange={e => setLcDelay(Number(e.target.value))}
                      className="flex-1 accent-primary"
                    />
                    <span className="text-sm font-mono w-20 text-right shrink-0">
                      {lcDelay === 0 ? 'Immediate (gate)' : `${lcDelay}s`}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {lcDelay === 0
                      ? 'Content is blocked until the visitor submits.'
                      : `Content is visible. Form slides in after ${lcDelay} seconds.`}
                  </p>
                </div>

                {/* Heading & description */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="lc-heading" className="text-sm font-medium">Form heading</Label>
                    <Input
                      id="lc-heading"
                      value={lcHeading}
                      onChange={e => setLcHeading(e.target.value)}
                      placeholder="Continue reading"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lc-desc" className="text-sm font-medium">Subheading</Label>
                    <Input
                      id="lc-desc"
                      value={lcDescription}
                      onChange={e => setLcDescription(e.target.value)}
                      placeholder="Fill in your details to keep exploring."
                    />
                  </div>
                </div>

                {/* Field config */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">Form fields</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <span className="inline-block w-2 h-2 rounded-full bg-primary/60" />
                      Company, Country &amp; City are auto-detected via IP
                    </p>
                  </div>
                  <div className="rounded-lg border overflow-hidden">
                    {/* Header */}
                    <div className="grid grid-cols-[1fr_72px_72px_32px] text-xs font-medium text-muted-foreground bg-muted/50 px-4 py-2">
                      <span>Field</span>
                      <span className="text-center">Show</span>
                      <span className="text-center">Required</span>
                      <span />
                    </div>

                    {/* Field rows */}
                    {lcFields.map(field => {
                      const isBuiltin = BUILTIN_NAMES.has(field.name)
                      const isAutoDetect = ['company', 'country', 'city'].includes(field.name)
                      return (
                        <div
                          key={field.name}
                          className="grid grid-cols-[1fr_72px_72px_32px] items-center px-4 py-2.5 border-t"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-sm truncate">{field.label}</span>
                            {isAutoDetect && (
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary shrink-0">
                                auto
                              </span>
                            )}
                          </div>

                          {/* Show toggle */}
                          <div className="flex justify-center">
                            <button
                              type="button"
                              disabled={field.name === 'email'}
                              onClick={() => toggleField(field.name, 'enabled')}
                              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${field.enabled ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                              title={field.name === 'email' ? 'Email is always shown' : undefined}
                            >
                              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${field.enabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                            </button>
                          </div>

                          {/* Required toggle */}
                          <div className="flex justify-center">
                            <button
                              type="button"
                              disabled={field.name === 'email' || !field.enabled}
                              onClick={() => toggleField(field.name, 'required')}
                              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${field.required ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                              title={!field.enabled ? 'Enable field first' : undefined}
                            >
                              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${field.required ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                            </button>
                          </div>

                          {/* Delete — only for custom fields */}
                          <div className="flex justify-center">
                            {!isBuiltin && (
                              <button
                                type="button"
                                onClick={() => removeField(field.name)}
                                className="p-0.5 rounded hover:text-destructive hover:bg-destructive/10 text-muted-foreground transition-colors"
                                title="Remove field"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}

                    {/* Add custom field row */}
                    <div className="border-t px-4 py-3 bg-muted/20">
                      <p className="text-xs font-medium text-muted-foreground mb-2">Add custom field</p>
                      <div className="flex items-center gap-2">
                        <Input
                          placeholder="Field label, e.g. Team size"
                          value={newFieldLabel}
                          onChange={e => setNewFieldLabel(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addCustomField())}
                          className="h-8 text-sm flex-1"
                        />
                        <select
                          value={newFieldType}
                          onChange={e => setNewFieldType(e.target.value as LeadField['type'])}
                          className="h-8 rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        >
                          <option value="text">Text</option>
                          <option value="email">Email</option>
                          <option value="tel">Phone</option>
                        </select>
                        <button
                          type="button"
                          onClick={addCustomField}
                          disabled={!newFieldLabel.trim()}
                          className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1 disabled:opacity-40 shrink-0"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Add
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
