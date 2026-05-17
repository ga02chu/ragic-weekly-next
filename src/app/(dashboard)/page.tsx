'use client'

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { toISO, fmt } from '@/lib/ragic/utils'
import { processRecords, filterByStoreType, StoreRecord } from '@/lib/ragic/processRecords'
import { fetchAllRecords, getFields } from '@/lib/ragic/fetchRecords'

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

  // 食材成本資料（同 /food-cost 來源）
  type FCRow = { date: string; store: string; vendor: string; amount: number }
  type FCPurchase = FCRow & { isStaffOnly: boolean; staffMeal: number }
  const [foodCost, setFoodCost] = useState<{ purchases: FCPurchase[]; inventory: FCRow[] } | null>(null)
  useEffect(() => {
    fetch('/api/food-cost').then(r => r.ok ? r.json() : null).then(d => {
      if (d && d.purchases) setFoodCost({ purchases: d.purchases, inventory: d.inventory || [] })
    }).catch(() => { /* ignore */ })
  }, [])

  // 讀 HR 計算 snapshot（/hr 頁計算完會存）
  type HRSnapshot = {
    calcAt: number; year: number; month: number; viewMode: string; dateFrom: string; dateTo: string
    totalCost: number
    byStore: { cat: string; totalCost: number; ft: number; pt: number; totalH: number }[]
  }
  const [hrSnapshot, setHrSnapshot] = useState<HRSnapshot | null>(null)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('hr_last_result')
      if (raw) setHrSnapshot(JSON.parse(raw))
    } catch { /* ignore */ }
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

  // 食材成本摘要（依當前 dateFrom-dateTo + storeFilter）
  const foodSummary = useMemo(() => {
    if (!foodCost) return null
    const storesInScope = new Set<string>(storeList.map(([, s]) => s.displayName))
    const ALWAYS_EXCLUDE = ['樂清']
    const isAutoEx = (v: string) => ALWAYS_EXCLUDE.some(k => v.includes(k))

    const fromD = dateFrom
    const toD = dateTo
    const toPlus3D = (() => { const d = new Date(toD + 'T00:00:00'); d.setDate(d.getDate() + 3); return toISO(d) })()

    // 進貨：在範圍內 + 非「整單員工餐」+ 名稱不含樂清
    const purInRange = foodCost.purchases.filter(p =>
      p.date >= fromD && p.date <= toD &&
      storesInScope.has(p.store) &&
      !p.isStaffOnly &&
      !isAutoEx(p.vendor)
    )
    const purTotal = purInRange.reduce((s, p) => s + p.amount, 0)

    // 員工餐 (整單員工餐) 金額
    const staffMeal = foodCost.purchases.filter(p =>
      p.date >= fromD && p.date <= toD &&
      storesInScope.has(p.store) &&
      !isAutoEx(p.vendor)
    ).reduce((s, p) => s + (p.staffMeal || 0), 0)

    // 期初 / 期末：找離 ref 最近的盤點（±3 天 grace），對每個 (store, vendor) 各算
    const pickNearest = (rows: FCRow[], refDate: string) => {
      if (!rows.length) return 0
      const byDate: Record<string, number> = {}
      rows.forEach(r => { byDate[r.date] = (byDate[r.date] || 0) + r.amount })
      const refMs = new Date(refDate + 'T00:00:00').getTime()
      let bestD = '', bestDist = Infinity
      for (const d of Object.keys(byDate)) {
        const ms = new Date(d + 'T00:00:00').getTime()
        const diff = (ms - refMs) / 86400000
        if (diff < -30 || diff > 3) continue
        const dist = Math.abs(diff)
        if (dist < bestDist || (dist === bestDist && d <= refDate)) { bestDist = dist; bestD = d }
      }
      return bestD ? byDate[bestD] : 0
    }
    const invInScope = foodCost.inventory.filter(i => storesInScope.has(i.store) && !isAutoEx(i.vendor))
    const byStoreVendor: Record<string, FCRow[]> = {}
    invInScope.forEach(r => { (byStoreVendor[`${r.store}#${r.vendor}`] ||= []).push(r) })
    let begin = 0, end = 0
    for (const rows of Object.values(byStoreVendor)) {
      begin += pickNearest(rows, fromD)
      end += pickNearest(rows, toPlus3D)
    }
    const usage = Math.max(0, begin + purTotal - end)
    const ratio = totalRev > 0 ? (usage / totalRev) * 100 : 0
    return { usage, purTotal, staffMeal, ratio, begin, end }
  }, [foodCost, dateFrom, dateTo, storeList, totalRev])

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

          {/* 成本概況：食材成本 + 人事成本入口 */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1a2f4e', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>📊 成本概況</span>
              <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 400 }}>（依目前篩選的期間與分店）</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              {/* 食材使用量 */}
              <a href="/food-cost" style={{ background: '#fff', borderRadius: 12, padding: '16px 20px', border: '1px solid #e8e6e1', textDecoration: 'none', display: 'block', transition: 'transform 0.15s', position: 'relative' }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                  <span>食材使用量</span>
                  <span style={{ color: BRAND }}>→</span>
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#1a2f4e' }}>
                  ${foodSummary ? fmt(foodSummary.usage) : '—'}
                </div>
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                  期初 ${foodSummary ? fmt(foodSummary.begin) : '—'} + 進貨 ${foodSummary ? fmt(foodSummary.purTotal) : '—'} − 期末 ${foodSummary ? fmt(foodSummary.end) : '—'}
                </div>
              </a>

              {/* 食材成本率 */}
              <a href="/food-cost" style={{
                background: foodSummary && totalRev > 0
                  ? (foodSummary.ratio > 35 ? '#fee2e2' : foodSummary.ratio > 30 ? '#fef3c7' : '#dcfce7')
                  : '#fff',
                borderRadius: 12, padding: '16px 20px',
                border: `1px solid ${foodSummary && totalRev > 0 ? (foodSummary.ratio > 35 ? '#fca5a5' : foodSummary.ratio > 30 ? '#fbbf24' : '#86efac') : '#e8e6e1'}`,
                textDecoration: 'none', display: 'block',
              }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                  <span>食材成本率</span>
                  <span style={{ color: BRAND }}>→</span>
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: foodSummary && totalRev > 0 ? (foodSummary.ratio > 35 ? '#dc2626' : foodSummary.ratio > 30 ? '#d97706' : '#16a34a') : '#9ca3af' }}>
                  {foodSummary && totalRev > 0 ? `${foodSummary.ratio.toFixed(2)}%` : '—'}
                </div>
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                  健康範圍 ≤30% 🟢｜30-35% 🟡｜&gt;35% 🔴
                </div>
              </a>

              {/* 員工餐金額 */}
              <a href="/food-cost" style={{ background: '#fff', borderRadius: 12, padding: '16px 20px', border: '1px solid #e8e6e1', textDecoration: 'none', display: 'block' }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                  <span>員工餐金額</span>
                  <span style={{ color: BRAND }}>→</span>
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#d97706' }}>
                  ${foodSummary ? fmt(foodSummary.staffMeal) : '—'}
                </div>
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                  含整單員工餐 + 混合單員工餐 line items
                </div>
              </a>

              {/* 人事成本 */}
              <a href="/hr" style={{
                background: hrSnapshot && totalRev > 0
                  ? ((hrSnapshot.totalCost / totalRev * 100) > 35 ? '#fee2e2' : (hrSnapshot.totalCost / totalRev * 100) > 30 ? '#fef3c7' : '#dcfce7')
                  : '#fff',
                borderRadius: 12, padding: '16px 20px',
                border: `1px solid ${hrSnapshot && totalRev > 0 ? ((hrSnapshot.totalCost / totalRev * 100) > 35 ? '#fca5a5' : (hrSnapshot.totalCost / totalRev * 100) > 30 ? '#fbbf24' : '#86efac') : '#e8e6e1'}`,
                textDecoration: 'none', display: 'block',
              }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                  <span>人事成本</span>
                  <span style={{ color: BRAND }}>→</span>
                </div>
                {hrSnapshot ? (
                  <>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#1a2f4e' }}>
                      ${fmt(hrSnapshot.totalCost)}
                    </div>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                      成本率 {totalRev > 0 ? (hrSnapshot.totalCost / totalRev * 100).toFixed(2) + '%' : '—'}
                      {' · '}
                      {hrSnapshot.viewMode === 'week'
                        ? `期間 ${hrSnapshot.dateFrom} ~ ${hrSnapshot.dateTo}`
                        : `${hrSnapshot.year}/${hrSnapshot.month}`}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#9ca3af' }}>
                      未計算
                    </div>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                      點此前往 HR 頁面上傳檔案計算
                    </div>
                  </>
                )}
              </a>
            </div>
          </div>

          {/* 分店成本明細 */}
          {hasData && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1a2f4e', marginBottom: 8 }}>
                🏪 分店成本明細
              </div>
              <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e6e1', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#fafaf8' }}>
                      {['分店', '營業額', '食材使用', '食材率', '人事成本', '人事率', '合計成本率'].map((h, i) => (
                        <th key={h} style={{ padding: '10px 14px', textAlign: i === 0 ? 'left' : 'right', color: '#6b7280', fontWeight: 600, borderBottom: '1.5px solid #e8e6e1', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {storeList.map(([key, s]) => {
                      const sName = s.displayName
                      // 該分店食材使用量
                      let foodUsage = 0
                      if (foodCost) {
                        const ALWAYS_EXCLUDE = ['樂清']
                        const isAutoEx = (v: string) => ALWAYS_EXCLUDE.some(k => v.includes(k))
                        const purIn = foodCost.purchases.filter(p =>
                          p.store === sName && p.date >= dateFrom && p.date <= dateTo && !p.isStaffOnly && !isAutoEx(p.vendor)
                        )
                        const purTotal = purIn.reduce((s, p) => s + p.amount, 0)
                        const toPlus3 = (() => { const d = new Date(dateTo + 'T00:00:00'); d.setDate(d.getDate() + 3); return toISO(d) })()
                        const pickNear = (rows: FCRow[], ref: string) => {
                          if (!rows.length) return 0
                          const byDate: Record<string, number> = {}
                          rows.forEach(r => { byDate[r.date] = (byDate[r.date] || 0) + r.amount })
                          const refMs = new Date(ref + 'T00:00:00').getTime()
                          let bd = '', bdist = Infinity
                          for (const d of Object.keys(byDate)) {
                            const ms = new Date(d + 'T00:00:00').getTime()
                            const diff = (ms - refMs) / 86400000
                            if (diff < -30 || diff > 3) continue
                            const dist = Math.abs(diff)
                            if (dist < bdist || (dist === bdist && d <= ref)) { bdist = dist; bd = d }
                          }
                          return bd ? byDate[bd] : 0
                        }
                        const invInStore = foodCost.inventory.filter(i => i.store === sName && !isAutoEx(i.vendor))
                        const byVendor: Record<string, FCRow[]> = {}
                        invInStore.forEach(r => { (byVendor[r.vendor] ||= []).push(r) })
                        let begin = 0, end = 0
                        for (const rows of Object.values(byVendor)) {
                          begin += pickNear(rows, dateFrom)
                          end += pickNear(rows, toPlus3)
                        }
                        foodUsage = Math.max(0, begin + purTotal - end)
                      }
                      const foodRatio = s.rev > 0 ? foodUsage / s.rev * 100 : 0

                      // 該分店人事成本
                      const hrStore = hrSnapshot?.byStore.find(b => b.cat === sName || sName.includes(b.cat) || b.cat.includes(sName))
                      const hrCost = hrStore?.totalCost || 0
                      const hrRatio = s.rev > 0 ? hrCost / s.rev * 100 : 0
                      const totalCostRatio = foodRatio + hrRatio

                      const ratioColor = (r: number) => r > 35 ? '#dc2626' : r > 30 ? '#d97706' : '#16a34a'
                      const totalColor = (r: number) => r > 65 ? '#dc2626' : r > 55 ? '#d97706' : '#16a34a'

                      return (
                        <tr key={key} style={{ borderBottom: '1px solid #f0eee9' }}>
                          <td style={{ padding: '10px 14px', fontWeight: 600, color: '#1a2f4e' }}>{s.displayName}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>${fmt(s.rev)}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', color: '#6b7280', fontVariantNumeric: 'tabular-nums' }}>{foodCost ? `$${fmt(foodUsage)}` : '—'}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: foodCost && s.rev > 0 ? ratioColor(foodRatio) : '#d1d5db' }}>
                            {foodCost && s.rev > 0 ? `${foodRatio.toFixed(2)}%` : '—'}
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', color: '#6b7280', fontVariantNumeric: 'tabular-nums' }}>
                            {hrSnapshot ? (hrCost > 0 ? `$${fmt(hrCost)}` : '—') : '—'}
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: hrSnapshot && hrCost > 0 && s.rev > 0 ? ratioColor(hrRatio) : '#d1d5db' }}>
                            {hrSnapshot && hrCost > 0 && s.rev > 0 ? `${hrRatio.toFixed(2)}%` : '—'}
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: foodCost && hrSnapshot && hrCost > 0 && s.rev > 0 ? totalColor(totalCostRatio) : '#d1d5db' }}>
                            {foodCost && hrSnapshot && hrCost > 0 && s.rev > 0 ? `${totalCostRatio.toFixed(2)}%` : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {!hrSnapshot && (
                  <div style={{ padding: '8px 16px', fontSize: 11, color: '#9ca3af', background: '#fafaf8', borderTop: '1px solid #f0eee9' }}>
                    ⚠️ 人事成本欄位需要先到 <a href="/hr" style={{ color: BRAND, fontWeight: 600 }}>HR 頁面</a> 上傳檔案計算過才會顯示
                  </div>
                )}
              </div>
            </div>
          )}

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
