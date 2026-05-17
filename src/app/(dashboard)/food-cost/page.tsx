'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { fetchAllRecords, getFields } from '@/lib/ragic/fetchRecords'

const BRAND = '#3c2929'

type Row = { date: string; store: string; vendor: string; amount: number }
type PurchaseRow = Row & { orderNo: string; staffMeal: number; isStaffOnly: boolean }
type ApiResp = {
  purchases: PurchaseRow[]
  inventory: Row[]
  stores: string[]
  vendors: string[]
}

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 週一為一週起點，回傳當週週一
function mondayOf(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  const day = x.getDay() // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day // shift to Monday
  x.setDate(x.getDate() + diff)
  return x
}

function addDays(d: Date, n: number) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

function fmtMoney(n: number) {
  return Math.round(n).toLocaleString()
}

function fmtDateRange(from: string, to: string) {
  const [y1, m1, d1] = from.split('-').map(Number)
  const [, m2, d2] = to.split('-').map(Number)
  return `${y1} 年 ${m1}/${d1} – ${m2}/${d2}`
}

// 對 (vendor, store) 找「離 refDate 最近」的盤點（容許往後最多 3 天）。
// 同一天多筆 = 不同倉位/分批盤，全部 sum。
// 例：refDate=5/3
//   - 韓廣 5/3=57k, 5/5=58k → 取 5/3（距 0 天 < 5/5 距 2 天）
//   - 巨沅 4/30=27k, 5/4=21k → 取 5/4（距 1 天 < 4/30 距 3 天）符合「週一早上盤上週末」
function pickNearestDateSum(rows: Row[], refDate: string): number {
  if (!rows.length) return 0
  const byDate: Record<string, number> = {}
  rows.forEach(r => { byDate[r.date] = (byDate[r.date] || 0) + r.amount })
  const refMs = new Date(refDate + 'T00:00:00').getTime()
  const WINDOW_BEFORE = 30   // 最多看 30 天前
  const WINDOW_AFTER = 3     // 最多看 3 天後（下週一才盤的情況）
  let bestDate = ''
  let bestDist = Infinity
  for (const d of Object.keys(byDate)) {
    const dMs = new Date(d + 'T00:00:00').getTime()
    const diffDays = (dMs - refMs) / 86400000
    if (diffDays < -WINDOW_BEFORE || diffDays > WINDOW_AFTER) continue
    const dist = Math.abs(diffDays)
    if (dist < bestDist || (dist === bestDist && d <= refDate)) {
      bestDist = dist
      bestDate = d
    }
  }
  if (bestDate) return byDate[bestDate]
  // 都不在 window 內，fallback 取 ≤ ref 最新（即使很舊）
  const olderDates = Object.keys(byDate).filter(d => d <= refDate).sort().reverse()
  return olderDates.length ? byDate[olderDates[0]] : 0
}

function latestInventoryBefore(inv: Row[], refDate: string, vendor: string, store: string): number {
  const filtered = inv.filter(r =>
    r.vendor === vendor &&
    (store === '__ALL__' || r.store === store)
  )
  if (!filtered.length) return 0
  if (store === '__ALL__') {
    const byStore: Record<string, Row[]> = {}
    filtered.forEach(r => { (byStore[r.store] ||= []).push(r) })
    let total = 0
    for (const rows of Object.values(byStore)) {
      total += pickNearestDateSum(rows, refDate)
    }
    return total
  }
  return pickNearestDateSum(filtered, refDate)
}

export default function FoodCostPage() {
  // 預設本週週一~週日
  const today = new Date()
  const defaultFrom = toISO(mondayOf(today))
  const defaultTo = toISO(addDays(mondayOf(today), 6))

  const [from, setFrom] = useState(defaultFrom)
  const [to, setTo] = useState(defaultTo)
  const [storeFilter, setStoreFilter] = useState<string>('__ALL__')
  const [data, setData] = useState<ApiResp | null>(null)
  const [salesRecords, setSalesRecords] = useState<Record<string, unknown>[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [salesLoading, setSalesLoading] = useState(true)
  const [error, setError] = useState('')
  const [showDaily, setShowDaily] = useState(false)
  const [excludeStaffMeal, setExcludeStaffMeal] = useState(true)
  const [onlyActive, setOnlyActive] = useState(true)

  // 只在首次掛載抓資料；後續切日期/分店在記憶體裡篩，不再打 API
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError('')
    fetch('/api/food-cost')
      .then(async res => {
        if (!res.ok) {
          const e = await res.json().catch(() => ({}))
          throw new Error(e.error || `HTTP ${res.status}`)
        }
        return res.json() as Promise<ApiResp>
      })
      .then(json => { if (!cancelled) setData(json) })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })

    // 營業額獨立抓，不卡進貨表渲染
    setSalesLoading(true)
    fetchAllRecords()
      .then(sales => { if (!cancelled) setSalesRecords(sales) })
      .catch(() => { if (!cancelled) setSalesRecords([]) })
      .finally(() => { if (!cancelled) setSalesLoading(false) })

    return () => { cancelled = true }
  }, [])

  // 營業額：客端篩日期+分店
  const revenue = useMemo(() => {
    if (!salesRecords) return 0
    const f = getFields()
    const dateField = f.date || '營業日期'
    const storeField = f.store || '分店簡稱'
    const revField = f.revenue || '當日營業額'
    let total = 0
    for (const r of salesRecords) {
      const rawD = String((r as Record<string, unknown>)[dateField] || '')
      const m = rawD.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/)
      if (!m) continue
      const iso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
      if (iso < from || iso > to) continue
      if (storeFilter !== '__ALL__') {
        const s = String((r as Record<string, unknown>)[storeField] || '')
        if (s !== storeFilter) continue
      }
      const n = parseFloat(String((r as Record<string, unknown>)[revField] || '0').replace(/,/g, ''))
      if (!isNaN(n)) total += n
    }
    return total
  }, [salesRecords, from, to, storeFilter])

  // 按 vendor 加總當週進貨；篩 store；可選排除員工餐專用單
  // 固定的廠商清單（依「歷史所有進貨總額」由大到小排序，跨週完全不變）
  const vendorsForStore = useMemo(() => {
    if (!data) return [] as string[]
    const allP = storeFilter === '__ALL__' ? data.purchases : data.purchases.filter(p => p.store === storeFilter)
    const allI = storeFilter === '__ALL__' ? data.inventory : data.inventory.filter(i => i.store === storeFilter)
    const lifetimeBuy: Record<string, number> = {}
    allP.forEach(p => { lifetimeBuy[p.vendor] = (lifetimeBuy[p.vendor] || 0) + p.amount })
    // 只有盤點沒進貨的廠商也要顯示，總額 0 排最後
    const allVendors = new Set([...allP.map(p => p.vendor), ...allI.map(i => i.vendor)].filter(Boolean))
    return Array.from(allVendors).sort((a, b) => {
      const diff = (lifetimeBuy[b] || 0) - (lifetimeBuy[a] || 0)
      return diff !== 0 ? diff : a.localeCompare(b)
    })
  }, [data, storeFilter])

  const tableRows = useMemo(() => {
    if (!data) return []
    const inRange = data.purchases.filter(p =>
      p.date >= from && p.date <= to &&
      (storeFilter === '__ALL__' || p.store === storeFilter) &&
      (!excludeStaffMeal || !p.isStaffOnly)
    )
    const invFiltered = storeFilter === '__ALL__'
      ? data.inventory
      : data.inventory.filter(p => p.store === storeFilter)
    const purFiltered = storeFilter === '__ALL__'
      ? data.purchases
      : data.purchases.filter(p => p.store === storeFilter)

    // 期初 ref = from（找最接近 from 的盤點）
    // 期末 ref = to（找最接近 to 的盤點，函數內部自動允許 ±3 天）

    // 「幽靈廠商」過濾：到參考日為止，距離最近一筆盤點或進貨超過 60 天 → 視為休眠
    const STALE_DAYS = 60
    const cutoff = toISO(addDays(new Date(to + 'T00:00:00'), -STALE_DAYS))
    const recentVendors = new Set<string>()
    invFiltered.forEach(r => { if (r.date >= cutoff && r.date <= to) recentVendors.add(r.vendor) })
    purFiltered.forEach(p => { if (p.date >= cutoff && p.date <= to) recentVendors.add(p.vendor) })

    // 順序直接照 vendorsForStore（已按歷史總進貨排好），不再二次排序
    const rows = vendorsForStore
      .filter(v => recentVendors.has(v))
      .map(vendor => {
        const begin = latestInventoryBefore(invFiltered, from, vendor, storeFilter)
        const purchases = inRange.filter(p => p.vendor === vendor).reduce((s, p) => s + p.amount, 0)
        const end = latestInventoryBefore(invFiltered, to, vendor, storeFilter)
        const usage = begin + purchases - end
        return { vendor, begin, purchases, end, usage }
      })

    // onlyActive=true：只藏「四欄全 0」（純粹這分店沒記錄）的廠商。
    // 有期初／期末庫存（即使沒進貨沒使用）也視為「有資料」要顯示，避免漏掉穩定庫存的廠商
    return onlyActive
      ? rows.filter(r => r.begin !== 0 || r.purchases !== 0 || r.end !== 0 || r.usage !== 0)
      : rows
  }, [data, from, to, storeFilter, excludeStaffMeal, vendorsForStore, onlyActive])

  const totals = useMemo(() => {
    return tableRows.reduce((acc, r) => ({
      begin: acc.begin + r.begin,
      purchases: acc.purchases + r.purchases,
      end: acc.end + r.end,
      usage: acc.usage + r.usage,
    }), { begin: 0, purchases: 0, end: 0, usage: 0 })
  }, [tableRows])

  // 每日進貨明細（按 vendor × 日）
  const dailyMatrix = useMemo(() => {
    if (!data) return { days: [] as string[], rows: [] as { vendor: string; perDay: Record<string, number>; total: number }[] }
    const days: string[] = []
    let cur = new Date(from + 'T00:00:00')
    const end = new Date(to + 'T00:00:00')
    while (cur <= end) {
      days.push(toISO(cur))
      cur = addDays(cur, 1)
    }
    const inRange = data.purchases.filter(p =>
      p.date >= from && p.date <= to &&
      (storeFilter === '__ALL__' || p.store === storeFilter) &&
      (!excludeStaffMeal || !p.isStaffOnly)
    )
    const vendorMap: Record<string, Record<string, number>> = {}
    inRange.forEach(p => {
      if (!vendorMap[p.vendor]) vendorMap[p.vendor] = {}
      vendorMap[p.vendor][p.date] = (vendorMap[p.vendor][p.date] || 0) + p.amount
    })
    const rows = Object.entries(vendorMap).map(([vendor, perDay]) => ({
      vendor, perDay,
      total: Object.values(perDay).reduce((s, v) => s + v, 0),
    })).sort((a, b) => b.total - a.total)
    return { days, rows }
  }, [data, from, to, storeFilter, excludeStaffMeal])

  // 員工餐金額（範圍 + 分店；用於 KPI 顯示）
  const staffMealAmount = useMemo(() => {
    if (!data) return 0
    return data.purchases
      .filter(p => p.date >= from && p.date <= to && (storeFilter === '__ALL__' || p.store === storeFilter))
      .reduce((s, p) => s + p.staffMeal, 0)
  }, [data, from, to, storeFilter])

  // 員工餐明細：每張包含員工餐的進貨單
  const staffMealRows = useMemo(() => {
    if (!data) return [] as { date: string; orderNo: string; vendor: string; staffMeal: number; total: number; isStaffOnly: boolean }[]
    return data.purchases
      .filter(p =>
        p.date >= from && p.date <= to &&
        (storeFilter === '__ALL__' || p.store === storeFilter) &&
        p.staffMeal > 0
      )
      .map(p => ({
        date: p.date, orderNo: p.orderNo, vendor: p.vendor,
        staffMeal: p.staffMeal, total: p.amount, isStaffOnly: p.isStaffOnly,
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.orderNo.localeCompare(b.orderNo))
  }, [data, from, to, storeFilter])
  const [showStaffMeal, setShowStaffMeal] = useState(false)

  const ratio = revenue > 0 ? (totals.usage / revenue) * 100 : 0

  const shiftWeek = (delta: number) => {
    // 不管目前是否為 partial range，按上/下一週都跳到完整週（週一到週日）
    const f = new Date(from + 'T00:00:00')
    const newMon = addDays(mondayOf(f), delta * 7)
    setFrom(toISO(newMon))
    setTo(toISO(addDays(newMon, 6)))
  }
  const setThisWeek = () => {
    const m = mondayOf(new Date())
    setFrom(toISO(m))
    setTo(toISO(addDays(m, 6)))
  }
  const setLastWeek = () => {
    const m = addDays(mondayOf(new Date()), -7)
    setFrom(toISO(m))
    setTo(toISO(addDays(m, 6)))
  }

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1a2f4e', marginBottom: 4 }}>食材成本</h1>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 18 }}>
        資料來源：Ragic 進貨單 + 盤點表｜<span style={{ fontWeight: 600 }}>本週使用量 = 期初存貨 + 本週進貨 - 期末盤點</span>
      </div>

      {/* 控制列 */}
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e8e6e1', padding: 12, marginBottom: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => shiftWeek(-1)} style={btnStyle()}>← 上一週</button>
        <button onClick={setThisWeek} style={btnStyle('primary')}>本週</button>
        <button onClick={setLastWeek} style={btnStyle()}>上週</button>
        <button onClick={() => shiftWeek(1)} style={btnStyle()}>下一週 →</button>
        <WeekPicker
          from={from}
          to={to}
          onChange={(f, t) => { setFrom(f); setTo(t) }}
        />
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, cursor: 'pointer', color: '#374151' }}>
          <input type="checkbox" checked={excludeStaffMeal} onChange={e => setExcludeStaffMeal(e.target.checked)} />
          排除員工餐專用單
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, cursor: 'pointer', color: '#374151' }}>
          <input type="checkbox" checked={onlyActive} onChange={e => setOnlyActive(e.target.checked)} />
          只顯示本週有活動的廠商
        </label>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#6b7280' }}>分店</span>
          <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)} style={selStyle}>
            <option value="__ALL__">全部分店</option>
            {data?.stores.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* KPI */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 14 }}>
        <KpiCard label="本週使用量" value={fmtMoney(totals.usage)} sub={fmtDateRange(from, to)} color={totals.usage < 0 ? '#dc2626' : undefined} />
        <KpiCard label="本週營業額" value={salesLoading ? '載入中...' : fmtMoney(revenue)} sub={storeFilter === '__ALL__' ? '全部分店' : storeFilter} />
        <KpiCard label="員工餐金額" value={fmtMoney(staffMealAmount)} sub={excludeStaffMeal ? '已排除員工餐專用單' : '已含員工餐'} color="#d97706" />
        <KpiCard
          label="食材成本率"
          value={revenue > 0 && totals.usage > 0 ? `${ratio.toFixed(2)}%` : '—'}
          sub="使用量 / 營業額"
          highlight={revenue > 0 && totals.usage > 0}
          color={
            revenue <= 0 || totals.usage <= 0 ? '#9ca3af' :
            ratio > 35 ? '#dc2626' :
            ratio > 30 ? '#d97706' : '#16a34a'
          }
        />
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#dc2626', padding: 12, borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading && !data ? (
        <div style={{ padding: 60, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
          <div style={{ fontSize: 18, marginBottom: 6 }}>📊 載入進貨單 + 盤點表中...</div>
          <div>首次載入需要從 Ragic 撈取資料（約 5-20 秒），請稍候</div>
        </div>
      ) : (
        <>
          {/* 主表 */}
          <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e8e6e1', overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0eee9', fontSize: 14, fontWeight: 600, color: '#1a2f4e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>廠商明細</span>
              <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 400 }}>{tableRows.length} 個廠商</span>
            </div>
            {tableRows.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>此區間沒有進貨或盤點紀錄</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#fafaf8' }}>
                    {['廠商', '期初存貨', '本週進貨', '期末盤點', '本週使用量', '占比', '佔營業額'].map((h, i) => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: i === 0 ? 'left' : 'right', color: '#6b7280', fontWeight: 600, borderBottom: '1.5px solid #e8e6e1', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map(r => {
                    const pct = totals.usage > 0 ? (r.usage / totals.usage) * 100 : 0
                    const revPct = revenue > 0 ? (r.usage / revenue) * 100 : 0
                    return (
                      <tr key={r.vendor} style={{ borderBottom: '1px solid #f0eee9' }}>
                        <td style={{ padding: '9px 14px', fontWeight: 500 }}>
                          {r.vendor}
                          {r.usage < 0 && (
                            <span title="使用量為負，通常代表期間內某次盤點漏盤（例：4/5 只盤了部分品項）。請確認 Ragic 盤點是否完整。"
                                  style={{ marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 20, background: '#fee2e2', color: '#dc2626', fontWeight: 600, cursor: 'help' }}>
                              ⚠ 漏盤
                            </span>
                          )}
                        </td>
                        <td style={tdNum(r.begin, '#6b7280')}>{r.begin ? fmtMoney(r.begin) : '—'}</td>
                        <td style={tdNum(r.purchases, BRAND, true)}>{r.purchases ? fmtMoney(r.purchases) : '—'}</td>
                        <td style={tdNum(r.end, '#6b7280')}>{r.end ? fmtMoney(r.end) : '—'}</td>
                        <td style={tdNum(r.usage, r.usage < 0 ? '#dc2626' : '#1a2f4e', true)}>{fmtMoney(r.usage)}</td>
                        <td style={{ ...tdNum(pct, '#9ca3af'), fontSize: 12 }}>{pct.toFixed(1)}%</td>
                        <td style={{ ...tdNum(revPct, revenue > 0 ? '#16a34a' : '#d1d5db'), fontSize: 12, fontWeight: 600 }}>
                          {revenue > 0 ? `${revPct.toFixed(2)}%` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#f7f1e9', fontWeight: 700 }}>
                    <td style={{ padding: '10px 14px' }}>合計</td>
                    <td style={tdNum(totals.begin, '#1a2f4e', true)}>{fmtMoney(totals.begin)}</td>
                    <td style={tdNum(totals.purchases, BRAND, true)}>{fmtMoney(totals.purchases)}</td>
                    <td style={tdNum(totals.end, '#1a2f4e', true)}>{fmtMoney(totals.end)}</td>
                    <td style={tdNum(totals.usage, '#1a2f4e', true)}>{fmtMoney(totals.usage)}</td>
                    <td style={tdNum(100, '#9ca3af')}>100%</td>
                    <td style={tdNum(ratio, revenue > 0 ? '#16a34a' : '#d1d5db', true)}>
                      {revenue > 0 ? `${ratio.toFixed(2)}%` : '—'}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

          {/* 每日明細 toggle */}
          <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e8e6e1', overflow: 'hidden' }}>
            <button
              onClick={() => setShowDaily(s => !s)}
              style={{ width: '100%', padding: '12px 16px', background: '#fff', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#1a2f4e', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>每日進貨明細</span>
              <span style={{ color: '#9ca3af', fontSize: 12 }}>{showDaily ? '收起 ▲' : '展開 ▼'}</span>
            </button>
            {showDaily && (
              <div style={{ borderTop: '1px solid #f0eee9', overflowX: 'auto' }}>
                {dailyMatrix.rows.length === 0 ? (
                  <div style={{ padding: 30, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>此區間沒有進貨紀錄</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: '#fafaf8' }}>
                        <th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280', fontWeight: 600, borderBottom: '1.5px solid #e8e6e1', position: 'sticky', left: 0, background: '#fafaf8' }}>廠商</th>
                        {dailyMatrix.days.map(d => {
                          const [, mm, dd] = d.split('-')
                          const dow = ['日', '一', '二', '三', '四', '五', '六'][new Date(d + 'T00:00:00').getDay()]
                          return (
                            <th key={d} style={{ padding: '8px 10px', textAlign: 'right', color: '#6b7280', fontWeight: 600, borderBottom: '1.5px solid #e8e6e1', whiteSpace: 'nowrap' }}>
                              {mm}/{dd}<br /><span style={{ fontSize: 10, color: '#9ca3af' }}>{dow}</span>
                            </th>
                          )
                        })}
                        <th style={{ padding: '8px 12px', textAlign: 'right', color: BRAND, fontWeight: 700, borderBottom: '1.5px solid #e8e6e1' }}>小計</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyMatrix.rows.map(r => (
                        <tr key={r.vendor} style={{ borderBottom: '1px solid #f0eee9' }}>
                          <td style={{ padding: '7px 12px', fontWeight: 500, position: 'sticky', left: 0, background: '#fff' }}>{r.vendor}</td>
                          {dailyMatrix.days.map(d => (
                            <td key={d} style={{ padding: '7px 10px', textAlign: 'right', color: r.perDay[d] ? '#1a2f4e' : '#d1d5db' }}>
                              {r.perDay[d] ? fmtMoney(r.perDay[d]) : '—'}
                            </td>
                          ))}
                          <td style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 700, color: BRAND }}>{fmtMoney(r.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>

          {/* 員工餐明細 toggle */}
          <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e8e6e1', overflow: 'hidden', marginTop: 14 }}>
            <button
              onClick={() => setShowStaffMeal(s => !s)}
              style={{ width: '100%', padding: '12px 16px', background: '#fff', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#1a2f4e', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>員工餐明細 <span style={{ color: '#d97706', fontSize: 12, marginLeft: 6 }}>共 {staffMealRows.length} 張單 · ${fmtMoney(staffMealAmount)}</span></span>
              <span style={{ color: '#9ca3af', fontSize: 12 }}>{showStaffMeal ? '收起 ▲' : '展開 ▼'}</span>
            </button>
            {showStaffMeal && (
              <div style={{ borderTop: '1px solid #f0eee9', overflowX: 'auto' }}>
                {staffMealRows.length === 0 ? (
                  <div style={{ padding: 30, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>此區間沒有員工餐進貨</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#fafaf8' }}>
                        {['日期', '進貨單號', '廠商', '類型', '員工餐金額', '整單金額'].map((h, i) => (
                          <th key={h} style={{ padding: '9px 12px', textAlign: i >= 4 ? 'right' : 'left', color: '#6b7280', fontWeight: 600, borderBottom: '1.5px solid #e8e6e1', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {staffMealRows.map((r, i) => (
                        <tr key={`${r.orderNo}-${i}`} style={{ borderBottom: '1px solid #f0eee9' }}>
                          <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: '#374151' }}>{r.date}</td>
                          <td style={{ padding: '8px 12px', fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#6b7280' }}>{r.orderNo}</td>
                          <td style={{ padding: '8px 12px' }}>{r.vendor}</td>
                          <td style={{ padding: '8px 12px' }}>
                            {r.isStaffOnly ? (
                              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#fef3c7', color: '#d97706', fontWeight: 600 }}>整單員工餐</span>
                            ) : (
                              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#dbeafe', color: '#2563eb', fontWeight: 600 }}>混合單</span>
                            )}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: '#d97706' }}>{fmtMoney(r.staffMeal)}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', color: '#6b7280' }}>{fmtMoney(r.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: '#fef3c7', fontWeight: 700 }}>
                        <td style={{ padding: '10px 12px' }} colSpan={4}>合計</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', color: '#d97706' }}>{fmtMoney(staffMealAmount)}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', color: '#6b7280' }}>{fmtMoney(staffMealRows.reduce((s, r) => s + r.total, 0))}</td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function KpiCard({ label, value, sub, highlight, color }: { label: string; value: string; sub: string; highlight?: boolean; color?: string }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e8e6e1', padding: 18 }}>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: color || (highlight ? BRAND : '#1a2f4e'), marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 11, color: '#9ca3af' }}>{sub}</div>
    </div>
  )
}

function btnStyle(variant: 'default' | 'primary' = 'default'): React.CSSProperties {
  if (variant === 'primary') {
    return { padding: '6px 14px', borderRadius: 7, border: `1px solid ${BRAND}`, background: BRAND, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }
  }
  return { padding: '6px 14px', borderRadius: 7, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', fontSize: 12, cursor: 'pointer' }
}
const dateStyle: React.CSSProperties = { padding: '5px 10px', borderRadius: 7, border: '1px solid #e5e7eb', fontSize: 12 }
const selStyle: React.CSSProperties = { padding: '5px 10px', borderRadius: 7, border: '1px solid #e5e7eb', fontSize: 12, background: '#fff' }

function tdNum(_n: number, color: string, bold = false): React.CSSProperties {
  return { padding: '9px 14px', textAlign: 'right', color, fontWeight: bold ? 600 : 400, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
}

// 週/自訂 雙模式日期選擇器（週一開頭）
function WeekPicker({ from, to, onChange }: { from: string; to: string; onChange: (f: string, t: string) => void }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'week' | 'range'>('week')
  const [pending, setPending] = useState<string | null>(null) // 自訂模式：第一次點的日期
  const [view, setView] = useState(() => {
    const d = new Date(from + 'T00:00:00')
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false); setPending(null)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const monday = (d: Date) => {
    const x = new Date(d); x.setHours(0,0,0,0)
    const day = x.getDay()
    x.setDate(x.getDate() + (day === 0 ? -6 : 1 - day))
    return x
  }
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`

  const grid = useMemo(() => {
    const firstOfMonth = new Date(view.getFullYear(), view.getMonth(), 1)
    const start = monday(firstOfMonth)
    const cells: Date[] = []
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i)
      cells.push(d)
    }
    return cells
  }, [view])

  const fromD = new Date(from + 'T00:00:00')
  const toD = new Date(to + 'T00:00:00')
  const inSelectedRange = (d: Date) => d >= fromD && d <= toD
  const isPending = (d: Date) => pending !== null && iso(d) === pending
  const isToday = (d: Date) => {
    const t = new Date(); t.setHours(0,0,0,0)
    return d.getTime() === t.getTime()
  }

  const handlePick = (d: Date) => {
    if (mode === 'week') {
      const m = monday(d)
      const sun = new Date(m); sun.setDate(m.getDate() + 6)
      onChange(iso(m), iso(sun))
      setOpen(false)
      setPending(null)
    } else {
      // 自訂模式：第一次點 → 紀錄為 pending；第二次點 → 完成區間
      if (pending === null) {
        setPending(iso(d))
      } else {
        const a = new Date(pending + 'T00:00:00')
        const lo = a < d ? a : d
        const hi = a < d ? d : a
        onChange(iso(lo), iso(hi))
        setOpen(false)
        setPending(null)
      }
    }
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '5px 0', fontSize: 11, fontWeight: 600,
    background: active ? BRAND : '#fff',
    color: active ? '#fff' : '#6b7280',
    border: '1px solid ' + (active ? BRAND : '#e5e7eb'),
    cursor: 'pointer',
  })

  return (
    <div style={{ position: 'relative', marginLeft: 4 }} ref={popRef}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          padding: '6px 12px', borderRadius: 7, border: '1px solid #e5e7eb',
          background: '#fff', fontSize: 12, cursor: 'pointer', color: '#374151',
          display: 'flex', alignItems: 'center', gap: 6,
        }}
      >
        📅 <span style={{ fontFamily: 'ui-monospace, monospace' }}>{from} ~ {to}</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 100,
          background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb',
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 14, width: 290,
        }}>
          {/* 模式切換 */}
          <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', marginBottom: 10 }}>
            <button type="button" onClick={() => { setMode('week'); setPending(null) }}
              style={{ ...tabStyle(mode === 'week'), borderTopLeftRadius: 6, borderBottomLeftRadius: 6, borderRight: 'none' }}>
              週
            </button>
            <button type="button" onClick={() => { setMode('range'); setPending(null) }}
              style={{ ...tabStyle(mode === 'range'), borderTopRightRadius: 6, borderBottomRightRadius: 6 }}>
              自訂區間
            </button>
          </div>

          {/* 月份切換 */}
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <button onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
              style={{ border: 'none', background: 'transparent', fontSize: 16, cursor: 'pointer', padding: '4px 8px' }}>‹</button>
            <span style={{ flex: 1, textAlign: 'center', fontWeight: 700, color: BRAND }}>
              {view.getFullYear()} 年 {view.getMonth() + 1} 月
            </span>
            <button onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
              style={{ border: 'none', background: 'transparent', fontSize: 16, cursor: 'pointer', padding: '4px 8px' }}>›</button>
          </div>

          {/* 週標題（週一開頭） */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
            {['一','二','三','四','五','六','日'].map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: 11, color: '#9ca3af', padding: '4px 0', fontWeight: 600 }}>{d}</div>
            ))}
          </div>

          {/* 日期 grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {grid.map((d, i) => {
              const sameMonth = d.getMonth() === view.getMonth()
              const sel = mode === 'week' ? inSelectedRange(d) : inSelectedRange(d)
              const isP = isPending(d)
              const today = isToday(d)
              return (
                <button key={i} onClick={() => handlePick(d)}
                  style={{
                    aspectRatio: '1', border: today ? `1.5px solid ${BRAND}` : '1px solid transparent',
                    borderRadius: 6, cursor: 'pointer', fontSize: 12,
                    background: isP ? '#fef3c7' : sel ? BRAND : 'transparent',
                    color: isP ? '#d97706' : sel ? '#fff' : sameMonth ? '#374151' : '#d1d5db',
                    fontWeight: (sel || isP) ? 700 : 400,
                  }}
                  onMouseEnter={e => { if (!sel && !isP) e.currentTarget.style.background = '#f3f0ea' }}
                  onMouseLeave={e => { if (!sel && !isP) e.currentTarget.style.background = 'transparent' }}
                >
                  {d.getDate()}
                </button>
              )
            })}
          </div>

          <div style={{ marginTop: 10, fontSize: 11, color: '#9ca3af', textAlign: 'center' }}>
            {mode === 'week'
              ? '點任何一天 → 自動選整週（週一-週日）'
              : pending === null
                ? '點第一天 = 起日'
                : `已選起日 ${pending}，再點一天 = 迄日`}
          </div>
        </div>
      )}
    </div>
  )
}
