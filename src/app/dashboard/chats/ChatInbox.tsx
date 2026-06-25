'use client'

import { useMemo, useState } from 'react'
import { MessageSquare, Mail, User, Download, CalendarIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

const PRESETS = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'All time', days: 0 },
]

function toDateInput(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export type InboxMessage = {
  role: string
  content: string
  createdAt: string
}

export type InboxConversation = {
  id: string
  trackTitle: string
  contact: string | null
  messageCount: number
  lastMessageAt: string
  messages: InboxMessage[]
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  const diff = Date.now() - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

function firstUserMessage(conv: InboxConversation): string {
  const first = conv.messages.find((m) => m.role === 'user')
  return first?.content ?? '(no messages)'
}

// Pair consecutive user→assistant turns into Q&A rows for export
function toQaRows(conv: InboxConversation): Record<string, string>[] {
  const rows: Record<string, string>[] = []
  const msgs = conv.messages
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].role !== 'user') continue
    const answer = msgs[i + 1]?.role === 'assistant' ? msgs[i + 1].content : ''
    rows.push({
      Contact: conv.contact ?? 'Anonymous visitor',
      Track: conv.trackTitle,
      Question: msgs[i].content,
      Answer: answer,
      'Asked At': new Date(msgs[i].createdAt).toLocaleString(),
    })
  }
  // Conversation with no user turns — still emit one row so it's not lost
  if (rows.length === 0) {
    rows.push({
      Contact: conv.contact ?? 'Anonymous visitor',
      Track: conv.trackTitle,
      Question: '(no questions)',
      Answer: '',
      'Asked At': new Date(conv.lastMessageAt).toLocaleString(),
    })
  }
  return rows
}

export function ChatInbox({ conversations }: { conversations: InboxConversation[] }) {
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [today] = useState(() => new Date())

  // Filter by lastMessageAt within [from, to] (inclusive)
  const filtered = useMemo(() => {
    const fromMs = from ? new Date(from + 'T00:00:00').getTime() : null
    const toMs = to ? new Date(to + 'T23:59:59').getTime() : null
    return conversations.filter((c) => {
      const t = new Date(c.lastMessageAt).getTime()
      if (fromMs !== null && t < fromMs) return false
      if (toMs !== null && t > toMs) return false
      return true
    })
  }, [conversations, from, to])

  const [selectedId, setSelectedId] = useState<string | null>(conversations[0]?.id ?? null)
  const selected = filtered.find((c) => c.id === selectedId) ?? filtered[0] ?? null

  const activePreset = (() => {
    if (!from && !to) return 0
    const f = from ? new Date(from + 'T00:00:00').getTime() : null
    if (f === null) return -1
    const diff = Math.round((today.getTime() - f) / 86_400_000)
    const p = PRESETS.find((p) => p.days !== 0 && Math.abs(diff - p.days) <= 1)
    return p ? p.days : -1
  })()

  function applyPreset(days: number) {
    if (days === 0) {
      setFrom(''); setTo('')
    } else {
      const start = new Date(today)
      start.setDate(today.getDate() - days)
      setFrom(toDateInput(start)); setTo(toDateInput(today))
    }
    setChecked(new Set())
  }

  const allChecked = filtered.length > 0 && filtered.every((c) => checked.has(c.id))

  function toggleAll() {
    setChecked(allChecked ? new Set() : new Set(filtered.map((c) => c.id)))
  }

  function toggleOne(id: string) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function exportToExcel() {
    setExporting(true)
    try {
      // Export checked conversations, or all currently-filtered when none checked
      const target = checked.size > 0 ? filtered.filter((c) => checked.has(c.id)) : filtered
      const rows = target.flatMap(toQaRows)

      const XLSX = await import('xlsx')
      const worksheet = XLSX.utils.json_to_sheet(rows)
      worksheet['!cols'] = [
        { wch: 28 }, // Contact
        { wch: 28 }, // Track
        { wch: 60 }, // Question
        { wch: 80 }, // Answer
        { wch: 22 }, // Asked At
      ]
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Chat Q&A')
      const stamp = new Date().toISOString().slice(0, 10)
      XLSX.writeFile(workbook, `chat-transcripts-${stamp}.xlsx`)
    } finally {
      setExporting(false)
    }
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-20 text-center">
        <MessageSquare className="h-10 w-10 text-muted-foreground/40 mb-3" />
        <p className="text-muted-foreground">No conversations yet.</p>
        <p className="text-sm text-muted-foreground/70 mt-1">
          When visitors chat with the assistant on your tracks, transcripts land here.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Date-range filter */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border bg-muted/40 p-1">
          {PRESETS.map((p) => (
            <button
              key={p.days}
              onClick={() => applyPreset(p.days)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                activePreset === p.days
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-sm">
          <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="date"
            value={from}
            max={to || toDateInput(today)}
            onChange={(e) => { setFrom(e.target.value); setChecked(new Set()) }}
            className="h-8 rounded-md border bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#30B2BF]/30"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <input
            type="date"
            value={to}
            min={from}
            max={toDateInput(today)}
            onChange={(e) => { setTo(e.target.value); setChecked(new Set()) }}
            className="h-8 rounded-md border bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#30B2BF]/30"
          />
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={allChecked}
            onChange={toggleAll}
            className="h-4 w-4 rounded border-input accent-[#30B2BF]"
          />
          {checked.size > 0 ? `${checked.size} selected` : `Select all (${filtered.length})`}
        </label>
        <button
          onClick={exportToExcel}
          disabled={exporting || filtered.length === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-[#30B2BF] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2a9faa] disabled:opacity-60"
        >
          <Download className="h-4 w-4" />
          {exporting
            ? 'Exporting…'
            : checked.size > 0
              ? `Export ${checked.size} to Excel`
              : `Export ${filtered.length} to Excel`}
        </button>
      </div>

      <div className="flex h-[calc(100vh-260px)] min-h-[480px] overflow-hidden rounded-lg border">
        {/* Conversation list */}
        <div className="w-80 shrink-0 overflow-y-auto border-r bg-muted/20">
          {filtered.length === 0 && (
            <p className="p-4 text-center text-sm text-muted-foreground">No chats in this date range.</p>
          )}
          {filtered.map((conv) => {
            const active = conv.id === selectedId
            const isChecked = checked.has(conv.id)
            return (
              <div
                key={conv.id}
                className={cn(
                  'flex items-start gap-2 border-b px-3 py-3 transition-colors',
                  active ? 'bg-background' : 'hover:bg-muted/50'
                )}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleOne(conv.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-[#30B2BF]"
                  aria-label="Select conversation"
                />
                <button onClick={() => setSelectedId(conv.id)} className="min-w-0 flex-1 text-left">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                      {conv.contact ? (
                        <Mail className="h-3.5 w-3.5 shrink-0 text-[#30B2BF]" />
                      ) : (
                        <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate">{conv.contact ?? 'Anonymous visitor'}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground" suppressHydrationWarning>
                      {formatRelative(conv.lastMessageAt)}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{conv.trackTitle}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground/80">{firstUserMessage(conv)}</p>
                </button>
              </div>
            )
          })}
        </div>

        {/* Transcript */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {selected ? (
            <>
              <div className="border-b px-5 py-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {selected.contact ? (
                    <>
                      <Mail className="h-4 w-4 text-[#30B2BF]" />
                      {selected.contact}
                    </>
                  ) : (
                    <>
                      <User className="h-4 w-4 text-muted-foreground" />
                      Anonymous visitor
                    </>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground" suppressHydrationWarning>
                  {selected.trackTitle} · {selected.messageCount} messages · started{' '}
                  {new Date(selected.messages[0]?.createdAt ?? selected.lastMessageAt).toLocaleString()}
                </p>
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto bg-muted/10 px-5 py-4">
                {selected.messages.map((m, i) => (
                  <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                    <div
                      className={cn(
                        'max-w-[75%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
                        m.role === 'user'
                          ? 'bg-[#30B2BF] text-white'
                          : 'border bg-background text-foreground'
                      )}
                    >
                      {m.content}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              Select a conversation
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
