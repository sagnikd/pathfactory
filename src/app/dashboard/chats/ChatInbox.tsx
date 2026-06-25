'use client'

import { useState } from 'react'
import { MessageSquare, Mail, User, Download } from 'lucide-react'
import { cn } from '@/lib/utils'

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
  const [selectedId, setSelectedId] = useState<string | null>(conversations[0]?.id ?? null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)
  const selected = conversations.find((c) => c.id === selectedId) ?? null

  const allChecked = conversations.length > 0 && checked.size === conversations.length

  function toggleAll() {
    setChecked(allChecked ? new Set() : new Set(conversations.map((c) => c.id)))
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
      // Export checked conversations, or all when none are checked
      const target = checked.size > 0 ? conversations.filter((c) => checked.has(c.id)) : conversations
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
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={allChecked}
            onChange={toggleAll}
            className="h-4 w-4 rounded border-input accent-[#30B2BF]"
          />
          {checked.size > 0 ? `${checked.size} selected` : 'Select all'}
        </label>
        <button
          onClick={exportToExcel}
          disabled={exporting}
          className="inline-flex items-center gap-2 rounded-lg bg-[#30B2BF] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2a9faa] disabled:opacity-60"
        >
          <Download className="h-4 w-4" />
          {exporting
            ? 'Exporting…'
            : checked.size > 0
              ? `Export ${checked.size} to Excel`
              : 'Export all to Excel'}
        </button>
      </div>

      <div className="flex h-[calc(100vh-260px)] min-h-[480px] overflow-hidden rounded-lg border">
        {/* Conversation list */}
        <div className="w-80 shrink-0 overflow-y-auto border-r bg-muted/20">
          {conversations.map((conv) => {
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
                    <span className="shrink-0 text-xs text-muted-foreground">
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
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {selected.trackTitle} · {selected.messageCount} messages · started{' '}
                  {new Date(selected.messages[0]?.createdAt ?? selected.lastMessageAt).toLocaleString()}
                </p>
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto bg-muted/10 px-5 py-4">
                {selected.messages.map((m, i) => (
                  <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                    <div
                      className={cn(
                        'max-w-[75%] rounded-2xl px-3.5 py-2 text-sm',
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
