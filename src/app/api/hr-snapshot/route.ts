import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface ByStoreEntry { cat: string; totalCost: number }
interface Snapshot {
  year: number
  month: number
  view_mode: string
  date_from: string | null
  date_to: string | null
  total_cost: number
  by_store: ByStoreEntry[]
  calc_at: string
  uploaded_by?: string | null
}

// GET /api/hr-snapshot           → 全部 (依 year, month desc)
// GET /api/hr-snapshot?year=YYYY&month=M → 指定月份最新一筆
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const year = searchParams.get('year')
  const month = searchParams.get('month')

  try {
    const supabase = await createClient()
    let q = supabase.from('hr_snapshots').select('*').order('year', { ascending: false }).order('month', { ascending: false }).order('calc_at', { ascending: false })
    if (year) q = q.eq('year', Number(year))
    if (month) q = q.eq('month', Number(month))
    const { data, error } = await q.limit(50)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ snapshots: data || [] })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// POST /api/hr-snapshot  → 存一筆（依 year+month+view_mode+date_from+date_to 唯一）
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as Partial<Snapshot> | null
  if (!body || typeof body.year !== 'number' || typeof body.month !== 'number') {
    return NextResponse.json({ error: 'Missing year/month' }, { status: 400 })
  }
  try {
    const supabase = await createClient()
    const payload = {
      year: body.year,
      month: body.month,
      view_mode: body.view_mode || 'month',
      date_from: body.date_from || null,
      date_to: body.date_to || null,
      total_cost: body.total_cost ?? 0,
      by_store: body.by_store ?? [],
      calc_at: body.calc_at || new Date().toISOString(),
      uploaded_by: body.uploaded_by ?? null,
    }
    const { data, error } = await supabase
      .from('hr_snapshots')
      .upsert(payload, { onConflict: 'year,month,view_mode,date_from,date_to' })
      .select()
      .single()
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, snapshot: data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
