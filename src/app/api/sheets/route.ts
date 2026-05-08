import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const sheetId = searchParams.get('sheetId')
  const range = searchParams.get('range')
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY

  if (!sheetId || !range) {
    return NextResponse.json({ error: 'Missing sheetId or range' }, { status: 400 })
  }

  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?key=${apiKey}`
    const response = await fetch(url)
    const data = await response.json()
    return NextResponse.json(data)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
