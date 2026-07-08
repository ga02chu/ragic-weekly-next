import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/hr-official?year=YYYY&month=M
// 讀 HR 人事系統（同資料庫 public schema）的每店每月正式結算，給週報對帳用。
// 同店多列（正職/工讀分列）在這裡先加總。
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const year = Number(searchParams.get('year'))
  const month = Number(searchParams.get('month'))
  if (!year || !month) {
    return NextResponse.json({ error: 'Missing year/month' }, { status: 400 })
  }
  try {
    const supabase = await createClient()
    const mstr = `${year}-${String(month).padStart(2, '0')}`
    const { data, error } = await supabase
      .schema('public')
      .from('store_monthly_cost')
      .select('store, total_gross, total_ins, total_cost')
      .eq('month', mstr)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    const stores: Record<string, { gross: number; ins: number; cost: number }> = {}
    for (const r of data || []) {
      const k = (r.store as string) || '未知'
      if (!stores[k]) stores[k] = { gross: 0, ins: 0, cost: 0 }
      stores[k].gross += Number(r.total_gross) || 0
      stores[k].ins += Number(r.total_ins) || 0
      stores[k].cost += Number(r.total_cost) || 0
    }
    return NextResponse.json({ month: mstr, stores })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
