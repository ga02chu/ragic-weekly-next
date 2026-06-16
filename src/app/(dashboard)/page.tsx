'use client'

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { toISO, fmt } from '@/lib/ragic/utils'
import { processRecords, filterByStoreType, StoreRecord } from '@/lib/ragic/processRecords'
import { fetchAllRecords, getFields } from '@/lib/ragic/fetchRecords'
import { mapLocToStore } from '@/lib/hr/calc'

const RevenueAreaChart = dynamic(
  () => import('recharts').then(({ AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer }) =>
    function RevenueAreaChart({ data }: { data: { date: string; rev: number }[] }) {
      return (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
            <defs>
              <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={BRAND} stopOpacity={0.15} />
                <stop offset="95%" stopColor={BRAND} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${fmt(v)}`} width={72} />
            <Tooltip formatter={(v) => [`$${fmt(Number(v))}`, '營業額']} />
            <Area type="monotone" dataKey="rev" stroke={BRAND} strokeWidth={2} fill="url(#revGrad)" dot={{ fill: BRAND, r: 3 }} />
          </AreaChart>
        </ResponsiveContainer>
      )
    }
  ),
  { ssr: false }
)

const StoreDonutChart = dynamic(
  () => import('recharts').then(({ PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer }) =>
    function StoreDonutChart({ data, colors }: { data: { name: string; value: number }[]; colors: string[] }) {
      return (
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie data={data} cx="40%" cy="50%" innerRadius={55} outerRadius={85} dataKey="value" paddingAngle={2}>
              {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
            </Pie>
            <Legend layout="vertical" align="right" verticalAlign="middle"
              formatter={(value) => <span style={{ fontSize: 11, color: '#374151' }}>{value}</span>} />
            <Tooltip formatter={(v) => [`$${fmt(Number(v))}`, '營業額']} />
          </PieChart>
        </ResponsiveContainer>
      )
    }
  ),
  { ssr: false }
)

const BRAND = '#3c2929'
const BRAND_LIGHT = '#f5efef'
const COLORS = [BRAND, '#5c7a6e', '#8B6914', '#1e4d8c', '#6b4c8a', '#1a6b4a', '#7a3a1e', '#2d5a6b']

type StoreFilter = 'all' | 'direct' | 'franchise'
type SessionFilter = 'all' | 'noon' | 'evening'
type RangeKey = 'thisweek' | 'lastweek' | 'thismonth' | 'lastmonth' | 'custom'

function getRange(key: RangeKey) {
  const t = new Date()
  const dow = t.getDay()
  let from: Date, to: Date
  if (key === 'thisweek') {
    from = new Date(t); from.setDate(t.getDate() - (dow === 0 ? 6 : dow - 1))
    to = new Date(from); to.setDate(from.getDate() + 6)
  } else if (key === 'lastweek') {
    from = new Date(t); from.setDate(t.getDate() - (dow === 0 ? 6 : dow - 1) - 7)
    to = new Date(from); to.setDate(from.getDate() + 6)
  } else if (key === 'thismonth') {
    from = new Date(t.getFullYear(), t.getMonth(), 1)
    to = new Date(t.getFullYear(), t.getMonth() + 1, 0)
  } else {
    from = new Date(t.getFullYear(), t.getMonth() - 1, 1)
    to = new Date(t.getFullYear(), t.getMonth(), 0)
  }
  return { from: toISO(from), to: toISO(to) }
}

function diffBadge(curr: number, prev: number) {
  if (!prev) return null
  const pct = ((curr - prev) / prev * 100).toFixed(1)
  const up = curr >= prev
  return (
    <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 20, background: up ? '#dcfce7' : '#fee2e2', color: up ? '#166534' : '#991b1b', marginLeft: 6 }}>
      {up ? '▲' : '▼'} {Math.abs(Number(pct))}%
    </span>
  )
}

export default function DashboardPage() {
  const initialRange = getRange('thisweek')
  const [dateFrom, setDateFrom] = useState(initialRange.from)
  const [dateTo, setDateTo] = useState(initialRange.to)
  const [activeRange, setActiveRange] = useState<RangeKey>('thisweek')
  const [storeFilter, setStoreFilter] = useState<StoreFilter>('all')
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [byStore, setByStore] = useState<Record<string, StoreRecord>>({})
  const [byDate, setByDate] = useState<Record<string, number>>({})
  const [prevByStore, setPrevByStore] = useState<Record<string, StoreRecord>>({})
  const [targets, setTargets] = useState<Record<string, number>>({})
  const [totalRecords, setTotalRecords] = useState(0)

  // 食材成本 + 人事成本 snapshot
  type FCRow = { date: string; store: string; vendor: string; amount: number }
  type FCPurchase = FCRow & { isStaffOnly: boolean; staffMeal: number }
  type FoodCostData = { purchases: FCPurchase[]; inventory: FCRow[] }
  type HRSnapshot = {
    calcAt: number; year: number; month: number; viewMode: string; dateFrom: string; dateTo: string
    totalCost: number
    byStore: { cat: string; totalCost: number }[]
  }
  const [foodCost, setFoodCost] = useState<FoodCostData | null>(null)
  const [hrSnapshot, setHrSnapshot] = useState<HRSnapshot | null>(null)

  useEffect(() => {
    fetch('/api/food-cost').then(r => r.ok ? r.json() : null).then(d => {
      if (d && Array.isArray(d.purchases)) setFoodCost({ purchases: d.purchases, inventory: d.inventory || [] })
    }).catch(() => { /* ignore */ })

    // 先讀 localStorage（自己的）→ 立即顯示
    try {
      const raw = localStorage.getItem('hr_last_result')
      if (raw) setHrSnapshot(JSON.parse(raw))
    } catch { /* ignore */ }
    // 再從 Supabase 拉最新（跨用戶共享）→ 蓋掉本機版本
    fetch('/api/hr-snapshot')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const list = d?.snapshots
        if (!Array.isArray(list) || list.length === 0) return
        const latest = list[0]
        const normalized: HRSnapshot = {
          calcAt: new Date(latest.calc_at).getTime(),
          year: latest.year,
          month: latest.month,
          viewMode: latest.view_mode || 'month',
          dateFrom: latest.date_from || '',
          dateTo: latest.date_to || '',
          totalCost: Number(latest.total_cost) || 0,
          byStore: Array.isArray(latest.by_store) ? latest.by_store : [],
        }
        setHrSnapshot(normalized)
      }).catch(() => { /* ignore */ })
  }, [])

  const mounted = useRef(false)

  const fetchData = useCallback(async (fromOverride?: string, toOverride?: string) => {
    const f = fromOverride ?? dateFrom
    const t = toOverride ?? dateTo
    if (!f || !t) return
    setLoading(true); setError('')
    try {
      const allRecords = await fetchAllRecords()
      const fields = getFields()

      const dateField = fields.date || '營業日期'
      const inRange = allRecords.filter(r => {
        const d = String(r[dateField] || '').replace(/\//g, '-').slice(0, 10)
        return d >= f && d <= t
      })

      const from = new Date(f), to = new Date(t)
      const diff = to.getTime() - from.getTime()
      const prevTo = new Date(from.getTime() - 86400000)
      const prevFrom = new Date(prevTo.getTime() - diff)
      const prevFromStr = toISO(prevFrom), prevToStr = toISO(prevTo)

      const prevRange = allRecords.filter(r => {
        const d = String(r[dateField] || '').replace(/\//g, '-').slice(0, 10)
        return d >= prevFromStr && d <= prevToStr
      })

      const processed = processRecords(inRange, fields, sessionFilter)
      const prevProcessed = processRecords(prevRange, fields, sessionFilter)
      setByStore(processed.byStore)
      setByDate(processed.byDate)
      setPrevByStore(prevProcessed.byStore)
      setTotalRecords(inRange.length)

      const m = new Date(f).getMonth() + 1
      try {
        const sheetRes = await fetch(`/api/sheets?month=${m}`)
        if (sheetRes.ok) {
          const sheetData = await sheetRes.json()
          if (sheetData.targets) setTargets(sheetData.targets)
        }
      } catch { /* ignore */ }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '載入失敗')
    }
    setLoading(false)
  }, [dateFrom, dateTo, sessionFilter])

  const applyRange = useCallback((key: RangeKey) => {
    if (key === 'custom') { setActiveRange(key); return }
    const r = getRange(key)
    setDateFrom(r.from); setDateTo(r.to); setActiveRange(key)
    fetchData(r.from, r.to)
  }, [fetchData])

  useEffect(() => {
    if (!mounted.current) { mounted.current = true; fetchData() }
  }, [fetchData])

  const filtered = filterByStoreType(byStore, storeFilter)
  const prevFiltered = filterByStoreType(prevByStore, storeFilter)

  const totalRev = Object.values(filtered).reduce((s, v) => s + v.rev, 0)
  const prevTotalRev = Object.values(prevFiltered).reduce((s, v) => s + v.rev, 0)
  const totalGuests = Object.values(filtered).reduce((s, v) => s + v.guests, 0)
  const prevTotalGuests = Object.values(prevFiltered).reduce((s, v) => s + v.guests, 0)
  const totalGroups = Object.values(filtered).reduce((s, v) => s + v.groups, 0)
  const prevTotalGroups = Object.values(prevFiltered).reduce((s, v) => s + v.groups, 0)
  const totalNoshow = Object.values(filtered).reduce((s, v) => s + v.noshow, 0)
  const prevTotalNoshow = Object.values(prevFiltered).reduce((s, v) => s + v.noshow, 0)
  const noshowPct = totalGroups > 0 ? (totalNoshow / totalGroups * 100).toFixed(1) : '0.0'

  const dateEntries = Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b))
  const daysElapsed = dateEntries.length || 1
  const avgRevPerDay = totalRev / daysElapsed

  // 預估月底
  const monthTotalDays = new Date(new Date(dateFrom).getFullYear(), new Date(dateFrom).getMonth() + 1, 0).getDate()

  const storeList = Object.entries(filtered).sort((a, b) => b[1].rev - a[1].rev)
  const hasData = storeList.length > 0
  const hasTargets = Object.keys(targets).length > 0

  // ---- 成本計算 helpers ----
  const ALWAYS_EXCLUDE = ['樂清']
  const isAutoEx = (v: string) => ALWAYS_EXCLUDE.some(k => v.includes(k))

  const addDaysISO = (date: string, days: number) => {
    const d = new Date(date + 'T00:00:00')
    d.setDate(d.getDate() + days)
    return toISO(d)
  }
  const daysBetween = (a: string, b: string) => {
    const ms = new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()
    return Math.floor(ms / 86400000) + 1
  }
  const pickNearest = (rows: FCRow[], refDate: string): number => {
    if (!rows.length) return 0
    const byDate: Record<string, number> = {}
    rows.forEach(r => { byDate[r.date] = (byDate[r.date] || 0) + r.amount })
    const refMs = new Date(refDate + 'T00:00:00').getTime()
    let bestD = '', bestDist = Infinity
    for (const d of Object.keys(byDate)) {
      const dMs = new Date(d + 'T00:00:00').getTime()
      const diffD = (dMs - refMs) / 86400000
      if (diffD < -30 || diffD > 3) continue
      const dist = Math.abs(diffD)
      if (dist < bestDist || (dist === bestDist && d <= refDate)) { bestDist = dist; bestD = d }
    }
    return bestD ? byDate[bestD] : 0
  }

  // 給定分店清單，算食材使用量 + 員工餐金額
  const computeFood = (storeNames: Set<string>) => {
    if (!foodCost) return { usage: 0, staffMeal: 0 }
    const toPlus3 = addDaysISO(dateTo, 3)
    const purIn = foodCost.purchases.filter(p =>
      p.date >= dateFrom && p.date <= dateTo &&
      storeNames.has(p.store) && !p.isStaffOnly && !isAutoEx(p.vendor)
    )
    const purTotal = purIn.reduce((s, p) => s + p.amount, 0)
    const staffMeal = foodCost.purchases.filter(p =>
      p.date >= dateFrom && p.date <= dateTo &&
      storeNames.has(p.store) && !isAutoEx(p.vendor)
    ).reduce((s, p) => s + (p.staffMeal || 0), 0)
    const invIn = foodCost.inventory.filter(i => storeNames.has(i.store) && !isAutoEx(i.vendor))
    const byKey: Record<string, FCRow[]> = {}
    invIn.forEach(r => { (byKey[`${r.store}#${r.vendor}`] ||= []).push(r) })
    let begin = 0, end = 0
    for (const rows of Object.values(byKey)) {
      begin += pickNearest(rows, dateFrom)
      end += pickNearest(rows, toPlus3)
    }
    return { usage: Math.max(0, begin + purTotal - end), staffMeal }
  }

  // HR snapshot 按日攤算
  const hrProration = useMemo(() => {
    if (!hrSnapshot) return null
    let hrFrom: string, hrTo: string
    if (hrSnapshot.viewMode === 'month') {
      const lastDay = new Date(hrSnapshot.year, hrSnapshot.month, 0).getDate()
      const pad = (n: number) => String(n).padStart(2, '0')
      hrFrom = `${hrSnapshot.year}-${pad(hrSnapshot.month)}-01`
      hrTo = `${hrSnapshot.year}-${pad(hrSnapshot.month)}-${pad(lastDay)}`
    } else {
      hrFrom = hrSnapshot.dateFrom || ''
      hrTo = hrSnapshot.dateTo || ''
    }
    if (!hrFrom || !hrTo) return null
    const hrDays = daysBetween(hrFrom, hrTo)
    const overlapFrom = dateFrom > hrFrom ? dateFrom : hrFrom
    const overlapTo = dateTo < hrTo ? dateTo : hrTo
    const overlapDays = overlapFrom <= overlapTo ? daysBetween(overlapFrom, overlapTo) : 0
    const ratio = hrDays > 0 ? overlapDays / hrDays : 0
    return { hrFrom, hrTo, hrDays, overlapDays, ratio }
  }, [hrSnapshot, dateFrom, dateTo])

  // 整體成本 KPI
  const allStoreNames = useMemo(() => new Set<string>(storeList.map(([, s]) => s.displayName)), [storeList])
  const foodOverall = useMemo(() => computeFood(allStoreNames), [foodCost, dateFrom, dateTo, allStoreNames])
  const foodRatio = totalRev > 0 ? foodOverall.usage / totalRev * 100 : 0
  const staffMealRatio = totalRev > 0 ? foodOverall.staffMeal / totalRev * 100 : 0
  const hrCostProrated = hrSnapshot && hrProration ? hrSnapshot.totalCost * hrProration.ratio : 0
  const hrRatio = totalRev > 0 && hrCostProrated > 0 ? hrCostProrated / totalRev * 100 : 0

  const trendData = dateEntries.map(([date, rev]) => ({ date: date.slice(5), rev }))
  const donutData = storeList.map(([, s]) => ({ name: s.displayName, value: s.rev }))

  const btnStyle = (active: boolean) => ({
    padding: '5px 14px', borderRadius: 20, border: '1.5px solid',
    borderColor: active ? BRAND : '#e5e7eb', background: active ? BRAND : '#fff',
    color: active ? '#fff' : '#374151', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  } as React.CSSProperties)

  return (
    <div style={{ padding: 24, maxWidth: 1400 }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1a2f4e', marginBottom: 12 }}>總覽</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {(['all', 'direct', 'franchise'] as StoreFilter[]).map(f => (
            <button key={f} onClick={() => setStoreFilter(f)} style={btnStyle(storeFilter === f)}>
              {f === 'all' ? '全部' : f === 'direct' ? '直營' : '加盟'}
            </button>
          ))}
          <div style={{ width: 1, height: 20, background: '#e5e7eb' }} />
          {(['all', 'noon', 'evening'] as SessionFilter[]).map(s => (
            <button key={s} onClick={() => setSessionFilter(s)} style={btnStyle(sessionFilter === s)}>
              {s === 'all' ? '全部時段' : s === 'noon' ? '中午' : '晚上'}
            </button>
          ))}
          <div style={{ width: 1, height: 20, background: '#e5e7eb' }} />
          {(['thisweek', 'lastweek', 'thismonth', 'lastmonth', 'custom'] as RangeKey[]).map(r => (
            <button key={r} onClick={() => applyRange(r)} style={btnStyle(activeRange === r)}>
              {r === 'thisweek' ? '本週' : r === 'lastweek' ? '上週' : r === 'thismonth' ? '本月' : r === 'lastmonth' ? '上個月' : '自訂'}
            </button>
          ))}
          {activeRange === 'custom' && (
            <>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }} />
              <span style={{ color: '#9ca3af' }}>—</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }} />
            </>
          )}
          <button onClick={() => fetchData()} disabled={loading} style={{
            padding: '7px 20px', borderRadius: 8, border: 'none',
            background: loading ? '#9ca3af' : BRAND, color: '#fff', fontSize: 13, fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}>
            {loading ? '載入中...' : '載入報表'}
          </button>
        </div>
      </div>

      {error && <div style={{ background: '#fee2e2', color: '#991b1b', padding: '10px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{error}</div>}

      {!hasData && !loading && (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>尚無資料</div>
          <div style={{ fontSize: 13 }}>選擇日期區間後點擊「載入報表」</div>
        </div>
      )}

      {hasData && (
        <>
          {/* KPI 卡片 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
            {/* 主要卡片 - 期間總營業額 */}
            <div style={{ background: BRAND_LIGHT, borderRadius: 12, padding: '16px 20px', border: `1px solid ${BRAND}22` }}>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>期間總營業額</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#1a2f4e', display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
                ${fmt(totalRev)}{diffBadge(totalRev, prevTotalRev)}
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>日均 ${fmt(avgRevPerDay)}</div>
            </div>
            <div style={{ background: '#fff', borderRadius: 12, padding: '16px 20px', border: '1px solid #e8e6e1' }}>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>總用餐人數</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#1a2f4e', display: 'flex', alignItems: 'center' }}>
                {fmt(totalGuests)}{diffBadge(totalGuests, prevTotalGuests)}
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>共 {fmt(totalGroups)} 組</div>
            </div>
            <div style={{ background: '#fff', borderRadius: 12, padding: '16px 20px', border: '1px solid #e8e6e1' }}>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>No Show 組數</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#1a2f4e', display: 'flex', alignItems: 'center' }}>
                {fmt(totalNoshow)}{diffBadge(totalNoshow, prevTotalNoshow)}
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>占訂單 {noshowPct}%</div>
            </div>
            <div style={{ background: '#fff', borderRadius: 12, padding: '16px 20px', border: '1px solid #e8e6e1' }}>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>查詢分店數</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#1a2f4e' }}>{storeList.length}</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>共 {totalRecords} 筆資料</div>
            </div>
          </div>

          {/* 💰 成本概況：3 張比例卡 */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1a2f4e', marginBottom: 8 }}>
              💰 成本概況 <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 400 }}>（依目前篩選的期間與分店）</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <RatioCard label="食材成本比例" value={foodCost ? foodRatio : null} sub="食材使用 / 營業額" thresholds={{ green: 30, amber: 35 }} href="/food-cost" />
              <RatioCard label="人事成本比例" value={hrSnapshot && hrCostProrated > 0 && totalRev > 0 ? hrRatio : null} sub={hrSnapshot ? `人事支出 / 營業額 · ${hrProration?.overlapDays || 0}/${hrProration?.hrDays || 0} 天` : '未計算 → 點此前往 HR'} thresholds={{ green: 35, amber: 40 }} href="/hr" />
              <RatioCard label="員工餐比例" value={foodCost ? staffMealRatio : null} sub="員工餐 / 營業額（已從食材成本扣除）" thresholds={{ green: 2, amber: 3 }} href="/food-cost" />
            </div>
          </div>

          {/* 🏪 分店成本明細 */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1a2f4e', marginBottom: 8 }}>🏪 分店成本明細</div>
            <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e6e1', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#fafaf8' }}>
                    {['分店', '營業額', '食材使用', '食材率', '人事成本', '人事率', '員工餐率', '合計成本率'].map((h, i) => (
                      <th key={h} style={{ padding: '12px 14px', textAlign: i === 0 ? 'left' : 'right', color: '#6b7280', fontWeight: 600, borderBottom: '1.5px solid #e8e6e1', whiteSpace: 'nowrap', fontSize: 12 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {storeList.map(([key, s]) => {
                    const sName = s.displayName
                    const storeSet = new Set([sName])
                    const fc = computeFood(storeSet)
                    const fRatio = s.rev > 0 ? fc.usage / s.rev * 100 : 0
                    const smRatio = s.rev > 0 ? fc.staffMeal / s.rev * 100 : 0
                    // 總覽店名（如「2號店(明曜店)」）與 HR 分類（如「料韓男2號店」）名稱不同，
                    // 先用 HR 的歸店規則把店名正規化成分類再配對；'其他'/加盟店不配（避免誤抓）。
                    const sCat = mapLocToStore(sName)
                    const hrStore = hrSnapshot?.byStore.find(b =>
                      (sCat !== '其他' && b.cat === sCat) || b.cat === sName || sName.includes(b.cat) || b.cat.includes(sName))
                    const hrCost = hrStore && hrProration ? Math.round(hrStore.totalCost * hrProration.ratio) : 0
                    const hrR = s.rev > 0 ? hrCost / s.rev * 100 : 0
                    const totalR = fRatio + hrR
                    return (
                      <tr key={key} style={{ borderBottom: '1px solid #f0eee9' }}>
                        <td style={{ padding: '10px 14px', fontWeight: 600 }}>{s.displayName}</td>
                        <td style={tdNum}>${fmt(s.rev)}</td>
                        <td style={{ ...tdNum, color: '#6b7280' }}>{foodCost ? `$${fmt(fc.usage)}` : '—'}</td>
                        <td style={tdNum}>{foodCost && s.rev > 0 ? <Pill v={fRatio} g={30} a={35} /> : '—'}</td>
                        <td style={{ ...tdNum, color: '#6b7280' }}>{hrSnapshot && hrCost > 0 ? `$${fmt(hrCost)}` : '—'}</td>
                        <td style={tdNum}>{hrSnapshot && hrCost > 0 && s.rev > 0 ? <Pill v={hrR} g={35} a={40} /> : '—'}</td>
                        <td style={tdNum}>{foodCost && s.rev > 0 ? <Pill v={smRatio} g={2} a={3} /> : '—'}</td>
                        <td style={tdNum}>{foodCost && hrSnapshot && hrCost > 0 && s.rev > 0 ? <Pill v={totalR} g={65} a={75} /> : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#f7f1e9', fontWeight: 700 }}>
                    <td style={{ padding: '10px 14px' }}>合計</td>
                    <td style={tdNum}>${fmt(totalRev)}</td>
                    <td style={{ ...tdNum, color: '#1a2f4e' }}>{foodCost ? `$${fmt(foodOverall.usage)}` : '—'}</td>
                    <td style={tdNum}>{foodCost && totalRev > 0 ? <Pill v={foodRatio} g={30} a={35} /> : '—'}</td>
                    <td style={{ ...tdNum, color: '#1a2f4e' }}>{hrSnapshot && hrCostProrated > 0 ? `$${fmt(Math.round(hrCostProrated))}` : '—'}</td>
                    <td style={tdNum}>{hrSnapshot && hrCostProrated > 0 && totalRev > 0 ? <Pill v={hrRatio} g={35} a={40} /> : '—'}</td>
                    <td style={tdNum}>{foodCost && totalRev > 0 ? <Pill v={staffMealRatio} g={2} a={3} /> : '—'}</td>
                    <td style={tdNum}>{foodCost && hrSnapshot && hrCostProrated > 0 && totalRev > 0 ? <Pill v={foodRatio + hrRatio} g={65} a={75} /> : '—'}</td>
                  </tr>
                </tfoot>
              </table>
              {hrSnapshot && hrProration && (
                <div style={{ padding: '8px 16px', fontSize: 11, color: '#6b7280', background: '#fafaf8', borderTop: '1px solid #f0eee9' }}>
                  💡 人事成本來自 <a href="/hr" style={{ color: BRAND, fontWeight: 600 }}>HR 頁面</a> 最後一次計算（{hrProration.hrFrom} ~ {hrProration.hrTo}，{hrProration.hrDays} 天），切日期會按重疊 {hrProration.overlapDays} 天比例（{(hrProration.ratio * 100).toFixed(1)}%）攤算
                </div>
              )}
              {!hrSnapshot && (
                <div style={{ padding: '8px 16px', fontSize: 11, color: '#9ca3af', background: '#fafaf8', borderTop: '1px solid #f0eee9' }}>
                  ⚠️ 人事成本欄位需要先到 <a href="/hr" style={{ color: BRAND, fontWeight: 600 }}>HR 頁面</a> 上傳檔案計算過才會顯示
                </div>
              )}
            </div>
          </div>

          {/* 月份保底業績卡片 */}
          {hasTargets && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
              {Object.entries(targets).map(([storeName, target]) => {
                const storeEntry = storeList.find(([, s]) => s.displayName === storeName || s.displayName.includes(storeName) || storeName.includes(s.displayName.replace(/（加盟）/, '')))
                const actual = storeEntry ? storeEntry[1].rev : 0
                const projected = daysElapsed > 0 ? actual / daysElapsed * monthTotalDays : 0
                const pct = target > 0 ? actual / target * 100 : 0
                const projPct = target > 0 ? projected / target * 100 : 0
                const gap = actual - target
                const barPct = Math.min(100, pct)
                return (
                  <div key={storeName} style={{ background: '#fff', borderRadius: 12, padding: '14px 16px', border: '1px solid #e8e6e1' }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#1a2f4e', marginBottom: 10 }}>{storeName}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: '#6b7280' }}>實際營業額</span>
                      <span style={{ fontWeight: 600 }}>${fmt(actual)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: '#6b7280' }}>月目標</span>
                      <span style={{ color: '#9ca3af' }}>${fmt(target)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 10 }}>
                      <span style={{ color: '#6b7280' }}>預估月底</span>
                      <span style={{ color: projected >= target ? '#16a34a' : '#d97706', fontWeight: 600 }}>${fmt(projected)}</span>
                    </div>
                    <div style={{ position: 'relative', height: 6, background: '#f3f4f6', borderRadius: 3, marginBottom: 6 }}>
                      <div style={{ position: 'absolute', height: '100%', width: `${Math.min(100, projPct).toFixed(1)}%`, background: '#d4b8b8', borderRadius: 3 }} />
                      <div style={{ position: 'absolute', height: '100%', width: `${barPct.toFixed(1)}%`, background: BRAND, borderRadius: 3 }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9ca3af' }}>
                      <span>{pct.toFixed(1)}%</span>
                      <span style={{ color: gap >= 0 ? '#16a34a' : '#991b1b' }}>
                        {gap >= 0 ? '▲' : '▼'} 差距 ${fmt(Math.abs(gap))} · 預估達成 {projPct.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* 圖表列 */}
          <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 12, marginBottom: 16 }}>
            {/* 折線圖 */}
            <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e6e1', padding: '16px 20px' }}>
              <div style={{ fontWeight: 600, color: '#1a2f4e', marginBottom: 12 }}>每日營業額趨勢</div>
              <RevenueAreaChart data={trendData} />
            </div>

            {/* 甜甜圈圖 */}
            <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e6e1', padding: '16px 20px' }}>
              <div style={{ fontWeight: 600, color: '#1a2f4e', marginBottom: 12 }}>各分店佔比</div>
              <StoreDonutChart data={donutData} colors={COLORS} />
            </div>
          </div>

          {/* 各分店概覽表格 */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e6e1', overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #e8e6e1', fontWeight: 600, color: '#1a2f4e' }}>各分店概覽</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#fafaf8' }}>
                    {['分店', '類型', '營業額', '用餐人數', '用餐組數', 'No Show', '客單價', '環比狀態'].map(h => (
                      <th key={h} style={{ padding: '10px 16px', textAlign: h === '分店' ? 'left' : 'right', color: '#6b7280', fontWeight: 600, borderBottom: '1.5px solid #e8e6e1', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {storeList.map(([name, s]) => {
                    const prev = prevFiltered[name]
                    const avg = s.avgPays.length ? s.avgPays.reduce((a, b) => a + b, 0) / s.avgPays.length : 0
                    const revChange = prev?.rev ? (s.rev - prev.rev) / prev.rev * 100 : null
                    const statusBadge = revChange === null
                      ? <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#f3f4f6', color: '#6b7280' }}>無對比</span>
                      : revChange >= 5
                        ? <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#dcfce7', color: '#166534' }}>↑ 成長</span>
                        : revChange <= -5
                          ? <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#fee2e2', color: '#991b1b' }}>↓ 衰退</span>
                          : <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#fef3c7', color: '#92400e' }}>→ 持平</span>
                    return (
                      <tr key={name} style={{ borderBottom: '1px solid #f0eee9' }}>
                        <td style={{ padding: '10px 16px', fontWeight: 600 }}>{s.displayName}</td>
                        <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                          {s.type === 'franchise'
                            ? <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#ede9fe', color: '#5b21b6' }}>加盟</span>
                            : <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: BRAND_LIGHT, color: BRAND }}>直營</span>}
                        </td>
                        <td style={{ padding: '10px 16px', textAlign: 'right' }}>${fmt(s.rev)} {prev ? diffBadge(s.rev, prev.rev) : null}</td>
                        <td style={{ padding: '10px 16px', textAlign: 'right' }}>{fmt(s.guests)}</td>
                        <td style={{ padding: '10px 16px', textAlign: 'right' }}>{fmt(s.groups)}</td>
                        <td style={{ padding: '10px 16px', textAlign: 'right' }}>{fmt(s.noshow)} 組</td>
                        <td style={{ padding: '10px 16px', textAlign: 'right' }}>${fmt(avg)}</td>
                        <td style={{ padding: '10px 16px', textAlign: 'right' }}>{statusBadge}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ---- Helpers ----
const tdNum: React.CSSProperties = {
  padding: '10px 14px',
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
}

function Pill({ v, g, a }: { v: number; g: number; a: number }) {
  const bg = v <= g ? '#dcfce7' : v <= a ? '#fef3c7' : '#fee2e2'
  const fg = v <= g ? '#16a34a' : v <= a ? '#d97706' : '#dc2626'
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 20, background: bg, color: fg, fontSize: 11, fontWeight: 600 }}>
      {v.toFixed(2)}%
    </span>
  )
}

function RatioCard({ label, value, sub, thresholds, href }: {
  label: string; value: number | null; sub: string
  thresholds: { green: number; amber: number }
  href: string
}) {
  const hasValue = value !== null && Number.isFinite(value)
  const tier = !hasValue ? 'none' : value! <= thresholds.green ? 'green' : value! <= thresholds.amber ? 'amber' : 'red'
  const bg = tier === 'green' ? '#dcfce7' : tier === 'amber' ? '#fef3c7' : tier === 'red' ? '#fee2e2' : '#fff'
  const border = tier === 'green' ? '#86efac' : tier === 'amber' ? '#fbbf24' : tier === 'red' ? '#fca5a5' : '#e8e6e1'
  const fg = tier === 'green' ? '#16a34a' : tier === 'amber' ? '#d97706' : tier === 'red' ? '#dc2626' : '#9ca3af'
  return (
    <a href={href} style={{
      background: bg, borderRadius: 12, padding: '16px 20px',
      border: `1px solid ${border}`, textDecoration: 'none', display: 'block',
    }}>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
        <span>{label}</span>
        <span style={{ color: '#3c2929' }}>→</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: fg }}>
        {hasValue ? `${value!.toFixed(2)}%` : '—'}
      </div>
      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>{sub}</div>
    </a>
  )
}
