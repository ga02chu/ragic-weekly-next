import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/hr-holidays?year=YYYY&month=M
// 讀 HR 系統的國定假日表（public.public_holidays），取代週報的調整表國定假日分頁。
// 只回「雙倍薪」的假日（跟 HR 系統計薪邏輯一致）。
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const year = Number(searchParams.get('year'))
  const month = Number(searchParams.get('month'))
  if (!year || !month) {
    return NextResponse.json({ error: 'Missing year/month' }, { status: 400 })
  }
  try {
    const supabase = await createClient()
    const pad = (n: number) => String(n).padStart(2, '0')
    const from = `${year}-${pad(month)}-01`
    const to = month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`
    const { data, error } = await supabase
      .schema('public')
      .from('public_holidays')
      .select('date, name, is_double_pay')
      .gte('date', from)
      .lt('date', to)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    const holidays = (data || [])
      .filter(h => h.is_double_pay)
      .map(h => ({ dateStr: String(h.date), name: h.name || '國定假日', multiplier: 2 }))
    return NextResponse.json({ holidays })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
