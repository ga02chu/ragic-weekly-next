import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const limit = searchParams.get('limit') || '3000'
  const token = searchParams.get('token')
  const path = searchParams.get('path')

  const apiToken = process.env.RAGIC_TOKEN || token
  const apiPath = process.env.RAGIC_PATH || path

  if (!apiPath || !apiToken) {
    return NextResponse.json({ error: `Missing: ${!apiPath ? 'path' : 'token'}` }, { status: 400 })
  }

  try {
    const url = `https://ap7.ragic.com/${apiPath}?api&limit=${limit}&APIKey=${apiToken}`
    const response = await fetch(url)
    const text = await response.text()
    try {
      const data = JSON.parse(text)
      return NextResponse.json(data)
    } catch {
      return new NextResponse(text, { status: 200 })
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
