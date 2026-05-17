'use client'

import { useState, useEffect, useMemo } from 'react'
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

// 對 (vendor, store) 找 ≤ refDate 的盤點金額：
// 取「最近一天」的所有 record 加總（同日多筆 = 不同倉位/分批盤，全部 sum）。
// 不做歷史 carry-forward — 如果某天漏盤、使用量會變負，UI 端會打警告但忠實顯示 Ragic 資料。
function latestInventoryBefore(inv: Row[], refDate: string, vendor: string, store: string): number {
  const filtered = inv.filter(r =>
    r.vendor === vendor &&
    (store === '__ALL__' || r.store === store) &&
    r.date <= refDate
  )
  if (!filtered.length) return 0
  if (store === '__ALL__') {
    const byStore: Record<string, Row[]> = {}
    filtered.forEach(r => { (byStore[r.store] ||= []).push(r) })
    let total = 0
    for (const rows of Object.values(byStore)) {
      rows.sort((a, b) => b.date.localeCompare(a.date))
      const latestDate = rows[0].date
      total += rows.filter(r => r.date === latestDate).reduce((s, r) => s + r.amount, 0)
    }
    return total
  }
  filtered.sort((a, b) => b.date.localeCompare(a.date))
  const latestDate = filtered[0].date
  return filtered.filter(r => r.date === latestDate).reduce((s, r) => s + r.amount, 0)
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

    const prevDay = addDays(new Date(from + 'T00:00:00'), -1)
    const prevDayISO = toISO(prevDay)

    // 所有出現過的 vendor（在範圍內進貨或盤點的）
    const vendors = new Set<string>()
    inRange.forEach(p => vendors.add(p.vendor))
    invFiltered.filter(r => r.date <= to).forEach(r => vendors.add(r.vendor))

    const rows = Array.from(vendors).map(vendor => {
      const begin = latestInventoryBefore(invFiltered, prevDayISO, vendor, storeFilter)
      const purchases = inRange.filter(p => p.vendor === vendor).reduce((s, p) => s + p.amount, 0)
      const end = latestInventoryBefore(invFiltered, to, vendor, storeFilter)
      // 期末若就是期初（範圍內無新盤點）→ 視為 0 使用量也不可靠，但仍計算
      const usage = begin + purchases - end
      return { vendor, begin, purchases, end, usage }
    }).filter(r => r.begin || r.purchases || r.end || r.usage)
      .sort((a, b) => b.usage - a.usage)

    return rows
  }, [data, from, to, storeFilter, excludeStaffMeal])

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

  const ratio = revenue > 0 ? (totals.usage / revenue) * 100 : 0

  const shiftWeek = (delta: number) => {
    const f = new Date(from + 'T00:00:00')
    setFrom(toISO(addDays(f, delta * 7)))
    setTo(toISO(addDays(new Date(to + 'T00:00:00'), delta * 7)))
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
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 8 }}>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={dateStyle} />
          <span style={{ color: '#9ca3af' }}>~</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={dateStyle} />
        </div>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, cursor: 'pointer', color: '#374151' }}>
          <input type="checkbox" checked={excludeStaffMeal} onChange={e => setExcludeStaffMeal(e.target.checked)} />
          排除員工餐專用單
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
                    {['廠商', '期初存貨', '本週進貨', '期末盤點', '本週使用量', '占比'].map((h, i) => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: i === 0 ? 'left' : 'right', color: '#6b7280', fontWeight: 600, borderBottom: '1.5px solid #e8e6e1', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map(r => {
                    const pct = totals.usage > 0 ? (r.usage / totals.usage) * 100 : 0
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
