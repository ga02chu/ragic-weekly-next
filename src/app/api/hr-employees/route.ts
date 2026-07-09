import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/hr-employees
// 從 HR 人事系統（同資料庫 public.employees）帶入在職員工的薪資保險現值，
// 轉成與 parsePay() 相同的 HREmployee 形狀，取代手動上傳「薪資保險資料」xlsx。
// HR 系統是薪資現值的唯一正解（可手動編輯），Apollo 匯出檔反而可能過時。

// HR 系統的分店名 → 週報沿用的 Apollo 部門名（出勤/打卡檔的部門也是這套，要一致才能篩選）
const STORE_TO_DEPT: Record<string, string> = {
  '料韓男台北': '台北(1&2號店)',
  '料韓男3號店': '3號店',
  '英洙家': '英洙家',
  '總部': '總部',
}

export async function GET() {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .schema('public')
      .from('employees')
      .select('emp_id, name, unit, store, position, base_salary, hourly_rate, food_allow, mgr_allow, housing_allow, perf_bonus, annual_bonus, skill_bonus, labor_ins_amt, occ_ins_amt, pension_amt, health_ins_amt, hire_date, birthday')
      .eq('is_active', true)
      .order('emp_id')
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    const employees = (data || []).map(e => {
      const bs = Number(e.base_salary) || 0
      const hr = Number(e.hourly_rate) || 0
      const meal = Number(e.food_allow) || 0
      const mgmt = Number(e.mgr_allow) || 0
      const housing = Number(e.housing_allow) || 0
      const perf = Number(e.perf_bonus) || 0
      const annual = Number(e.annual_bonus) || 0
      const skill = Number(e.skill_bonus) || 0
      return {
        id: e.emp_id,
        name: e.name,
        dept: e.unit === '執行長' ? '執行長' : (STORE_TO_DEPT[e.store as string] ?? e.store ?? ''),
        baseSalary: bs, mealAllow: meal, hourlyRate: hr,
        mgmtAllow: mgmt, housingAllow: housing,
        perfBonus: perf, annualBonus: annual, skillAllow: skill,
        title: e.position || '',
        titleLoc: '',  // 前端 rehydratePay 會用 deriveTitleLoc(title) 重算
        fixedSalary: bs + meal + mgmt + housing + perf + annual + skill,
        lbB: Number(e.labor_ins_amt) || 0,
        vocB: Number(e.occ_ins_amt) || 0,
        penB: Number(e.pension_amt) || 0,
        hbB: Number(e.health_ins_amt) || 0,
        type: bs > 0 ? '月薪正職' : hr > 0 ? '時薪工讀' : '未設定',
        hireDate: e.hire_date || null,
        birthday: e.birthday || null,
      }
    })
    return NextResponse.json({ employees, count: employees.length })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
