'use client'

import { useState } from 'react'
import { FileText, Video, Link2, Image as ImageIcon, Pencil } from 'lucide-react'
import { AssetEditDialog } from '@/components/AssetEditDialog'

type Asset = {
  id: string
  title: string
  type: 'pdf' | 'video' | 'article' | 'image'
  thumbnailUrl: string | null
  sourceUrl: string | null
  fileUrl: string | null
  metadataJson?: unknown
}

function extractTags(metadataJson: unknown): string[] {
  if (!metadataJson || typeof metadataJson !== 'object') return []
  const maybeTags = (metadataJson as { tags?: unknown }).tags
  if (!Array.isArray(maybeTags)) return []
  return maybeTags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
}

function TypeIcon({ type }: { type: Asset['type'] }) {
  if (type === 'pdf') return <FileText className="h-4 w-4 text-muted-foreground" />
  if (type === 'video') return <Video className="h-4 w-4 text-muted-foreground" />
  if (type === 'image') return <ImageIcon className="h-4 w-4 text-muted-foreground" />
  return <Link2 className="h-4 w-4 text-muted-foreground" />
}

export function AssetGrid({ assets }: { assets: Asset[] }) {
  const [editing, setEditing] = useState<Asset | null>(null)

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {assets.map((asset) => (
          (() => {
            const tags = extractTags(asset.metadataJson)
            return (
          <button
            key={asset.id}
            onClick={() => setEditing(asset)}
            className="group relative text-left rounded-xl border bg-card hover:border-primary/40 hover:shadow-sm transition-all overflow-hidden"
          >
            {/* Thumbnail */}
            <div className="h-36 w-full bg-muted overflow-hidden">
              {asset.thumbnailUrl ? (
                <img
                  src={asset.thumbnailUrl}
                  alt={asset.title}
                  className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
              ) : (
                <div className="h-full w-full flex items-center justify-center">
                  <TypeIcon type={asset.type} />
                </div>
              )}
            </div>

            {/* Edit overlay */}
            <div className="absolute top-2 right-2 w-7 h-7 bg-black/50 text-white rounded-full items-center justify-center hidden group-hover:flex transition-all">
              <Pencil className="h-3.5 w-3.5" />
            </div>

            {/* Info */}
            <div className="p-3 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium leading-snug line-clamp-2">{asset.title}</p>
                <TypeIcon type={asset.type} />
              </div>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="inline-flex items-center rounded border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground truncate">
                {asset.sourceUrl || asset.fileUrl || '—'}
              </p>
            </div>
          </button>
            )
          })()
        ))}
      </div>

      {editing && (
        <AssetEditDialog
          asset={editing}
          open={true}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}
