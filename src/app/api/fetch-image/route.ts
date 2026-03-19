import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url')
  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 })
  }

  let targetUrl: URL
  try {
    targetUrl = new URL(url)
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }

  if (!['http:', 'https:'].includes(targetUrl.protocol)) {
    return NextResponse.json({ error: 'Only http/https URLs are supported' }, { status: 400 })
  }

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 ColorAnalyzer/1.0' },
    })

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch image: ${response.status} ${response.statusText}` },
        { status: 502 }
      )
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.startsWith('image/')) {
      return NextResponse.json(
        { error: `URL does not point to an image (content-type: ${contentType})` },
        { status: 400 }
      )
    }

    const buffer = await response.arrayBuffer()
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch image from URL' }, { status: 500 })
  }
}
