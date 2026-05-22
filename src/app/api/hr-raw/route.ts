import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// 表結構（Supabase）：
//   hr_raw_uploads
//     file_key text PRIMARY KEY    -- 'pay' | 'att' | 'loc' | 'adj' | 'brk'
//     data    jsonb NOT NULL
//     meta    jsonb                -- { name, size, uploadedAt }
//     uploaded_at timestamptz default now()
//     uploaded_by text

const VALID_KEYS = new Set(['pay', 'att', 'loc', 'adj', 'brk'])

// GET /api/hr-raw → 回傳全部 5 種檔案的最新版（key 是唯一鍵，永遠最多 5 筆）
export async function GET() {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('hr_raw_uploads')
      .select('file_key, data, meta, uploaded_at, uploaded_by')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ uploads: data || [] })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// POST /api/hr-raw  body: { file_key, data, meta, uploaded_by? } → upsert
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as
    | { file_key?: string; data?: unknown; meta?: unknown; uploaded_by?: string | null } | null
  if (!body || !body.file_key || !VALID_KEYS.has(body.file_key)) {
    return NextResponse.json({ error: 'Missing or invalid file_key' }, { status: 400 })
  }
  if (body.data === undefined || body.data === null) {
    return NextResponse.json({ error: 'Missing data' }, { status: 400 })
  }
  try {
    const supabase = await createClient()
    const payload = {
      file_key: body.file_key,
      data: body.data,
      meta: body.meta ?? null,
      uploaded_at: new Date().toISOString(),
      uploaded_by: body.uploaded_by ?? null,
    }
    const { data, error } = await supabase
      .from('hr_raw_uploads')
      .upsert(payload, { onConflict: 'file_key' })
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, upload: data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// DELETE /api/hr-raw?file_key=xxx → 從雲端刪除
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const file_key = searchParams.get('file_key')
  if (!file_key || !VALID_KEYS.has(file_key)) {
    return NextResponse.json({ error: 'Missing or invalid file_key' }, { status: 400 })
  }
  try {
    const supabase = await createClient()
    const { error } = await supabase.from('hr_raw_uploads').delete().eq('file_key', file_key)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
