import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// 分店分攤校正紀錄：跨店支援、休息卡打錯店等系統算不準的情況人工校正。
// 兩種 kind（見 supabase/hr_store_adjustments.sql）：
//   'manual'   店為單位 +/- 時數（store_cat + delta_h）
//   'reassign' 個人逐筆改歸（from_cat → to_cat，delta_h 正數），系統自動 from −H / to +H

const STORE_CATS = new Set(['品牌概念店', '料韓男2號店', '料韓男3號店', '英洙家', '其他'])
const isDate = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const COLS = 'id, period_start, period_end, kind, store_cat, delta_h, from_cat, to_cat, emp_id, emp_name, src_date, reason, created_at, created_by'

// GET /api/hr-store-adj?from=YYYY-MM-DD&to=YYYY-MM-DD → 該期間的調整清單
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from'), to = searchParams.get('to')
  try {
    const supabase = await createClient()
    let q = supabase
      .from('hr_store_adjustments')
      .select(COLS)
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

// POST /api/hr-store-adj
//   manual:   { period_start, period_end, store_cat, delta_h, reason?, created_by? }
//   reassign: { kind:'reassign', period_start, period_end, from_cat, to_cat, delta_h, emp_id?, emp_name?, src_date?, reason?, created_by? }
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body || !isDate(body.period_start) || !isDate(body.period_end))
    return NextResponse.json({ error: '缺少或格式錯誤的期間（period_start/period_end）' }, { status: 400 })

  const kind = body.kind === 'reassign' ? 'reassign' : 'manual'

  let payload: Record<string, unknown>
  if (kind === 'reassign') {
    const from = body.from_cat, to = body.to_cat
    if (typeof from !== 'string' || !STORE_CATS.has(from))
      return NextResponse.json({ error: '缺少或無效的來源店（from_cat）' }, { status: 400 })
    if (typeof to !== 'string' || !STORE_CATS.has(to))
      return NextResponse.json({ error: '缺少或無效的目標店（to_cat）' }, { status: 400 })
    if (from === to)
      return NextResponse.json({ error: '改歸的店不能跟原本同一間' }, { status: 400 })
    const h = Number(body.delta_h)
    if (!Number.isFinite(h) || h <= 0)
      return NextResponse.json({ error: '改歸時數（delta_h）需為正數' }, { status: 400 })
    payload = {
      period_start: body.period_start, period_end: body.period_end,
      kind: 'reassign', store_cat: null, delta_h: h,
      from_cat: from, to_cat: to,
      emp_id: typeof body.emp_id === 'string' ? body.emp_id : null,
      emp_name: typeof body.emp_name === 'string' ? body.emp_name : null,
      src_date: typeof body.src_date === 'string' ? body.src_date : null,
      reason: String(body.reason ?? '').trim(),
      created_by: typeof body.created_by === 'string' ? body.created_by : null,
    }
  } else {
    if (typeof body.store_cat !== 'string' || !STORE_CATS.has(body.store_cat))
      return NextResponse.json({ error: '缺少或無效的分店（store_cat）' }, { status: 400 })
    const delta = Number(body.delta_h)
    if (!Number.isFinite(delta) || delta === 0)
      return NextResponse.json({ error: '調整時數（delta_h）需為非零數字' }, { status: 400 })
    payload = {
      period_start: body.period_start, period_end: body.period_end,
      kind: 'manual', store_cat: body.store_cat, delta_h: delta,
      reason: String(body.reason ?? '').trim(),
      created_by: typeof body.created_by === 'string' ? body.created_by : null,
    }
  }

  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('hr_store_adjustments')
      .insert(payload)
      .select(COLS)
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
