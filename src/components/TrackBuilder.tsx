'use client'

import { useState, useTransition, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  FileText, Video, Link2, Image as ImageIcon,
  Plus, Loader2, GripVertical, X, Mail, ChevronRight, MessageSquare, Pencil,
  ImagePlus, Megaphone,
} from 'lucide-react'
import { createTrack, updateTrack } from '@/app/dashboard/tracks/actions'
import type { LeadField, GateConfig } from '@/components/GateOverlay'
import { AssetUploadDialog } from '@/components/AssetUploadDialog'

type Asset = {
  id: string
  title: string
  type: 'pdf' | 'video' | 'article' | 'image'
  thumbnailUrl: string | null
  sourceUrl: string | null
}

type AssetOverride = { displayTitle?: string; subCopy?: string }

type TrackData = {
  id?: string
  title: string
  layout: 'binge' | 'hub' | 'single'
  status: 'draft' | 'published'
  assetIds: string[]
  assetOverrides?: Record<string, AssetOverride>
  gateConfigJson?: GateConfig | null
  themeJson?: ({
    seoTitle?: string
    chat?: {
      enabled?: boolean
      assistantName?: string
      meetingUrl?: string
      meetingCtaLabel?: string
      meetingCtaThreshold?: number
      systemPrompt?: string
    }
    brand?: {
      logoUrl?: string
      cta?: {
        enabled?: boolean
        label?: string
        action?: 'link' | 'chat'
        url?: string
        chatMessage?: string
      }
    }
  } & Record<string, unknown>) | null
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
  const [overrides, setOverrides] = useState<Record<string, AssetOverride>>(initialTrack?.assetOverrides ?? {})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [importedAssets, setImportedAssets] = useState<Asset[]>([])
  const [seoTitle, setSeoTitle] = useState(initialTrack?.themeJson?.seoTitle ?? '')
  const [isPending, startTransition] = useTransition()

  // ── Chat assistant config ────────────────────────────────────────────────
  const existingChat = initialTrack?.themeJson?.chat
  const [chatOpen, setChatOpen] = useState(false)
  const [chatEnabled, setChatEnabled] = useState<boolean>(existingChat?.enabled !== false)
  const [chatName, setChatName] = useState(existingChat?.assistantName ?? 'AI Assistant')
  const [chatMeetingUrl, setChatMeetingUrl] = useState(existingChat?.meetingUrl ?? '')
  const [chatMeetingLabel, setChatMeetingLabel] = useState(existingChat?.meetingCtaLabel ?? 'Book a meeting')
  const [chatThreshold, setChatThreshold] = useState<number>(existingChat?.meetingCtaThreshold ?? 3)
  const [chatSystemPrompt, setChatSystemPrompt] = useState(existingChat?.systemPrompt ?? '')

  // ── Branding & CTA config ────────────────────────────────────────────────
  const existingBrand = initialTrack?.themeJson?.brand
  const [brandOpen, setBrandOpen] = useState(false)
  const [logoUrl, setLogoUrl] = useState(existingBrand?.logoUrl ?? '')
  const [ctaEnabled, setCtaEnabled] = useState<boolean>(existingBrand?.cta?.enabled ?? false)
  const [ctaLabel, setCtaLabel] = useState(existingBrand?.cta?.label ?? "Let's talk")
  const [ctaAction, setCtaAction] = useState<'link' | 'chat'>(existingBrand?.cta?.action ?? 'link')
  const [ctaUrl, setCtaUrl] = useState(existingBrand?.cta?.url ?? '')
  const [ctaChatMessage, setCtaChatMessage] = useState(
    existingBrand?.cta?.chatMessage ?? 'Sure, let me set up a meeting with our sales team.'
  )

  function handleLogoFile(file: File) {
    const reader = new FileReader()
    reader.onload = () => setLogoUrl(String(reader.result ?? ''))
    reader.readAsDataURL(file)
  }

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

  const dragIndex = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  function handleDragStart(i: number) {
    dragIndex.current = i
  }

  function handleDragOver(e: React.DragEvent, i: number) {
    e.preventDefault()
    setDragOver(i)
  }

  function handleDrop(i: number) {
    const from = dragIndex.current
    if (from === null || from === i) { setDragOver(null); return }
    setSelectedIds((prev) => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(i, 0, moved)
      return next
    })
    dragIndex.current = null
    setDragOver(null)
  }

  function handleDragEnd() {
    dragIndex.current = null
    setDragOver(null)
  }

  function handleAssetsAdded(newAssets: Asset[]) {
    setImportedAssets((prev) => [...prev, ...newAssets])
    setSelectedIds((prev) => [...prev, ...newAssets.map((a) => a.id).filter((id) => !prev.includes(id))])
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
    const trimmedMeetingUrl = chatMeetingUrl.trim()
    const themeJson = {
      // Preserve any existing themeJson fields (leadScoring, experience config, etc.)
      ...(initialTrack?.themeJson ?? {}),
      seoTitle: seoTitle.trim() || null,
      chat: {
        enabled: chatEnabled,
        assistantName: chatName.trim() || 'AI Assistant',
        meetingUrl: trimmedMeetingUrl.startsWith('https://') ? trimmedMeetingUrl : undefined,
        meetingCtaLabel: chatMeetingLabel.trim() || 'Book a meeting',
        meetingCtaThreshold: chatThreshold,
        systemPrompt: chatSystemPrompt.trim() || undefined,
      },
      brand: {
        logoUrl: logoUrl.trim() || null,
        cta: {
          enabled: ctaEnabled,
          label: ctaLabel.trim() || "Let's talk",
          action: ctaAction,
          url: ctaAction === 'link' ? ctaUrl.trim() || undefined : undefined,
          chatMessage: ctaAction === 'chat' ? (ctaChatMessage.trim() || 'Sure, let me set up a meeting with our sales team.') : undefined,
        },
      },
    }
    const assetEntries = selectedIds.map((id) => ({
      assetId: id,
      displayTitle: overrides[id]?.displayTitle?.trim() || null,
      subCopy: overrides[id]?.subCopy?.trim() || null,
    }))
    startTransition(async () => {
      if (initialTrack?.id) {
        await updateTrack(initialTrack.id, { title, layout, status }, assetEntries, gateConfigJson, themeJson)
      } else {
        await createTrack(orgId, { title, layout, status }, assetEntries, gateConfigJson, themeJson)
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

      {/* SEO */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div>
          <h2 className="font-semibold text-sm">SEO</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Customize browser tab title for this public track</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="seo-title">SEO / Browser title</Label>
            <Input
              id="seo-title"
              placeholder="Content Engagement Platform | Product Tour"
              value={seoTitle}
              onChange={(e) => setSeoTitle(e.target.value)}
            />
          </div>
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
                  className={`rounded-lg border overflow-hidden transition-colors ${
                    dragOver === i ? 'border-primary' : ''
                  }`}
                >
                  <div
                    draggable
                    onDragStart={() => handleDragStart(i)}
                    onDragOver={(e) => handleDragOver(e, i)}
                    onDrop={() => handleDrop(i)}
                    onDragEnd={handleDragEnd}
                    className={`flex items-center gap-2 px-3 py-2.5 transition-colors ${
                      dragOver === i ? 'bg-primary/5' : 'bg-muted/30'
                    }`}
                  >
                    <span className="text-xs text-muted-foreground w-5 text-center shrink-0">{i + 1}</span>
                    <GripVertical className="h-4 w-4 text-muted-foreground/50 shrink-0 cursor-grab active:cursor-grabbing" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <AssetIcon type={asset.type} />
                        <span className="text-sm font-medium truncate">
                          {overrides[asset.id]?.displayTitle || asset.title}
                        </span>
                      </div>
                      {overrides[asset.id]?.subCopy ? (
                        <p className="text-xs text-muted-foreground truncate mt-0.5 italic">{overrides[asset.id].subCopy}</p>
                      ) : asset.sourceUrl ? (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{asset.sourceUrl}</p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setExpandedId(expandedId === asset.id ? null : asset.id)}
                        className={`p-1 rounded transition-colors ${expandedId === asset.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted text-muted-foreground'}`}
                        title="Customize title & sub copy"
                      >
                        <Pencil className="h-3.5 w-3.5" />
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
                  {expandedId === asset.id && (
                    <div className="px-3 pb-3 pt-2 border-t bg-muted/10 space-y-2">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Display title</label>
                        <Input
                          value={overrides[asset.id]?.displayTitle ?? ''}
                          onChange={(e) => setOverrides((prev) => ({ ...prev, [asset.id]: { ...prev[asset.id], displayTitle: e.target.value } }))}
                          placeholder={asset.title}
                          className="h-7 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Sub copy</label>
                        <Input
                          value={overrides[asset.id]?.subCopy ?? ''}
                          onChange={(e) => setOverrides((prev) => ({ ...prev, [asset.id]: { ...prev[asset.id], subCopy: e.target.value } }))}
                          placeholder="Optional subtitle shown below the title"
                          className="h-7 text-sm"
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground pt-1">
            {selectedIds.length} asset{selectedIds.length !== 1 ? 's' : ''} in track
          </p>
        </div>

        {/* Right: Asset library */}
        <div className="space-y-4">

          {/* Asset library */}
          <div className="rounded-xl border bg-card p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-sm">Asset Library</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Click to add to track</p>
              </div>
              <AssetUploadDialog organizationId={orgId} onAssetsAdded={handleAssetsAdded} />
            </div>
            {libraryAssets.length === 0 ? (
              <div className="flex h-20 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
                {allAvailableAssets.length === 0
                  ? 'No assets yet — add one from the button above'
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
                role="switch"
                aria-checked={lcEnabled}
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
                              role="switch"
                              aria-checked={field.enabled}
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
                              role="switch"
                              aria-checked={field.required}
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

      {/* ── Chat Assistant Config ───────────────────────────────────────── */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <button
          type="button"
          onClick={() => setChatOpen(o => !o)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/40 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${chatEnabled ? 'bg-primary/10' : 'bg-muted'}`}>
              <MessageSquare className={`w-4 h-4 ${chatEnabled ? 'text-primary' : 'text-muted-foreground'}`} />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold">Chat Assistant</p>
              <p className="text-xs text-muted-foreground">
                {chatEnabled
                  ? `${chatName || 'AI Assistant'}${chatSystemPrompt.trim() ? ' · custom prompt' : ''}${chatMeetingUrl.trim() ? ` · meeting CTA after ${chatThreshold} Qs` : ''}`
                  : 'Disabled'}
              </p>
            </div>
          </div>
          <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${chatOpen ? 'rotate-90' : ''}`} />
        </button>

        {chatOpen && (
          <div className="border-t px-5 pb-6 pt-5 space-y-5">
            {/* Enable toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Enable chat assistant</p>
                <p className="text-xs text-muted-foreground mt-0.5">Show the AI chat widget on this track&apos;s public page</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={chatEnabled}
                onClick={() => setChatEnabled(v => !v)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${chatEnabled ? 'bg-primary' : 'bg-muted-foreground/30'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${chatEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            {chatEnabled && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="chat-name">Assistant name</Label>
                  <Input
                    id="chat-name"
                    placeholder="AI Assistant"
                    value={chatName}
                    onChange={(e) => setChatName(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="chat-system-prompt">System prompt <span className="text-muted-foreground font-normal">(optional — overrides the assistant's default persona and conversation flow)</span></Label>
                  <textarea
                    id="chat-system-prompt"
                    placeholder="You are a smart, consultative assistant on a B2B marketing platform website..."
                    value={chatSystemPrompt}
                    onChange={(e) => setChatSystemPrompt(e.target.value)}
                    rows={8}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                  />
                  <p className="text-xs text-muted-foreground">
                    The assistant still only recommends real assets from this track and never invents titles, links, or stats. It automatically opens on its own once a visitor shows real engagement (3+ assets viewed, 90+ seconds on one asset, or 50%+ scroll on a document).
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="chat-meeting-url">Meeting booking URL <span className="text-muted-foreground font-normal">(optional, https only)</span></Label>
                  <Input
                    id="chat-meeting-url"
                    placeholder="https://calendar.app.google/..."
                    value={chatMeetingUrl}
                    onChange={(e) => setChatMeetingUrl(e.target.value)}
                  />
                  {chatMeetingUrl.trim() && !chatMeetingUrl.trim().startsWith('https://') && (
                    <p className="text-xs text-destructive">URL must start with https://</p>
                  )}
                </div>

                {chatMeetingUrl.trim().startsWith('https://') && (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="chat-meeting-label">Meeting button label</Label>
                      <Input
                        id="chat-meeting-label"
                        placeholder="Book a meeting"
                        value={chatMeetingLabel}
                        onChange={(e) => setChatMeetingLabel(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="chat-threshold">Show meeting card after</Label>
                      <div className="flex items-center gap-3">
                        <input
                          id="chat-threshold"
                          type="range"
                          min={1}
                          max={6}
                          value={chatThreshold}
                          onChange={(e) => setChatThreshold(Number(e.target.value))}
                          className="flex-1 accent-primary"
                        />
                        <span className="text-sm font-medium w-20 text-right">{chatThreshold} question{chatThreshold === 1 ? '' : 's'}</span>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Branding & CTA Config ───────────────────────────────────────── */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <button
          type="button"
          onClick={() => setBrandOpen(o => !o)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/40 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${logoUrl || ctaEnabled ? 'bg-primary/10' : 'bg-muted'}`}>
              <Megaphone className={`w-4 h-4 ${logoUrl || ctaEnabled ? 'text-primary' : 'text-muted-foreground'}`} />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold">Branding &amp; CTA</p>
              <p className="text-xs text-muted-foreground">
                {logoUrl ? 'Logo set' : 'No logo'}{ctaEnabled ? ` · CTA "${ctaLabel || "Let's talk"}"` : ''}
              </p>
            </div>
          </div>
          <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${brandOpen ? 'rotate-90' : ''}`} />
        </button>

        {brandOpen && (
          <div className="border-t px-5 pb-6 pt-5 space-y-5">
            <div className="space-y-1.5">
              <Label>Logo (hub layout sidebar)</Label>
              <div className="flex items-center gap-3">
                <div className="w-16 h-16 rounded-lg border bg-muted flex items-center justify-center overflow-hidden shrink-0">
                  {logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoUrl} alt="Logo preview" className="max-w-full max-h-full object-contain" />
                  ) : (
                    <ImagePlus className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 space-y-2">
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium cursor-pointer hover:bg-muted transition-colors">
                    <ImagePlus className="w-3.5 h-3.5" />
                    Upload logo
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogoFile(f) }}
                    />
                  </label>
                  {logoUrl && (
                    <button
                      type="button"
                      onClick={() => setLogoUrl('')}
                      className="ml-2 text-xs text-muted-foreground hover:text-destructive transition-colors"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Enable toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Enable CTA button</p>
                <p className="text-xs text-muted-foreground mt-0.5">Show a call-to-action button below the logo</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={ctaEnabled}
                onClick={() => setCtaEnabled(v => !v)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${ctaEnabled ? 'bg-primary' : 'bg-muted-foreground/30'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${ctaEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            {ctaEnabled && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="cta-label">Button label</Label>
                  <Input
                    id="cta-label"
                    placeholder="Let's talk"
                    value={ctaLabel}
                    onChange={(e) => setCtaLabel(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Action</Label>
                  <Select value={ctaAction} onValueChange={(v) => setCtaAction(v as typeof ctaAction)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="link">Open a link</SelectItem>
                      <SelectItem value="chat">Open chat assistant</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {ctaAction === 'link' ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="cta-url">Destination URL</Label>
                    <Input
                      id="cta-url"
                      placeholder="https://..."
                      value={ctaUrl}
                      onChange={(e) => setCtaUrl(e.target.value)}
                    />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="cta-chat-message">Assistant&apos;s opening message</Label>
                    <Input
                      id="cta-chat-message"
                      placeholder="Sure, let me set up a meeting with our sales team."
                      value={ctaChatMessage}
                      onChange={(e) => setCtaChatMessage(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Opens the chat widget and shows this message immediately, plus the meeting-booking button if a meeting URL is configured above.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
