import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { assets } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { extractAssetText, summarizeForVisual, generateBannerImage, type Asset } from '@/lib/trackChatServer'

export const runtime = 'nodejs'
export const maxDuration = 60

const BASE_PROMPT = `Create a premium enterprise marketing hero banner inspired by the key themes of an executive whitepaper.

Do not create a book cover or a PDF cover.
Instead create a modern website/social media hero image that visually communicates the paper's core message.

Style:
• Premium B2B SaaS marketing
• Fortune 500 enterprise software
• Clean minimalist design
• Editorial photography
• Apple + Microsoft + Salesforce aesthetic
• Bright natural lighting
• White background with subtle brand-colored gradients
• Plenty of whitespace
• Photorealistic
• High-end digital transformation visuals
• Corporate but warm
• Modern and optimistic

Composition:
• 16:9 landscape (1200×630)
• Left side reserved for headline and messaging
• Right side shows professionals interacting with modern technology
• Flowing digital elements connect people, data and AI
• Soft glassmorphism UI panels floating naturally
• Clean visual hierarchy
• No clutter
• Premium typography space

The illustration should visually communicate:
• enterprise intelligence • connected customer data • AI-powered decision making
• real-time insights • contextual understanding • personalization • trust
• privacy • governance • security • business growth • customer engagement • measurable outcomes

Instead of literal diagrams, represent these concepts through visual metaphors:
• flowing data streams • connected customer nodes • dynamic dashboards
• intelligent recommendations • personalization cards • AI network graphics
• digital journey paths • secure data shields • subtle analytics
• business collaboration • contextual signals • predictive insights

Use realistic business professionals collaborating in a bright modern workspace.
Show technology as helpful and invisible rather than futuristic.
The environment should feel premium, intelligent, calm and trustworthy.

Overall mood: Enterprise AI that empowers marketers while maintaining trust, governance and control.

Avoid: cyberpunk, dark backgrounds, excessive holograms, generic robots, stock-photo appearance, cluttered dashboards, sci-fi interfaces, cheesy AI imagery.

Produce a polished marketing banner suitable for LinkedIn campaigns, enterprise websites, executive presentations and whitepapers.`

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const assetId: string | null = typeof body.assetId === 'string' ? body.assetId.trim() : null
    const assetTitle: string = typeof body.assetTitle === 'string' ? body.assetTitle.trim().slice(0, 200) : ''
    const assetTags: string[] = Array.isArray(body.assetTags)
      ? (body.assetTags as unknown[]).filter((s): s is string => typeof s === 'string').slice(0, 10)
      : []

    if (!assetId) return NextResponse.json({ error: 'assetId required' }, { status: 400 })

    const apiKey = process.env.OPENAI_API_KEY?.trim()
    if (!apiKey) return NextResponse.json({ error: 'Image generation not configured' }, { status: 503 })

    // Document understanding: read the asset's actual content (PDF text,
    // article body, or video transcript) and have gpt-5.4-mini distill it
    // into a short visual brief, instead of handing the image model a bare
    // title and tag list.
    const [assetRow] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1)
    let visualBrief = ''
    if (assetRow) {
      const fullText = await extractAssetText({ ...assetRow, displayTitle: null, subCopy: null } as Asset)
      visualBrief = await summarizeForVisual(fullText, assetTitle || assetRow.title, assetTags)
    }

    const contextLines: string[] = []
    if (visualBrief) {
      contextLines.push(`Core message & visual themes (from reading the actual content):\n${visualBrief}`)
    } else {
      // Extraction/understanding failed or produced nothing — fall back to
      // the shallow title/tags context so generation still proceeds.
      if (assetTitle) contextLines.push(`Content title: ${assetTitle}`)
      if (assetTags.length) contextLines.push(`Content themes/tags: ${assetTags.join(', ')}`)
    }

    const fullPrompt = contextLines.length
      ? `${BASE_PROMPT}\n\nContent context for visual inspiration (do NOT render any of this as visible text in the image):\n${contextLines.join('\n')}`
      : BASE_PROMPT

    const result = await generateBannerImage(fullPrompt)
    if ('error' in result) {
      console.error('[generate-asset-thumbnail]', result.error)
      return NextResponse.json({ error: 'Image generation failed' }, { status: 502 })
    }
    const { buffer } = result
    const path = `thumbnails/${assetId}/ai-generated.png`

    const { error: uploadError } = await supabase.storage
      .from('assets')
      .upload(path, buffer, { contentType: 'image/png', upsert: true })
    if (uploadError) {
      console.error('[generate-asset-thumbnail] storage error:', uploadError)
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
    }

    const { data: urlData } = supabase.storage.from('assets').getPublicUrl(path)
    return NextResponse.json({ url: urlData.publicUrl })
  } catch (err) {
    console.error('[generate-asset-thumbnail]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
