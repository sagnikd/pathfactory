'use client'

import { useMemo, useState, useTransition } from 'react'
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
import { createExperience, updateExperience } from '@/app/dashboard/experiences/actions'
import { Loader2, Plus, UploadCloud, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useDropzone } from 'react-dropzone'

type TrackOption = {
  id: string
  title: string
  slug: string
  status: 'draft' | 'published'
}

type ExperienceData = {
  id?: string
  title: string
  status: 'draft' | 'published'
  seoTitle?: string | null
  viewMode?: 'showcase' | 'catalog'
  bannerImageUrl?: string | null
  headline?: string | null
  subheadline?: string | null
  ctaText?: string | null
  ctaUrl?: string | null
  ctaColor?: string | null
  ctaPlacement?: 'underHeadline' | 'topLeft' | 'topRight'
  selectedTrackIds?: string[]
  sectionHeadlines?: Record<string, string>
}

export function ExperienceBuilder({
  orgId,
  orgTracks,
  initialExperience,
}: {
  orgId: string
  orgTracks: TrackOption[]
  initialExperience?: ExperienceData
}) {
  const [title, setTitle] = useState(initialExperience?.title ?? '')
  const [status, setStatus] = useState<'draft' | 'published'>(initialExperience?.status ?? 'draft')
  const [seoTitle, setSeoTitle] = useState(initialExperience?.seoTitle ?? '')
  const [viewMode, setViewMode] = useState<'showcase' | 'catalog'>(initialExperience?.viewMode ?? 'showcase')
  const [bannerImageUrl, setBannerImageUrl] = useState(initialExperience?.bannerImageUrl ?? '')
  const [headline, setHeadline] = useState(initialExperience?.headline ?? '')
  const [subheadline, setSubheadline] = useState(initialExperience?.subheadline ?? '')
  const [ctaText, setCtaText] = useState(initialExperience?.ctaText ?? '')
  const [ctaUrl, setCtaUrl] = useState(initialExperience?.ctaUrl ?? '')
  const [ctaColor, setCtaColor] = useState(initialExperience?.ctaColor ?? '#f97316')
  const [ctaPlacement, setCtaPlacement] = useState<'underHeadline' | 'topLeft' | 'topRight'>(initialExperience?.ctaPlacement ?? 'underHeadline')
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>(initialExperience?.selectedTrackIds ?? [])
  const [sectionHeadlines, setSectionHeadlines] = useState<Record<string, string>>(initialExperience?.sectionHeadlines ?? {})
  const [uploadingBanner, setUploadingBanner] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function normalizeHexColor(input: string): string {
    const v = input.trim()
    const withHash = v.startsWith('#') ? v : `#${v}`
    const hex = withHash.toLowerCase()
    const isShort = /^#[0-9a-f]{3}$/.test(hex)
    const isLong = /^#[0-9a-f]{6}$/.test(hex)
    return isShort || isLong ? hex : '#f97316'
  }

  const selectedTracks = useMemo(
    () => selectedTrackIds.map((id) => orgTracks.find((t) => t.id === id)).filter(Boolean) as TrackOption[],
    [orgTracks, selectedTrackIds]
  )
  const availableTracks = orgTracks.filter((t) => !selectedTrackIds.includes(t.id))

  function addTrack(trackId: string) {
    setSelectedTrackIds((prev) => [...prev, trackId])
  }

  function removeTrack(trackId: string) {
    setSelectedTrackIds((prev) => prev.filter((id) => id !== trackId))
    setSectionHeadlines((prev) => {
      const next = { ...prev }
      delete next[trackId]
      return next
    })
  }

  function updateSectionHeadline(trackId: string, value: string) {
    setSectionHeadlines((prev) => ({ ...prev, [trackId]: value }))
  }

  function handleSave() {
    if (!title.trim()) return
    startTransition(async () => {
      const payload = {
        title: title.trim(),
        status,
        viewMode,
        bannerImageUrl,
        headline,
        subheadline,
        seoTitle,
        ctaText,
        ctaUrl,
        ctaColor: normalizeHexColor(ctaColor),
        ctaPlacement,
        selectedTrackIds,
        sectionHeadlines,
      }
      if (initialExperience?.id) {
        await updateExperience(initialExperience.id, payload)
      } else {
        await createExperience(orgId, payload)
      }
    })
  }

  async function uploadBanner(file: File) {
    setUploadingBanner(true)
    setUploadError(null)
    try {
      const supabase = createClient()
      const ext = file.name.split('.').pop() || 'jpg'
      const path = `${orgId}/experience-banners/${crypto.randomUUID()}.${ext}`
      const { error } = await supabase.storage.from('assets').upload(path, file, { upsert: true })
      if (error) throw error
      const { data } = supabase.storage.from('assets').getPublicUrl(path)
      setBannerImageUrl(data.publicUrl)
    } catch (error: unknown) {
      setUploadError(error instanceof Error ? error.message : 'Failed to upload banner image')
    } finally {
      setUploadingBanner(false)
    }
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (files) => files[0] && uploadBanner(files[0]),
    accept: { 'image/*': ['.jpg', '.jpeg', '.png', '.webp'] },
    maxFiles: 1,
    disabled: uploadingBanner || isPending,
  })

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex flex-col sm:flex-row gap-4 sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="exp-title">Experience title</Label>
            <Input
              id="exp-title"
              placeholder="e.g. Healthcare Resource Center"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as 'draft' | 'published')}>
              <SelectTrigger className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="published">Published</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>View</Label>
            <Select value={viewMode} onValueChange={(v) => setViewMode(v as 'showcase' | 'catalog')}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="showcase">Showcase</SelectItem>
                <SelectItem value="catalog">Catalog</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleSave} disabled={isPending || !title.trim()}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {initialExperience?.id ? 'Save changes' : 'Create experience'}
          </Button>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="exp-seo-title">SEO / Browser title</Label>
          <Input
            id="exp-seo-title"
            placeholder="Content Engagement Platform | Resource Center"
            value={seoTitle}
            onChange={(e) => setSeoTitle(e.target.value)}
          />
        </div>
      </div>

      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div>
          <h2 className="font-semibold text-sm">Page Hero</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Configure banner image and page headlines</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="exp-banner">Banner image URL</Label>
            <Input
              id="exp-banner"
              type="url"
              placeholder="https://example.com/banner.jpg"
              value={bannerImageUrl}
              onChange={(e) => setBannerImageUrl(e.target.value)}
            />
            <div
              {...getRootProps()}
              className={`mt-2 rounded-lg border-2 border-dashed p-4 transition-colors cursor-pointer ${
                isDragActive
                  ? 'border-primary bg-primary/5'
                  : 'border-muted-foreground/30 hover:border-primary/40 hover:bg-muted/30'
              } ${uploadingBanner ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <input {...getInputProps()} />
              <div className="flex items-center gap-2 text-sm">
                {uploadingBanner ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                <span>
                  {uploadingBanner
                    ? 'Uploading banner image...'
                    : isDragActive
                    ? 'Drop banner image here'
                    : 'Drag and drop banner image, or click to upload'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Supports JPG, PNG, WebP. Recommended size: 1440 × 550.</p>
            </div>
            {uploadError && <p className="text-xs text-destructive mt-1">{uploadError}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-headline">Headline</Label>
            <Input
              id="exp-headline"
              placeholder="Gigamon loves ALOT WAVES PRIVATE LIMITED"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-subheadline">Subheadline</Label>
            <Input
              id="exp-subheadline"
              placeholder="Simplify healthcare network operations..."
              value={subheadline}
              onChange={(e) => setSubheadline(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-cta-text">CTA text</Label>
            <Input
              id="exp-cta-text"
              placeholder="Learn more"
              value={ctaText}
              onChange={(e) => setCtaText(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-cta-url">CTA link URL</Label>
            <Input
              id="exp-cta-url"
              type="url"
              placeholder="https://example.com"
              value={ctaUrl}
              onChange={(e) => setCtaUrl(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-cta-color">CTA color</Label>
            <div className="flex items-center gap-2">
              <Input
                id="exp-cta-color"
                type="color"
                value={normalizeHexColor(ctaColor)}
                onChange={(e) => setCtaColor(e.target.value)}
                className="h-10 p-1 w-14"
              />
              <Input
                value={ctaColor}
                onChange={(e) => setCtaColor(e.target.value)}
                placeholder="#f97316"
                className="h-10 w-32 font-mono"
              />
            </div>
            <p className="text-xs text-muted-foreground">Supports hex values like #ff6a00 or ff6a00</p>
          </div>
          <div className="space-y-1.5">
            <Label>CTA placement</Label>
            <Select value={ctaPlacement} onValueChange={(v) => setCtaPlacement(v as 'underHeadline' | 'topLeft' | 'topRight')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="underHeadline">Under headline</SelectItem>
                <SelectItem value="topLeft">Top left</SelectItem>
                <SelectItem value="topRight">Top right</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div>
          <h2 className="font-semibold text-sm">Tracks on this page</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Pick multiple tracks and customize section headlines</p>
        </div>

        {availableTracks.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {availableTracks.map((track) => (
              <Button key={track.id} type="button" variant="outline" size="sm" onClick={() => addTrack(track.id)}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                {track.title}
              </Button>
            ))}
          </div>
        )}

        {selectedTracks.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            Add at least one track to build the experience page.
          </div>
        ) : (
          <div className="space-y-3">
            {selectedTracks.map((track) => (
              <div key={track.id} className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium">{track.title}</div>
                  <button
                    type="button"
                    onClick={() => removeTrack(track.id)}
                    className="p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`headline-${track.id}`}>Section headline for this track</Label>
                  <Input
                    id={`headline-${track.id}`}
                    placeholder={track.title}
                    value={sectionHeadlines[track.id] ?? ''}
                    onChange={(e) => updateSectionHeadline(track.id, e.target.value)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
