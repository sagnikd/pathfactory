import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url')
  if (!url) return new NextResponse('Missing url param', { status: 400 })

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return new NextResponse('Invalid URL', { status: 400 })
  }

  // Only proxy http(s) — block internal network requests
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PathFactory/1.0)',
        Accept: 'application/pdf,*/*',
      },
      // Server-side fetch — no browser CORS restrictions
    })

    if (!response.ok) {
      return new NextResponse(`Upstream error ${response.status}`, { status: 502 })
    }

    const contentType = response.headers.get('content-type') || 'application/pdf'
    const body = await response.arrayBuffer()

    return new NextResponse(body, {
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
        'Content-Disposition': 'inline',
      },
    })
  } catch (err: any) {
    return new NextResponse(`Proxy error: ${err.message}`, { status: 502 })
  }
}
