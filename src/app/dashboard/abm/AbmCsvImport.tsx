'use client'

import { useRef, useState, useTransition, useCallback } from 'react'
import { UploadCloud, FileText, X, CheckCircle2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { importAbmCsv } from './actions'

type Status = 'idle' | 'ready' | 'importing' | 'success' | 'error'

export default function AbmCsvImport() {
  const [csvText,   setCsvText]   = useState<string>('')
  const [fileName,  setFileName]  = useState<string>('')
  const [rowCount,  setRowCount]  = useState<number>(0)
  const [dragOver,  setDragOver]  = useState(false)
  const [status,    setStatus]    = useState<Status>('idle')
  const [errorMsg,  setErrorMsg]  = useState<string>('')
  const [, startTransition]       = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  const loadFile = useCallback((file: File) => {
    if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
      setErrorMsg('Please upload a .csv file.')
      setStatus('error')
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = (e.target?.result as string) ?? ''
      const rows = text.split(/\r?\n/).filter(l => l.trim()).length
      setCsvText(text)
      setFileName(file.name)
      setRowCount(rows)
      setStatus('ready')
      setErrorMsg('')
    }
    reader.onerror = () => {
      setErrorMsg('Could not read file.')
      setStatus('error')
    }
    reader.readAsText(file)
  }, [])

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) loadFile(file)
  }, [loadFile])

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) loadFile(file)
    e.target.value = ''           // allow re-selecting the same file
  }

  const handleImport = () => {
    if (!csvText) return
    setStatus('importing')
    const fd = new FormData()
    fd.set('csv', csvText)
    startTransition(async () => {
      try {
        await importAbmCsv(fd)
        setStatus('success')
        setCsvText('')
        setFileName('')
        setRowCount(0)
      } catch {
        setErrorMsg('Import failed. Please try again.')
        setStatus('error')
      }
    })
  }

  const reset = () => {
    setCsvText('')
    setFileName('')
    setRowCount(0)
    setStatus('idle')
    setErrorMsg('')
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Expected columns (order doesn't matter, header row optional):{' '}
        <code className="bg-muted px-1 py-0.5 rounded text-[11px]">account_name, domain, priority, owner_email, notes</code>
      </p>

      {/* Drop zone */}
      {status !== 'ready' && status !== 'importing' && status !== 'success' && (
        <div
          role="button"
          tabIndex={0}
          className={[
            'flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 transition-colors cursor-pointer select-none',
            dragOver
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/50 hover:bg-muted/40',
          ].join(' ')}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
        >
          <UploadCloud className={`w-9 h-9 ${dragOver ? 'text-primary' : 'text-muted-foreground/50'}`} />
          <div className="text-center">
            <p className="text-sm font-medium">
              {dragOver ? 'Release to upload' : 'Drop your CSV here'}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">or click to browse</p>
          </div>
          {status === 'error' && (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {errorMsg}
            </p>
          )}
        </div>
      )}

      {/* File ready preview */}
      {(status === 'ready' || status === 'importing') && (
        <div className="rounded-xl border bg-muted/30 px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <FileText className="w-8 h-8 text-primary shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{fileName}</p>
              <p className="text-xs text-muted-foreground">
                {rowCount} row{rowCount !== 1 ? 's' : ''} detected
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              onClick={handleImport}
              disabled={status === 'importing'}
            >
              {status === 'importing' ? 'Importing…' : 'Import'}
            </Button>
            <button
              type="button"
              onClick={reset}
              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Remove file"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Success */}
      {status === 'success' && (
        <div className="rounded-xl border border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30 px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span className="text-sm font-medium">Import complete!</span>
          </div>
          <Button size="sm" variant="outline" onClick={reset}>Import another</Button>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={onFileChange}
      />
    </div>
  )
}
