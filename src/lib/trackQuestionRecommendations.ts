export type Asset = {
  id: string
  title: string
  description?: string | null
  type: 'video' | 'article' | 'pdf' | 'image'
  metadataJson?: unknown
}

export type RecommendationInput = {
  assets: Asset[]
  currentAssetId?: string | null
  askedQuestions?: string[]
}

const FALLBACK_QUESTIONS = [
  'Which asset should I start with?',
  'How do these topics connect?',
  'What is the key takeaway from this track?',
  'Which asset is most relevant to my use case?',
  'What should I explore next?',
  'How do these assets work together?',
]

function safeTruncateTitle(title: string, maxLength = 80): string {
  const trimmed = title.trim()
  if (trimmed.length <= maxLength) return trimmed
  return trimmed.slice(0, maxLength - 3).trimEnd() + '...'
}

function extractTags(metadataJson: unknown): string[] {
  if (!metadataJson || typeof metadataJson !== 'object' || Array.isArray(metadataJson)) return []
  const record = metadataJson as Record<string, unknown>
  if (!Array.isArray(record.tags)) return []
  return record.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
}

function normalizeForComparison(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function wasAsked(question: string, askedQuestions: string[]): boolean {
  const questionNorm = normalizeForComparison(question)
  return askedQuestions.some((asked) => {
    const askedNorm = normalizeForComparison(asked)
    return askedNorm.includes(questionNorm) || questionNorm.includes(askedNorm)
  })
}

function generateCurrentAssetQuestions(asset: Asset): string[] {
  const title = safeTruncateTitle(asset.title)
  const questions: string[] = []

  questions.push(`What are the main points covered in "${title}"?`)

  const tags = extractTags(asset.metadataJson)
  if (tags.length > 0) {
    const tag = tags[0].trim()
    questions.push(`How does "${title}" address ${tag}?`)
  } else if (asset.description?.trim()) {
    questions.push(`How can I apply the insights from "${title}" to my team?`)
  } else {
    questions.push(`How does "${title}" relate to my use case?`)
  }

  return questions
}

function generateAssetTypeQuestion(asset: Asset): string {
  const title = safeTruncateTitle(asset.title)
  switch (asset.type) {
    case 'video':
      return `What does "${title}" cover?`
    case 'pdf':
      return `What are the key points in "${title}"?`
    case 'article':
      return `What does "${title}" explain?`
    case 'image':
      return `What does "${title}" show?`
    default:
      return `What can I learn from "${title}"?`
  }
}

function generateCrossAssetQuestions(assets: Asset[]): string[] {
  const questions: string[] = [
    'How do these topics connect?',
    'Which asset should I start with?',
    'What is the key takeaway from this track?',
    'Which asset is most relevant to my use case?',
  ]

  const types = Array.from(new Set(assets.map((a) => a.type)))
  if (types.length > 1) {
    questions.push(`How do the ${types.slice(0, 2).join(' and ')} assets complement each other?`)
  }

  return questions
}

export function getRecommendedQuestions(input: RecommendationInput): string[] {
  const { assets, currentAssetId, askedQuestions = [] } = input
  const TARGET_COUNT = 4

  if (assets.length === 0) {
    return FALLBACK_QUESTIONS.filter((q) => !wasAsked(q, askedQuestions)).slice(0, TARGET_COUNT)
  }

  const currentAsset = currentAssetId
    ? assets.find((a) => a.id === currentAssetId) ?? null
    : null
  const otherAssets = assets.filter((a) => a.id !== (currentAsset?.id ?? null))

  const candidates: string[] = []

  // Step 1: Prioritise current asset — generate 1-2 questions
  if (currentAsset) {
    for (const q of generateCurrentAssetQuestions(currentAsset)) {
      candidates.push(q)
    }
  }

  // Step 2: Generate questions from other assets by type
  for (const asset of otherAssets) {
    candidates.push(generateAssetTypeQuestion(asset))
  }

  // Step 3: Cross-asset questions
  for (const q of generateCrossAssetQuestions(assets)) {
    candidates.push(q)
  }

  // Step 4 & 5: Filter asked questions, deduplicate, take exactly 4
  const seen = new Set<string>()
  const filtered: string[] = []

  for (const q of candidates) {
    if (filtered.length >= TARGET_COUNT) break
    const norm = normalizeForComparison(q)
    if (seen.has(norm)) continue
    seen.add(norm)
    if (!wasAsked(q, askedQuestions)) {
      filtered.push(q)
    }
  }

  // Step 5: Pad with generic fallbacks if needed
  if (filtered.length < TARGET_COUNT) {
    for (const fallback of FALLBACK_QUESTIONS) {
      if (filtered.length >= TARGET_COUNT) break
      const norm = normalizeForComparison(fallback)
      if (seen.has(norm)) continue
      seen.add(norm)
      if (!wasAsked(fallback, askedQuestions)) {
        filtered.push(fallback)
      }
    }
  }

  return filtered.slice(0, TARGET_COUNT)
}
