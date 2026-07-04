'use client'

import { useEffect, useRef, useState } from 'react'
import { CalendarDays, Maximize2, MessageCircle, Minimize2, Send, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { trackEvent } from '@/lib/tracking'

interface TrackChatWidgetProps {
  trackId: string
  currentAssetId?: string
  chatConfig: {
    enabled: boolean
    accentColor: string
    assistantName: string
    meetingUrl?: string
    meetingCtaLabel?: string
    meetingCtaThreshold?: number
    suggestedQuestions?: string[]
  }
  sessionId?: string | null
  visitorName?: string | null
  summarizeToken?: number
  ctaChatToken?: number
  ctaChatMessage?: string
  proactiveToken?: number
  proactiveAssetTitle?: string
  downloadChatToken?: number
}

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

type ChatApiResponse = {
  answer?: string
  suggestedQuestions?: string[]
  showMeetingCta?: boolean
  meetingCta?: { url: string; label: string } | null
  error?: string
}

function isValidHttpsUrl(value: string | undefined): value is string {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
  } catch {
    return false
  }
}

const URL_SPLIT_RE = /(https?:\/\/[^\s)]+)/g
const URL_FULL_RE = /^https?:\/\/[^\s)]+$/

// Render message text with bare URLs turned into clickable links, everything
// else left as plain text — chat replies aren't markdown, just plain strings
// that happen to contain asset links. `split` with a capturing group returns
// the matched URLs interleaved at odd indices alongside the surrounding text.
function linkifyText(text: string, linkClassName: string): React.ReactNode[] {
  return text.split(URL_SPLIT_RE).map((part, i) => {
    if (!URL_FULL_RE.test(part)) return part
    // Trailing punctuation (e.g. a period ending the sentence) shouldn't be part of the link
    const trailingMatch = part.match(/[).,;:!?]+$/)
    const trailing = trailingMatch ? trailingMatch[0] : ''
    const href = trailing ? part.slice(0, -trailing.length) : part
    return (
      <span key={i}>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClassName}
          onClick={(e) => e.stopPropagation()}
        >
          {href}
        </a>
        {trailing}
      </span>
    )
  })
}

function TypingIndicator({ accentColor }: { accentColor: string }) {
  return (
    <div className="flex items-start gap-2">
      <span
        className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white"
        style={{ backgroundColor: accentColor }}
      >
        AI
      </span>
      <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-sm">
        <span
          className="size-1.5 rounded-full"
          style={{
            backgroundColor: accentColor,
            animation: 'trackChatBounce 1.2s ease-in-out infinite',
            animationDelay: '0ms',
          }}
        />
        <span
          className="size-1.5 rounded-full"
          style={{
            backgroundColor: accentColor,
            animation: 'trackChatBounce 1.2s ease-in-out infinite',
            animationDelay: '200ms',
          }}
        />
        <span
          className="size-1.5 rounded-full"
          style={{
            backgroundColor: accentColor,
            animation: 'trackChatBounce 1.2s ease-in-out infinite',
            animationDelay: '400ms',
          }}
        />
      </div>
    </div>
  )
}

export function TrackChatWidget({
  trackId,
  currentAssetId,
  chatConfig,
  sessionId,
  visitorName,
  summarizeToken,
  ctaChatToken,
  ctaChatMessage,
  proactiveToken,
  proactiveAssetTitle,
  downloadChatToken,
}: TrackChatWidgetProps) {
  const firstName = visitorName?.trim().split(/\s+/)[0] || null
  const greeting: ChatMessage | null = firstName
    ? {
        role: 'assistant',
        content: `Hi ${firstName} 👋 I'm ${chatConfig.assistantName}. Ask me anything about this track.`,
      }
    : null

  const [isOpen, setIsOpen] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>(greeting ? [greeting] : [])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [askedQuestions, setAskedQuestions] = useState<string[]>([])
  const [askedCount, setAskedCount] = useState(0)
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>(
    chatConfig.suggestedQuestions ?? []
  )
  const [showMeetingCta, setShowMeetingCta] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevAssetIdRef = useRef(currentAssetId)
  const prevSummarizeTokenRef = useRef(summarizeToken)
  const prevCtaChatTokenRef = useRef(ctaChatToken)
  const prevProactiveTokenRef = useRef(proactiveToken)
  const prevDownloadChatTokenRef = useRef(downloadChatToken)

  const {
    accentColor,
    assistantName,
    meetingUrl,
    meetingCtaLabel = 'Book a meeting',
    meetingCtaThreshold = 3,
  } = chatConfig

  const validMeetingUrl = isValidHttpsUrl(meetingUrl) ? meetingUrl : undefined
  const shouldShowMeetingCta = showMeetingCta || askedCount >= meetingCtaThreshold

  useEffect(() => {
    if (!isOpen) return
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, isLoading, isOpen])

  // Reset conversation context when the visitor navigates to a different asset
  useEffect(() => {
    if (prevAssetIdRef.current === currentAssetId) return
    prevAssetIdRef.current = currentAssetId
    setMessages(greeting ? [greeting] : [])
    setAskedQuestions([])
    setAskedCount(0)
    setInputValue('')
    setIsLoading(false)
    setSuggestedQuestions(chatConfig.suggestedQuestions ?? [])
    setShowMeetingCta(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAssetId])

  // Known visitor → proactively open the panel once to engage them
  useEffect(() => {
    if (!firstName) return
    const dismissed = typeof window !== 'undefined' && sessionStorage.getItem('trackChatAutoOpened') === '1'
    if (dismissed) return
    const t = setTimeout(() => {
      setIsOpen(true)
      try { sessionStorage.setItem('trackChatAutoOpened', '1') } catch {}
    }, 1800)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Visitor clicked "Summarize" on the current asset — pop the panel open and
  // ask the assistant for a summary, as if they'd typed the question themselves.
  useEffect(() => {
    if (summarizeToken === undefined || prevSummarizeTokenRef.current === summarizeToken) return
    prevSummarizeTokenRef.current = summarizeToken
    setIsOpen(true)
    sendQuestion('Summarize this asset for me.')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summarizeToken])

  // Visitor clicked the sidebar CTA (configured to open chat) — pop the panel
  // open and post the canned opening line directly, without a round-trip to
  // the AI. Also surfaces the meeting-booking button right away.
  useEffect(() => {
    if (ctaChatToken === undefined || prevCtaChatTokenRef.current === ctaChatToken) return
    prevCtaChatTokenRef.current = ctaChatToken
    setIsOpen(true)
    setMessages((prev) => [
      ...prev,
      { role: 'assistant', content: ctaChatMessage?.trim() || 'Sure, let me set up a meeting with our sales team.' },
    ])
    setShowMeetingCta(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctaChatToken])

  // Visitor crossed an engagement threshold (3+ assets viewed, 90+s dwell on
  // one asset, or 50%+ scroll on a document) — pop the panel open and let the
  // assistant hook them with something contextual, per its instructions.
  useEffect(() => {
    if (proactiveToken === undefined || prevProactiveTokenRef.current === proactiveToken) return
    prevProactiveTokenRef.current = proactiveToken
    setIsOpen(true)
    sendKickoff()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proactiveToken])

  // Anonymous visitor tried to download a gated asset with no gate form
  // configured — ask for their email conversationally instead of handing
  // over the file or silently doing nothing.
  useEffect(() => {
    if (downloadChatToken === undefined || prevDownloadChatTokenRef.current === downloadChatToken) return
    prevDownloadChatTokenRef.current = downloadChatToken
    setIsOpen(true)
    setMessages((prev) => [
      ...prev,
      { role: 'assistant', content: "I'd love to send that over — what's your email address?" },
    ])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloadChatToken])

  if (!chatConfig.enabled) return null

  // The greeting is a canned UI message, not something the model produced —
  // exclude it from the history sent back, so the model isn't confused by a
  // "turn" it never actually generated.
  const conversationHistory = (msgs: ChatMessage[]) =>
    msgs.filter((m) => m !== greeting).map((m) => ({ role: m.role, content: m.content }))

  async function sendQuestion(question?: string) {
    const text = (question ?? inputValue).trim()
    if (!text || isLoading) return

    const priorHistory = conversationHistory(messages)
    const userMessage: ChatMessage = { role: 'user', content: text }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setInputValue('')
    setIsLoading(true)

    const nextAskedQuestions = [...askedQuestions, text]
    setAskedQuestions(nextAskedQuestions)

    try {
      const response = await fetch('/api/track-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackId,
          sessionId: sessionId ?? null,
          currentAssetId: currentAssetId ?? null,
          message: text,
          history: priorHistory,
          askedQuestions: nextAskedQuestions,
        }),
      })
      const data = await response.json().catch(() => ({})) as ChatApiResponse
      if (!response.ok) throw new Error(data.error ?? 'Chat request failed')

      const answer = data.answer?.trim() || 'I can help, but I need a more specific question.'
      setMessages((prev) => [...prev, { role: 'assistant', content: answer }])

      if (data.suggestedQuestions?.length) {
        setSuggestedQuestions(
          data.suggestedQuestions
            .map((q) => q.trim())
            .filter(Boolean)
            .slice(0, 5)
        )
      }

      setAskedCount((n) => n + 1)
      if (data.showMeetingCta) setShowMeetingCta(true)

      if (sessionId && currentAssetId) {
        trackEvent({
          sessionId,
          assetId: currentAssetId,
          eventType: 'click',
          payloadJson: { kind: 'chat_message', question: text },
        })
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content:
            'I could not reach the assistant right now. Try one of the suggested questions or keep browsing the track.',
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  // Proactive outreach — the assistant opens the conversation itself once the
  // visitor's engagement crosses a threshold. No visible user message for this
  // turn; only the assistant's contextual hook gets appended.
  async function sendKickoff() {
    if (isLoading) return
    setIsLoading(true)
    try {
      const response = await fetch('/api/track-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackId,
          sessionId: sessionId ?? null,
          currentAssetId: currentAssetId ?? null,
          kickoff: true,
          kickoffAssetTitle: proactiveAssetTitle ?? '',
          history: conversationHistory(messages),
          askedQuestions,
        }),
      })
      const data = await response.json().catch(() => ({})) as ChatApiResponse
      if (!response.ok) throw new Error(data.error ?? 'Chat request failed')

      const answer = data.answer?.trim()
      if (answer) setMessages((prev) => [...prev, { role: 'assistant', content: answer }])
      if (data.suggestedQuestions?.length) {
        setSuggestedQuestions(data.suggestedQuestions.map((q) => q.trim()).filter(Boolean).slice(0, 5))
      }
      if (data.showMeetingCta) setShowMeetingCta(true)
    } catch {
      // Best-effort — if the proactive hook fails, just stay silent rather than
      // show an error for a conversation the visitor never asked to start.
    } finally {
      setIsLoading(false)
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendQuestion()
    }
  }

  function handleMeetingClick(source: 'header_button' | 'inline_card' | 'suggestion_chip') {
    if (!sessionId || !currentAssetId) return
    trackEvent({
      sessionId,
      assetId: currentAssetId,
      eventType: 'click',
      payloadJson: { kind: 'meeting_cta', source },
    })
  }

  const visibleSuggestions = suggestedQuestions.filter(Boolean).slice(0, 5)

  return (
    <>
      <style>{`
        @keyframes trackChatBounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-5px); opacity: 1; }
        }
      `}</style>

      <div className="fixed bottom-20 right-4 z-50 flex flex-col items-end">
        {isOpen && (
          <div
            className="mb-3 flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl transition-all duration-200"
            style={
              isExpanded
                ? { width: 'min(90vw, 560px)', height: 'min(80vh, 720px)', maxHeight: '80vh' }
                : { width: 'min(90vw, 350px)', maxHeight: 480 }
            }
          >
            {/* Header */}
            <div
              className="flex min-h-14 shrink-0 items-center justify-between gap-3 px-4 py-3 text-white"
              style={{ backgroundColor: accentColor }}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/20 text-xs font-bold">
                  AI
                </span>
                <span className="truncate text-sm font-semibold">{assistantName}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {validMeetingUrl && (
                  <a
                    href={validMeetingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => handleMeetingClick('header_button')}
                    className="flex h-7 items-center gap-1.5 rounded-lg bg-white/15 px-2.5 text-xs font-medium text-white transition-colors hover:bg-white/25"
                    title={meetingCtaLabel}
                  >
                    <CalendarDays className="size-3.5" />
                    <span className="hidden sm:inline">{meetingCtaLabel}</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setIsExpanded((v) => !v)}
                  className="hidden size-7 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/15 hover:text-white sm:flex"
                  aria-label={isExpanded ? 'Collapse chat' : 'Expand chat'}
                  title={isExpanded ? 'Collapse' : 'Expand'}
                >
                  {isExpanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="flex size-7 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/15 hover:text-white"
                  aria-label="Close chat"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            {/* Message list */}
            <div
              ref={scrollRef}
              className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-3"
              style={{ minHeight: 0 }}
            >
              {messages.length === 0 && (
                <p className="text-center text-xs text-slate-400">
                  Ask a question about this track.
                </p>
              )}
              {messages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={`flex items-start gap-2 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {message.role === 'assistant' && (
                    <span
                      className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white"
                      style={{ backgroundColor: accentColor }}
                    >
                      AI
                    </span>
                  )}
                  <div
                    className={`max-w-[82%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm leading-relaxed ${
                      message.role === 'user'
                        ? 'text-white shadow-sm'
                        : 'border border-slate-200 bg-white text-slate-900 shadow-sm'
                    }`}
                    style={
                      message.role === 'user'
                        ? { backgroundColor: accentColor }
                        : undefined
                    }
                  >
                    {linkifyText(
                      message.content,
                      message.role === 'user'
                        ? 'underline decoration-white/60 hover:decoration-white'
                        : 'underline text-slate-900 decoration-slate-400 hover:decoration-slate-900 break-all'
                    )}
                  </div>
                </div>
              ))}

              {/* Inline meeting CTA card */}
              {shouldShowMeetingCta && validMeetingUrl && (
                <div className="flex items-start gap-2">
                  <span
                    className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white"
                    style={{ backgroundColor: accentColor }}
                  >
                    AI
                  </span>
                  <div className="max-w-[82%] rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm">
                    <div className="flex items-center gap-2 font-semibold text-slate-900">
                      <CalendarDays className="size-4" style={{ color: accentColor }} />
                      {meetingCtaLabel}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">
                      Get a tailored walkthrough mapped to this track and your use case.
                    </p>
                    <a
                      href={validMeetingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => handleMeetingClick('inline_card')}
                      className="mt-2.5 inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
                      style={{ backgroundColor: accentColor }}
                    >
                      Pick a time
                    </a>
                  </div>
                </div>
              )}

              {isLoading && <TypingIndicator accentColor={accentColor} />}
            </div>

            {/* Composer */}
            <div className="shrink-0 border-t border-slate-200 bg-white p-3">
              {visibleSuggestions.length > 0 && (
                <div className="mb-2.5 flex flex-wrap gap-1.5">
                  {visibleSuggestions.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => {
                        if (!isLoading) sendQuestion(q)
                      }}
                      disabled={isLoading}
                      className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-left text-xs font-medium text-slate-700 shadow-sm transition-colors disabled:opacity-50"
                      style={{}}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = accentColor + '80'
                        e.currentTarget.style.backgroundColor = accentColor + '18'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = ''
                        e.currentTarget.style.backgroundColor = ''
                      }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}

              <div
                className="flex items-end gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-sm transition-shadow focus-within:shadow-md"
                style={{}}
              >
                <Textarea
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  maxLength={600}
                  placeholder="Ask about this track..."
                  className="max-h-20 min-h-8 resize-none border-0 bg-transparent px-1 py-0.5 text-sm shadow-none focus-visible:border-transparent focus-visible:ring-0"
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => sendQuestion()}
                  disabled={isLoading || !inputValue.trim()}
                  aria-label="Send message"
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-40"
                  style={{ backgroundColor: accentColor }}
                >
                  <Send className="size-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Launcher button */}
        <Button
          type="button"
          size="icon-lg"
          className="size-12 rounded-full shadow-lg text-white"
          style={{ backgroundColor: accentColor }}
          onClick={() => setIsOpen((v) => !v)}
          aria-label={isOpen ? 'Close chat' : 'Open track assistant'}
        >
          {isOpen ? <X className="size-5" /> : <MessageCircle className="size-5" />}
        </Button>
      </div>
    </>
  )
}
