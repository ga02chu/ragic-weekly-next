const SHEET_ID = '1fMlJSs6u9JkSQEhQiRYhlKF4eIJXU46yVgfnjv7jBxo'
const MONTH_TABS = ['一月份保底業績','二月份保底業績','三月份保底業績','四月份保底業績',
  '五月份保底業績','六月份保底業績','七月份保底業績','八月份保底業績',
  '九月份保底業績','十月份保底業績','十一月份保底業績','十二月份保底業績']

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const month = parseInt(searchParams.get('month'))
  if (!month) return Response.json({ error: 'Missing month' }, { status: 400 })

  const tabName = MONTH_TABS[month - 1]
  if (!tabName) return Response.json({ error: 'Invalid month' }, { status: 400 })

  try {
    const range = encodeURIComponent(`${tabName}!A2:AQ2`)
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?key=${process.env.GOOGLE_SHEETS_API_KEY}`
    const res = await fetch(url)
    const data = await res.json()
    if (data.error) return Response.json({ error: data.error.message }, { status: 500 })

    const row = (data.values || [[]])[0] || []
    const targets = {}
    for (let i = 0; i < row.length; i++) {
      const cell = String(row[i] || '').trim()
      if (cell && cell.length >= 2 && cell.length <= 10 &&
          !['月份','實際總業績','本月目標依據','表一',''].includes(cell) &&
          !cell.match(/^\d/) && !cell.match(/\/$/)) {
        const targetVal = row[i + 2] || row[i + 1] || ''
        const target = parseInt(String(targetVal).replace(/[,$\s]/g, ''))
        if (target > 100000) targets[cell] = target
      }
    }
    return Response.json({ targets, tab: tabName })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
