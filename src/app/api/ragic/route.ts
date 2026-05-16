import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const limit = searchParams.get('limit') || '3000'

  const apiToken = process.env.RAGIC_TOKEN || searchParams.get('token') || ''
  // RAGIC_PATHS（複數，逗號分隔）優先；舊環境用 RAGIC_PATH（單數）也支援
  const envPathsRaw = process.env.RAGIC_PATHS || process.env.RAGIC_PATH || ''
  const envPaths = envPathsRaw.split(',').map(s => s.trim()).filter(Boolean)
  const qpPath = searchParams.get('path')
  const paths = envPaths.length ? envPaths : (qpPath ? [qpPath] : [])

  if (!paths.length || !apiToken) {
    return NextResponse.json({ error: `Missing: ${!paths.length ? 'path' : 'token'}` }, { status: 400 })
  }

  try {
    const merged: Record<string, unknown> = {}
    for (const apiPath of paths) {
      const url = `https://ap7.ragic.com/${apiPath}?api&limit=${limit}&APIKey=${apiToken}`
      const response = await fetch(url, { cache: 'no-store' })
      const text = await response.text()
      try {
        const data = JSON.parse(text)
        if (data && typeof data === 'object') {
          for (const [k, v] of Object.entries(data)) {
            merged[`${apiPath}#${k}`] = v
          }
        }
      } catch {
        // skip non-JSON response from this path
      }
    }
    return NextResponse.json(merged)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
