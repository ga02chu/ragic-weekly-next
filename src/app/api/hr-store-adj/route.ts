import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// 分店分攤「手動調整」(C)：跨店支援、休息卡打錯店等系統算不準的情況，
// 由人工針對某個期間、某間店 +/- 時數來校正。
//
// 表結構（Supabase）：
//   hr_store_adjustments
//     id uuid primary key default gen_random_uuid()
//     period_start date not null      -- 期間起（與報表 from 對齊）
//     period_end   date not null      -- 期間迄（與報表 to 對齊）
//     store_cat    text not null      -- 品牌概念店 / 料韓男2號店 / 料韓男3號店 / 英洙家 / 其他
//     delta_h      numeric not null   -- +支援時數 / -誤算時數
//     reason       text               -- 說明（例：加英洙家支援 / 扣英洙家打卡）
//     created_at   timestamptz default now()
//     created_by   text

const STORE_CATS = new Set(['品牌概念店', '料韓男2號店', '料韓男3號店', '英洙家', '其他'])
const isDate = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

// GET /api/hr-store-adj?from=YYYY-MM-DD&to=YYYY-MM-DD → 該期間的調整清單
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from'), to = searchParams.get('to')
  try {
    const supabase = await createClient()
    let q = supabase
      .from('hr_store_adjustments')
      .select('id, period_start, period_end, store_cat, delta_h, reason, created_at, created_by')
      .order('created_at', { ascending: true })
    if (isDate(from)) q = q.eq('period_start', from)
    if (isDate(to)) q = q.eq('period_end', to)
    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ adjustments: data || [] })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// POST /api/hr-store-adj  body: { period_start, period_end, store_cat, delta_h, reason?, created_by? }
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as
    | { period_start?: string; period_end?: string; store_cat?: string; delta_h?: number; reason?: string; created_by?: string | null } | null
  if (!body || !isDate(body.period_start) || !isDate(body.period_end))
    return NextResponse.json({ error: '缺少或格式錯誤的期間（period_start/period_end）' }, { status: 400 })
  if (!body.store_cat || !STORE_CATS.has(body.store_cat))
    return NextResponse.json({ error: '缺少或無效的分店（store_cat）' }, { status: 400 })
  const delta = Number(body.delta_h)
  if (!Number.isFinite(delta) || delta === 0)
    return NextResponse.json({ error: '調整時數（delta_h）需為非零數字' }, { status: 400 })
  try {
    const supabase = await createClient()
    const payload = {
      period_start: body.period_start,
      period_end: body.period_end,
      store_cat: body.store_cat,
      delta_h: delta,
      reason: (body.reason ?? '').trim(),
      created_by: body.created_by ?? null,
    }
    const { data, error } = await supabase
      .from('hr_store_adjustments')
      .insert(payload)
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, adjustment: data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// DELETE /api/hr-store-adj?id=uuid
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 })
  try {
    const supabase = await createClient()
    const { error } = await supabase.from('hr_store_adjustments').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
