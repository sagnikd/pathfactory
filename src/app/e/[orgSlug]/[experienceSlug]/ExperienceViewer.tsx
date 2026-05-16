'use client'

import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'

type AssetCard = {
  id: string
  title: string
  type: 'pdf' | 'video' | 'article' | 'image'
  thumbnailUrl: string | null
  sourceUrl: string | null
  fileUrl: string | null
  tags: string[]
  trackId: string
  trackTitle: string
  trackSlug: string
}

type TrackSection = {
  id: string
  title: string
  slug: string
  headline: string
  assets: AssetCard[]
}

export default function ExperienceViewer({
  orgSlug,
  hero,
  sections,
  viewMode,
}: {
  orgSlug: string
  hero: {
    headline: string
    subheadline: string
    bannerImageUrl: string | null
    ctaText: string | null
    ctaUrl: string | null
    ctaColor: string
    ctaPlacement: 'underHeadline' | 'topLeft' | 'topRight'
  }
  sections: TrackSection[]
  viewMode: 'showcase' | 'catalog'
}) {
  const [query, setQuery] = useState('')
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [activeTrack, setActiveTrack] = useState<{
    url: string
    assetTitle: string
    trackTitle: string
  } | null>(null)
  const q = query.trim().toLowerCase()

  useEffect(() => {
    if (!activeTrack) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveTrack(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeTrack])

  const allAssets = useMemo(() => sections.flatMap((s) => s.assets), [sections])
  const availableTags = useMemo(() => {
    const tagCounts = new Map<string, number>()
    for (const a of allAssets) {
      for (const t of new Set(a.tags)) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)
    }
    return Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20)
  }, [allAssets])

  const filteredSections = useMemo(() => {
    if (!q) return sections
    return sections
      .map((section) => ({
        ...section,
        assets: section.assets.filter((a) => {
          const hay = `${a.title} ${a.type} ${a.tags.join(' ')} ${a.trackTitle}`.toLowerCase()
          return hay.includes(q)
        }),
      }))
      .filter((s) => s.assets.length > 0)
  }, [q, sections])

  const catalogSections = useMemo(() => {
    return filteredSections
      .map((section) => ({
        ...section,
        assets: section.assets.filter((a) => {
          if (selectedTypes.length > 0 && !selectedTypes.includes(a.type)) return false
          if (selectedTags.length > 0 && !selectedTags.some((t) => a.tags.includes(t))) return false
          return true
        }),
      }))
      .filter((s) => s.assets.length > 0)
  }, [filteredSections, selectedTypes, selectedTags])

  const totalMatches = filteredSections.reduce((sum, s) => sum + s.assets.length, 0)
  const ctaButton = hero.ctaText && hero.ctaUrl ? (
    <a
      href={hero.ctaUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center rounded-md px-4 py-2 text-sm font-semibold text-white shadow-sm"
      style={{ backgroundColor: hero.ctaColor || '#f97316' }}
    >
      {hero.ctaText}
    </a>
  ) : null
  const openTrackPopup = (asset: AssetCard, section: TrackSection) => {
    setActiveTrack({
      url: `/t/${orgSlug}/${section.slug}?assetId=${asset.id}`,
      assetTitle: asset.title,
      trackTitle: section.title,
    })
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="relative border-b">
        {hero.bannerImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={hero.bannerImageUrl} alt={hero.headline} className="w-full object-cover aspect-[1440/550] max-h-[550px]" />
        ) : (
          <div className="w-full bg-gradient-to-r from-slate-800 via-slate-700 to-slate-600 aspect-[1440/550] max-h-[550px]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-white/95 via-white/70 to-transparent" />
        {hero.ctaPlacement === 'topLeft' && ctaButton && (
          <div className="absolute left-4 top-4 z-20">
            {ctaButton}
          </div>
        )}
        {hero.ctaPlacement === 'topRight' && ctaButton && (
          <div className="absolute right-4 top-4 z-20">
            {ctaButton}
          </div>
        )}
        <div className="absolute inset-0 flex items-end">
          <div className="w-full max-w-6xl mx-auto px-4 pb-6">
            <h1 className="text-3xl md:text-4xl font-bold text-slate-900 max-w-3xl">{hero.headline}</h1>
            {hero.subheadline && <p className="mt-2 text-slate-700 text-base md:text-lg max-w-3xl">{hero.subheadline}</p>}
            {hero.ctaPlacement === 'underHeadline' && ctaButton && (
              <div className="mt-4">{ctaButton}</div>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Search across all tracks in this experience
            {q && <span className="ml-2">• {totalMatches} match{totalMatches !== 1 ? 'es' : ''}</span>}
          </p>
          <div className="flex items-center gap-2 rounded-lg border px-3 py-2 max-w-md">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title, type, or tag..."
              className="w-full bg-transparent outline-none text-sm"
            />
          </div>
        </div>

        {filteredSections.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
            No matching content found.
          </div>
        ) : (
          viewMode === 'catalog' ? (
            <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
              <aside className="rounded-xl border bg-card p-4 space-y-5 h-fit sticky top-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Content type</p>
                  <div className="space-y-2">
                    {(['video', 'article', 'pdf', 'image'] as const).map((type) => {
                      const count = allAssets.filter((a) => a.type === type).length
                      if (count === 0) return null
                      const active = selectedTypes.includes(type)
                      return (
                        <button
                          key={type}
                          type="button"
                          onClick={() => {
                            setSelectedTypes((prev) =>
                              prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
                            )
                          }}
                          className={`w-full text-left px-2 py-1.5 rounded text-sm border ${
                            active ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:bg-muted/50'
                          }`}
                        >
                          <span className="capitalize">{type}</span>
                          <span className="text-xs text-muted-foreground ml-2">({count})</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Topic</p>
                  <div className="space-y-2 max-h-72 overflow-auto pr-1">
                    {availableTags.map(([tag, count]) => {
                      const active = selectedTags.includes(tag)
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => {
                            setSelectedTags((prev) =>
                              prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
                            )
                          }}
                          className={`w-full text-left px-2 py-1.5 rounded text-sm border ${
                            active ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:bg-muted/50'
                          }`}
                        >
                          {tag}
                          <span className="text-xs text-muted-foreground ml-2">({count})</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </aside>
              <div className="space-y-8">
                {catalogSections.map((section) => (
                  <section key={section.id} className="space-y-3">
                    <h2 className="text-2xl font-semibold">{section.headline}</h2>
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {section.assets.map((asset) => (
                        <button
                          key={asset.id}
                          type="button"
                          onClick={() => openTrackPopup(asset, section)}
                          className="rounded-xl border bg-card overflow-hidden hover:border-primary/40 transition-colors text-left"
                        >
                          <div className="h-40 bg-muted">
                            {asset.thumbnailUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={asset.thumbnailUrl}
                                alt={asset.title}
                                className="w-full h-full object-cover object-left-top"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
                                {asset.type.toUpperCase()}
                              </div>
                            )}
                          </div>
                          <div className="p-3 space-y-2">
                            <p className="text-sm font-medium line-clamp-2">{asset.title}</p>
                            <div className="flex flex-wrap gap-1">
                              {(asset.tags.length > 0 ? [...new Set(asset.tags)].slice(0, 3) : [asset.type.toUpperCase()]).map((tag) => (
                                <span
                                  key={tag}
                                  className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                                    tag.toLowerCase() === 'pdf' || asset.type === 'pdf'
                                      ? 'border-red-300 text-red-700 bg-red-50'
                                      : 'border-primary/30 text-primary bg-primary/5'
                                  }`}
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          ) : (
          <div className="space-y-8">
            {filteredSections.map((section) => (
              <section key={section.id} className="space-y-3">
                <h2 className="text-2xl font-semibold">{section.headline}</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {section.assets.map((asset) => (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => openTrackPopup(asset, section)}
                      className="rounded-xl border bg-card overflow-hidden hover:border-primary/40 transition-colors text-left"
                    >
                      <div className="h-40 bg-muted">
                        {asset.thumbnailUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={asset.thumbnailUrl}
                            alt={asset.title}
                            className="w-full h-full object-cover object-left-top"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
                            {asset.type.toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div className="p-3 space-y-2">
                        <p className="text-sm font-medium line-clamp-2">{asset.title}</p>
                        <div className="flex flex-wrap gap-1">
                          {(asset.tags.length > 0 ? asset.tags.slice(0, 3) : [asset.type.toUpperCase()]).map((tag) => (
                            <span
                              key={tag}
                              className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                                tag.toLowerCase() === 'pdf' || asset.type === 'pdf'
                                  ? 'border-red-300 text-red-700 bg-red-50'
                                  : 'border-primary/30 text-primary bg-primary/5'
                              }`}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
          )
        )}
      </div>
      {activeTrack && (
        <div
          className="fixed inset-0 z-50 bg-black/60 p-3 sm:p-6"
          onClick={() => setActiveTrack(null)}
        >
          <div
            className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-background shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{activeTrack.trackTitle}</p>
                <p className="text-sm font-semibold">{activeTrack.assetTitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTrack(null)}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
              >
                Close
              </button>
            </div>
            <iframe
              src={activeTrack.url}
              title={`${activeTrack.trackTitle} content`}
              className="h-full w-full border-0"
              allow="autoplay; fullscreen; picture-in-picture"
            />
          </div>
        </div>
      )}
    </div>
  )
}
