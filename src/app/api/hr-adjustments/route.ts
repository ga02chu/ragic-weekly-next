import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/hr-adjustments?year=YYYY&month=M
// 讀 HR 系統的加扣項登記表（public.monthly_adjustments），取代 Apollo 出勤檔的加扣項分頁。
// Apollo 檔是「發薪月」口徑（混上月項目），HR 登記表才是「歸屬月」正解。
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
      .from('monthly_adjustments')
      .select('emp_id, subject_code, subject_name, amount, note')
      .eq('month', mstr)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    const adjustments = (data || []).map(r => {
      let amt = Number(r.amount) || 0
      // 同 HR normalizeAdj：8000（扣項-其他）一律轉負
      if (String(r.subject_code) === '8000') amt = -Math.abs(amt)
      return {
        id: r.emp_id as string,
        code: String(r.subject_code || ''),
        desc: (r.subject_name as string) || String(r.subject_code || ''),
        amt,
        note: (r.note as string) || '',
      }
    }).filter(a => a.id && a.amt !== 0)
    return NextResponse.json({ adjustments })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
