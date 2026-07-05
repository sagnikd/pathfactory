'use client'

import { useEffect, useRef } from 'react'

/**
 * Minimal rich-text input that preserves only <a> links.
 * Paste from Word, Google Docs, or any webpage — links survive, all other
 * formatting (bold, colour, font, spans) is stripped to plain text.
 */
export function RichLinkInput({
  value,
  onChange,
  placeholder,
  rows = 2,
  className = '',
}: {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  rows?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const suppressRef = useRef(false)

  // Sync external value → DOM (only when value changed externally, not from user input)
  useEffect(() => {
    const el = ref.current
    if (!el || suppressRef.current) return
    if (el.innerHTML !== value) el.innerHTML = value
  }, [value])

  function sanitize(html: string): string {
    const tmp = document.createElement('div')
    tmp.innerHTML = html
    // Walk all nodes: keep text, keep <a> (strip its non-href attrs), remove everything else
    function walk(node: Node): string {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
      if (node.nodeType !== Node.ELEMENT_NODE) return ''
      const el = node as Element
      const tag = el.tagName.toLowerCase()
      const children = Array.from(el.childNodes).map(walk).join('')
      if (tag === 'a') {
        const href = el.getAttribute('href') ?? ''
        const target = el.getAttribute('target') ?? '_blank'
        return href ? `<a href="${href}" target="${target}" rel="noopener noreferrer">${children}</a>` : children
      }
      // Block elements add a space/newline so words don't run together
      if (['p', 'div', 'br', 'li'].includes(tag)) return children + ' '
      return children
    }
    return Array.from(tmp.childNodes).map(walk).join('').trim()
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault()
    const html = e.clipboardData.getData('text/html')
    const text = e.clipboardData.getData('text/plain')
    const clean = html ? sanitize(html) : (text ?? '')
    // Insert at cursor
    const sel = window.getSelection()
    if (sel && sel.rangeCount) {
      sel.deleteFromDocument()
      const range = sel.getRangeAt(0)
      const frag = range.createContextualFragment(clean)
      range.insertNode(frag)
      sel.collapseToEnd()
    }
    emit()
  }

  function emit() {
    const el = ref.current
    if (!el) return
    suppressRef.current = true
    const clean = sanitize(el.innerHTML)
    onChange(clean)
    requestAnimationFrame(() => { suppressRef.current = false })
  }

  const minHeight = `${rows * 1.5}rem`

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onInput={emit}
      onPaste={handlePaste}
      data-placeholder={placeholder}
      style={{ minHeight }}
      className={`w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 border-input overflow-auto
        empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground empty:before:pointer-events-none
        [&_a]:text-primary [&_a]:underline
        ${className}`}
    />
  )
}
