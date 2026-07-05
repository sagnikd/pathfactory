'use client'

import { useEffect, useRef } from 'react'
import { Bold, Italic, Heading2, List, Type } from 'lucide-react'

interface SystemPromptEditorProps {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  className?: string
}

export function SystemPromptEditor({
  value,
  onChange,
  placeholder = 'You are a smart, consultative assistant...',
  className = '',
}: SystemPromptEditorProps) {
  const ref = useRef<HTMLDivElement>(null)
  const suppressRef = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el || suppressRef.current) return
    if (el.innerHTML !== value) el.innerHTML = value
  }, [value])

  function exec(command: string, arg?: string) {
    document.execCommand(command, false, arg)
    ref.current?.focus()
    emit()
  }

  function emit() {
    const el = ref.current
    if (!el) return
    suppressRef.current = true
    onChange(el.innerHTML)
    requestAnimationFrame(() => { suppressRef.current = false })
  }

  return (
    <div className={`rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring ${className}`}>
      <div className="flex items-center gap-0.5 border-b border-input px-2 py-1.5 bg-muted/30">
        <ToolBtn title="Bold" onClick={() => exec('bold')}><Bold className="h-3.5 w-3.5" /></ToolBtn>
        <ToolBtn title="Italic" onClick={() => exec('italic')}><Italic className="h-3.5 w-3.5" /></ToolBtn>
        <div className="mx-1.5 h-4 w-px bg-border" />
        <ToolBtn title="Section heading" onClick={() => exec('formatBlock', 'h2')}><Heading2 className="h-3.5 w-3.5" /></ToolBtn>
        <ToolBtn title="Bullet list" onClick={() => exec('insertUnorderedList')}><List className="h-3.5 w-3.5" /></ToolBtn>
        <ToolBtn title="Normal paragraph" onClick={() => exec('formatBlock', 'p')}><Type className="h-3.5 w-3.5" /></ToolBtn>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        data-placeholder={placeholder}
        className={`
          min-h-[14rem] px-3 py-2.5 text-sm leading-relaxed focus:outline-none overflow-auto
          empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground empty:before:pointer-events-none
          [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1
          [&_h3]:text-sm [&_h3]:font-medium [&_h3]:mt-2 [&_h3]:mb-0.5
          [&_strong]:font-semibold [&_em]:italic
          [&_ul]:list-disc [&_ul]:ml-5 [&_li]:mb-0.5
          [&_p]:mb-1 [&_p:empty]:h-4
          [&_code]:font-mono [&_code]:text-xs [&_code]:bg-muted [&_code]:px-1 [&_code]:rounded
        `}
      />
    </div>
  )
}

function ToolBtn({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onClick() }}
      className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
    >
      {children}
    </button>
  )
}
