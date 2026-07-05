import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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

    const contextLines: string[] = []
    if (assetTitle) contextLines.push(`Content title: ${assetTitle}`)
    if (assetTags.length) contextLines.push(`Content themes/tags: ${assetTags.join(', ')}`)

    const fullPrompt = contextLines.length
      ? `${BASE_PROMPT}\n\nContent context for visual inspiration (do NOT render any of this as visible text in the image):\n${contextLines.join('\n')}`
      : BASE_PROMPT

    const model = process.env.OPENAI_IMAGE_MODEL?.trim() || 'dall-e-3'
    const isDalle = model.startsWith('dall-e')
    const reqBody: Record<string, unknown> = {
      model,
      prompt: fullPrompt.slice(0, 4000),
      n: 1,
      size: isDalle ? '1792x1024' : '1536x1024',
      quality: isDalle ? 'hd' : 'high',
    }
    if (isDalle) reqBody.response_format = 'b64_json'

    const imageRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
      signal: AbortSignal.timeout(55_000),
    })

    if (!imageRes.ok) {
      const errText = await imageRes.text().catch(() => '')
      console.error('[generate-asset-thumbnail] OpenAI error:', imageRes.status, errText)
      return NextResponse.json({ error: 'Image generation failed' }, { status: 502 })
    }

    const imageData = await imageRes.json() as { data?: Array<{ b64_json?: string }> }
    const b64 = imageData.data?.[0]?.b64_json
    if (!b64) return NextResponse.json({ error: 'No image returned' }, { status: 502 })

    const buffer = Buffer.from(b64, 'base64')
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
