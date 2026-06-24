'use client'

import { useEffect, useRef, useState } from 'react'
import { CalendarDays, MessageCircle, Send, X } from 'lucide-react'
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
}: TrackChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [askedQuestions, setAskedQuestions] = useState<string[]>([])
  const [askedCount, setAskedCount] = useState(0)
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>(
    chatConfig.suggestedQuestions ?? []
  )
  const [showMeetingCta, setShowMeetingCta] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

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

  if (!chatConfig.enabled) return null

  async function sendQuestion(question?: string) {
    const text = (question ?? inputValue).trim()
    if (!text || isLoading) return

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

      <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end">
        {isOpen && (
          <div
            className="mb-3 flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
            style={{ width: 350, maxHeight: 480 }}
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
                    {message.content}
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
