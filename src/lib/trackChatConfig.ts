// ---------------------------------------------------------------------------
// TrackChatConfig — parsed from track.themeJson
// ---------------------------------------------------------------------------

export type TrackChatConfig = {
  enabled: boolean
  accentColor: string
  assistantName: string
  meetingUrl: string | undefined
  meetingCtaLabel: string
  meetingCtaThreshold: number
  suggestedQuestions: string[]
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function isValidHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
  } catch {
    return false
  }
}

export function getTrackChatConfig(themeJson: unknown): TrackChatConfig {
  const theme = asRecord(themeJson)
  const chat = asRecord(theme.chat)

  // Default ON — chat shows on every track/experience unless explicitly
  // disabled with themeJson.chat.enabled === false
  const enabled = chat.enabled !== false

  const meetingUrl = isValidHttpsUrl(chat.meetingUrl) ? (chat.meetingUrl as string) : undefined

  const meetingCtaLabel =
    typeof chat.meetingCtaLabel === 'string' && chat.meetingCtaLabel.trim()
      ? (chat.meetingCtaLabel as string).trim().slice(0, 80)
      : 'Book a meeting'

  const rawThreshold = chat.meetingCtaThreshold
  const meetingCtaThreshold =
    typeof rawThreshold === 'number' && Number.isFinite(rawThreshold) && rawThreshold >= 0
      ? Math.floor(rawThreshold)
      : 3

  const accentColor =
    typeof chat.accentColor === 'string' && chat.accentColor.trim()
      ? chat.accentColor.trim()
      : '#30B2BF'

  const assistantName =
    typeof chat.assistantName === 'string' && chat.assistantName.trim()
      ? chat.assistantName.trim().slice(0, 60)
      : 'AI Assistant'

  const rawQuestions = Array.isArray(chat.suggestedQuestions) ? chat.suggestedQuestions : []
  const suggestedQuestions = (rawQuestions as unknown[])
    .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
    .map(q => q.trim().slice(0, 80))
    .slice(0, 4)

  return { enabled, accentColor, assistantName, meetingUrl, meetingCtaLabel, meetingCtaThreshold, suggestedQuestions }
}
