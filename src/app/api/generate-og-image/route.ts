import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { users } from '@/db/schema'
import { eq } from 'drizzle-orm'

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

    const [dbUser] = await db.select({ organizationId: users.organizationId })
      .from(users).where(eq(users.id, user.id)).limit(1)
    if (!dbUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const trackId: string | null = typeof body.trackId === 'string' ? body.trackId : null
    const trackTitle: string = typeof body.trackTitle === 'string' ? body.trackTitle.trim().slice(0, 200) : ''
    const assetTitles: string[] = Array.isArray(body.assetTitles)
      ? (body.assetTitles as unknown[]).filter((s): s is string => typeof s === 'string').slice(0, 8)
      : []
    const assetDescriptions: string[] = Array.isArray(body.assetDescriptions)
      ? (body.assetDescriptions as unknown[]).filter((s): s is string => typeof s === 'string').slice(0, 4)
      : []

    const apiKey = process.env.OPENAI_API_KEY?.trim()
    if (!apiKey) return NextResponse.json({ error: 'Image generation not configured' }, { status: 503 })

    // Append track context as inspiration (not to show as text in image)
    const contextLines: string[] = []
    if (trackTitle) contextLines.push(`Track title: ${trackTitle}`)
    if (assetTitles.length) contextLines.push(`Content pieces: ${assetTitles.join(', ')}`)
    if (assetDescriptions.length) {
      contextLines.push(`Key themes from the content: ${assetDescriptions.filter(Boolean).join(' | ')}`)
    }

    const fullPrompt = contextLines.length
      ? `${BASE_PROMPT}\n\nContent context for visual inspiration (do NOT render any of this as visible text in the image):\n${contextLines.join('\n')}`
      : BASE_PROMPT

    const model = process.env.OPENAI_IMAGE_MODEL?.trim() || 'dall-e-3'

    const imageRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: fullPrompt.slice(0, 4000),
        n: 1,
        size: '1792x1024',
        quality: 'hd',
        response_format: 'b64_json',
      }),
      signal: AbortSignal.timeout(55_000),
    })

    if (!imageRes.ok) {
      const errText = await imageRes.text().catch(() => '')
      console.error('[generate-og-image] OpenAI error:', imageRes.status, errText)
      return NextResponse.json({ error: 'Image generation failed' }, { status: 502 })
    }

    const imageData = await imageRes.json() as { data?: Array<{ b64_json?: string }> }
    const b64 = imageData.data?.[0]?.b64_json
    if (!b64) return NextResponse.json({ error: 'No image returned' }, { status: 502 })

    const buffer = Buffer.from(b64, 'base64')
    const path = `og-images/${dbUser.organizationId}/${trackId ?? crypto.randomUUID()}.png`

    const { error: uploadError } = await supabase.storage
      .from('assets')
      .upload(path, buffer, { contentType: 'image/png', upsert: true })
    if (uploadError) {
      console.error('[generate-og-image] storage error:', uploadError)
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
    }

    const { data: urlData } = supabase.storage.from('assets').getPublicUrl(path)
    return NextResponse.json({ url: urlData.publicUrl })
  } catch (err) {
    console.error('[generate-og-image]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
