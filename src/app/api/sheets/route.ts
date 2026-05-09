import { NextRequest, NextResponse } from 'next/server'

const SHEET_ID = '1fMlJSs6u9JkSQEhQiRYhlKF4eIJXU46yVgfnjv7jBxo'
const MONTH_NAMES = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month')
  const sheetId = searchParams.get('sheetId') || SHEET_ID
  const range = searchParams.get('range')
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY

  if (!apiKey) {
    return NextResponse.json({ error: 'Missing GOOGLE_SHEETS_API_KEY' }, { status: 500 })
  }

  try {
    if (month) {
      const monthNum = parseInt(month)
      if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
        return NextResponse.json({ error: 'Invalid month' }, { status: 400 })
      }
      const tabName = `${MONTH_NAMES[monthNum - 1]}份保底業績`
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(tabName)}?key=${apiKey}`
      const res = await fetch(url)
      const data = await res.json()
      const targets: Record<string, number> = {}
      const rows: string[][] = data.values || []
      for (const row of rows) {
        const storeName = String(row[0] || '').trim()
        const amt = parseFloat(String(row[1] || '').replace(/,/g, ''))
        if (storeName && !isNaN(amt) && amt > 0 && storeName !== '分店' && storeName !== '店名') {
          targets[storeName] = amt
        }
      }
      return NextResponse.json({ targets })
    }

    if (!range) {
      return NextResponse.json({ error: 'Missing range' }, { status: 400 })
    }

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?key=${apiKey}`
    const res = await fetch(url)
    const data = await res.json()
    return NextResponse.json(data)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
