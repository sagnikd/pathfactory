'use client'

import { useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, UploadCloud, X, FileText, Video, Link2, Image as ImageIcon } from 'lucide-react'
import { updateAsset } from '@/app/dashboard/assets/actions'
import { createClient } from '@/lib/supabase/client'

type Asset = {
  id: string
  title: string
  type: 'pdf' | 'video' | 'article' | 'image'
  thumbnailUrl: string | null
  sourceUrl: string | null
  fileUrl: string | null
}

function TypeIcon({ type }: { type: Asset['type'] }) {
  if (type === 'pdf') return <FileText className="h-5 w-5" />
  if (type === 'video') return <Video className="h-5 w-5" />
  if (type === 'image') return <ImageIcon className="h-5 w-5" />
  return <Link2 className="h-5 w-5" />
}

export function AssetEditDialog({
  asset,
  open,
  onClose,
}: {
  asset: Asset
  open: boolean
  onClose: () => void
}) {
  const [title, setTitle] = useState(asset.title)
  const [thumbnailUrl, setThumbnailUrl] = useState(asset.thumbnailUrl ?? '')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function uploadImage(file: File) {
    setUploading(true)
    setError(null)
    try {
      const supabase = createClient()
      const ext = file.name.split('.').pop()
      const path = `thumbnails/${asset.id}/${crypto.randomUUID()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('assets')
        .upload(path, file, { upsert: true })
      if (upErr) throw upErr
      const { data } = supabase.storage.from('assets').getPublicUrl(path)
      setThumbnailUrl(data.publicUrl)
    } catch (err: any) {
      setError(err.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (files) => files[0] && uploadImage(files[0]),
    accept: { 'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.gif'] },
    maxFiles: 1,
    disabled: uploading || saving,
  })

  async function handleSave() {
    if (!title.trim()) return
    setSaving(true)
    setError(null)
    const res = await updateAsset(asset.id, {
      title: title.trim(),
      thumbnailUrl: thumbnailUrl || null,
    })
    setSaving(false)
    if (res.success) {
      onClose()
    } else {
      setError(res.error || 'Failed to save')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TypeIcon type={asset.type} />
            Edit Asset
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-1">

          {/* Thumbnail drop zone */}
          <div className="space-y-2">
            <Label>Thumbnail</Label>
            <div className="relative">
              <div
                {...getRootProps()}
                className={`relative h-40 w-full rounded-xl border-2 border-dashed overflow-hidden flex items-center justify-center cursor-pointer transition-colors outline-none ${
                  isDragActive
                    ? 'border-primary bg-primary/5'
                    : 'border-muted-foreground/20 hover:border-primary/40 hover:bg-muted/30'
                } ${uploading ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <input {...getInputProps()} />

                {thumbnailUrl ? (
                  <>
                    <img
                      src={thumbnailUrl}
                      alt="thumbnail"
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                    {/* overlay on hover */}
                    <div className={`absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 transition-opacity ${isDragActive ? 'opacity-100' : 'opacity-0 hover:opacity-100'}`}>
                      {uploading ? (
                        <Loader2 className="h-6 w-6 text-white animate-spin" />
                      ) : (
                        <>
                          <UploadCloud className="h-6 w-6 text-white" />
                          <span className="text-white text-xs font-medium">Drop or click to replace</span>
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground select-none">
                    {uploading ? (
                      <Loader2 className="h-6 w-6 animate-spin" />
                    ) : (
                      <>
                        <UploadCloud className={`h-7 w-7 ${isDragActive ? 'text-primary' : ''}`} />
                        <p className="text-sm font-medium">
                          {isDragActive ? 'Drop image here' : 'Drag & drop or click to upload'}
                        </p>
                        <p className="text-xs">JPG, PNG, WebP, GIF</p>
                      </>
                    )}
                  </div>
                )}
              </div>

              {thumbnailUrl && !uploading && (
                <button
                  onClick={(e) => { e.stopPropagation(); setThumbnailUrl('') }}
                  className="absolute top-2 right-2 z-10 w-6 h-6 bg-black/60 text-white rounded-full flex items-center justify-center hover:bg-black/80 transition-colors"
                  title="Remove thumbnail"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="asset-title">Title</Label>
            <Input
              id="asset-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-10"
            />
          </div>

          {/* Source URL (read-only) */}
          {(asset.sourceUrl || asset.fileUrl) && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Source URL</Label>
              <p className="text-xs text-muted-foreground bg-muted px-3 py-2 rounded-lg break-all leading-relaxed">
                {asset.sourceUrl || asset.fileUrl}
              </p>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose} disabled={saving || uploading}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || uploading || !title.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save changes
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
