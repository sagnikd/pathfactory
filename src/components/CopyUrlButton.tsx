'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

export function CopyUrlButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    const url = `${window.location.origin}${path}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard permission denied or unavailable — no-op, button just won't confirm.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Copy track URL"
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}
