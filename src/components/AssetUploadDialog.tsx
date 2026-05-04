'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { addUrlAsset, addFileAsset } from '@/app/dashboard/assets/actions'
import { createClient } from '@/lib/supabase/client'
import { useDropzone } from 'react-dropzone'
import { Loader2, Plus, UploadCloud } from 'lucide-react'

/** Convert a filename into a readable title.
 *  "100-pipeline-plays.pdf" → "100 Pipeline Plays"
 *  "modern_marketing_guide_v2.pdf" → "Modern Marketing Guide V2"
 */
function filenameToTitle(filename: string): string {
  return filename
    .replace(/\.[^/.]+$/, '')   // strip extension
    .replace(/[_\-]+/g, ' ')    // hyphens/underscores → spaces
    .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase → spaces
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase()) // Title Case
}

/** Lazy-loads pdfjs-dist on the client only, renders page 1 to JPEG.
 *  Returns { blob, title } where title comes from PDF metadata if available.
 */
async function processPdf(file: File): Promise<{ blob: Blob | null; title: string }> {
  const fallbackTitle = filenameToTitle(file.name)
  try {
    // Dynamic import — never runs on the server, avoids DOMMatrix crash
    const pdfjsLib = await import('pdfjs-dist')
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

    const arrayBuffer = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise

    // Extract title from PDF metadata
    let title = fallbackTitle
    try {
      const meta = await pdf.getMetadata()
      const pdfTitle = (meta.info as Record<string, string>)?.Title?.trim()
      if (pdfTitle && pdfTitle.length > 2) title = pdfTitle
    } catch {}

    // Render first page to canvas
    const page = await pdf.getPage(1)
    const viewport = page.getViewport({ scale: 1.5 })

    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')!

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (page.render as any)({ canvasContext: ctx, viewport }).promise

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85)
    )

    return { blob, title }
  } catch (err) {
    console.error('PDF processing failed:', err)
    return { blob: null, title: fallbackTitle }
  }
}

type AddedAsset = {
  id: string
  title: string
  type: 'pdf' | 'video' | 'article' | 'image'
  thumbnailUrl: string | null
  sourceUrl: string | null
}

export function AssetUploadDialog({
  organizationId,
  onAssetsAdded,
}: {
  organizationId: string
  onAssetsAdded?: (assets: AddedAsset[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [url, setUrl] = useState('')
  const [bulkUrls, setBulkUrls] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [bulkResult, setBulkResult] = useState<{ count: number; errors: number } | null>(null)

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setBulkResult(null)
    const res = await addUrlAsset(organizationId, url)
    if (res.success && res.asset) {
      onAssetsAdded?.([res.asset])
      setOpen(false)
      setUrl('')
    } else {
      setError(res.error || 'Failed to add asset')
    }
    setLoading(false)
  }

  const handleBulkImport = async () => {
    if (!bulkUrls.trim()) return
    setLoading(true)
    setError(null)
    setBulkResult(null)

    const urls = bulkUrls
      .split(/[\n,]+/)
      .map((u) => u.trim())
      .filter((u) => u.startsWith('http'))

    if (urls.length === 0) {
      setLoading(false)
      setError('Add at least one valid URL starting with http/https.')
      return
    }

    const added: AddedAsset[] = []
    let failures = 0

    for (const u of urls) {
      const res = await addUrlAsset(organizationId, u)
      if (res.success && res.asset) {
        added.push(res.asset)
      } else {
        failures += 1
      }
    }

    if (added.length > 0) {
      onAssetsAdded?.(added)
    }

    setBulkResult({ count: added.length, errors: failures })
    if (added.length > 0) {
      setBulkUrls('')
      if (failures === 0) {
        setOpen(false)
      }
    }
    setLoading(false)
  }

  const onDrop = async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return
    setLoading(true)
    setError(null)
    setProgress(null)

    try {
      const supabase = createClient()
      const added: AddedAsset[] = []

      for (let idx = 0; idx < acceptedFiles.length; idx += 1) {
        const file = acceptedFiles[idx]
        const fileExt = file.name.split('.').pop()
        const filePath = `${organizationId}/${crypto.randomUUID()}.${fileExt}`

        setProgress(`Uploading file ${idx + 1} of ${acceptedFiles.length}…`)
        const { error: uploadError } = await supabase.storage.from('assets').upload(filePath, file)
        if (uploadError) throw uploadError
        const { data: fileData } = supabase.storage.from('assets').getPublicUrl(filePath)

        let thumbnailUrl: string | undefined
        let title = filenameToTitle(file.name)
        const type = file.type.includes('pdf') ? 'pdf' : file.type.includes('video') ? 'video' : 'image'

        if (type === 'pdf') {
          setProgress(`Reading PDF ${idx + 1} of ${acceptedFiles.length} & generating thumbnail…`)
          const { blob, title: pdfTitle } = await processPdf(file)
          title = pdfTitle

          if (blob) {
            setProgress(`Uploading thumbnail ${idx + 1} of ${acceptedFiles.length}…`)
            const thumbPath = `${organizationId}/thumbs/${crypto.randomUUID()}.jpg`
            const { error: thumbErr } = await supabase.storage
              .from('assets')
              .upload(thumbPath, blob, { contentType: 'image/jpeg' })

            if (!thumbErr) {
              const { data: thumbData } = supabase.storage.from('assets').getPublicUrl(thumbPath)
              thumbnailUrl = thumbData.publicUrl
            }
          }
        }

        setProgress(`Saving ${idx + 1} of ${acceptedFiles.length}…`)
        const res = await addFileAsset(organizationId, { fileUrl: fileData.publicUrl, title, type, thumbnailUrl })
        if (res.success && res.asset) {
          added.push(res.asset)
        } else {
          throw new Error(res.error || `Failed to save asset ${file.name}`)
        }
      }

      if (added.length > 0) {
        onAssetsAdded?.(added)
        setOpen(false)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Upload failed. Check your Supabase "assets" bucket has public access.'
      setError(message)
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 50,
    disabled: loading,
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus className="mr-2 h-4 w-4" />
        Add Asset
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add Asset</DialogTitle>
          <DialogDescription>
            Upload a PDF or paste a URL to an article or video.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 py-4">
          <div
            {...getRootProps()}
            className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors outline-none ${
              isDragActive
                ? 'border-primary bg-primary/5'
                : 'border-muted-foreground/20 hover:border-primary/40 hover:bg-muted/30'
            } ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <input {...getInputProps()} />
            <UploadCloud className={`mb-3 h-8 w-8 ${isDragActive ? 'text-primary' : 'text-muted-foreground'}`} />
            {loading && progress ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {progress}
              </div>
            ) : (
              <>
                <p className="text-sm font-medium">
                  {isDragActive ? 'Drop PDFs here' : 'Drag & drop PDFs, or click to browse'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Title and thumbnail auto-extracted from each PDF
                </p>
              </>
            )}
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">Or paste a link</span>
            </div>
          </div>

          <form onSubmit={handleUrlSubmit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="url">URL (Article, YouTube, Vimeo)</Label>
              <Input
                id="url"
                type="url"
                placeholder="https://…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
                disabled={loading}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Link
            </Button>
          </form>

          <div className="space-y-3 rounded-lg border p-3">
            <div>
              <Label htmlFor="bulk-urls">Bulk import URLs</Label>
              <p className="text-xs text-muted-foreground mt-1">Paste one URL per line (or comma-separated)</p>
            </div>
            <Textarea
              id="bulk-urls"
              rows={4}
              value={bulkUrls}
              onChange={(e) => setBulkUrls(e.target.value)}
              placeholder={`https://blog.example.com/post-1\nhttps://youtube.com/watch?v=...`}
              className="resize-none font-mono text-xs"
              disabled={loading}
            />
            {bulkResult && (
              <p className="text-xs">
                <span className="text-primary font-medium">✓ {bulkResult.count} imported</span>
                {bulkResult.errors > 0 && <span className="text-destructive ml-2">{bulkResult.errors} failed</span>}
              </p>
            )}
            <Button type="button" onClick={handleBulkImport} disabled={loading || !bulkUrls.trim()} className="w-full">
              {loading ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Importing…</>
              ) : (
                <>Import URLs</>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
