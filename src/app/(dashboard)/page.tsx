'use client'

import { useState, useCallback } from 'react'
import { toISO, fmt, isHoliday } from '@/lib/ragic/utils'
import { processRecords, filterByStoreType, StoreRecord } from '@/lib/ragic/processRecords'

const BRAND = '#3c2929'
const DEFAULT_FIELDS: Record<string, string> = {
  date: '營業日期', store: '分店簡稱', revenue: '當日營業額',
  guests: '用餐人數', groups: '用餐組數', noshow: 'No Show組數',
  avgPay: '客單價', supervisor: '值班人員',
  complaint: '當日客訴與事件處理', share: '當日其他事件分享',
}

type StoreFilter = 'all' | 'direct' | 'franchise'
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
    <span style={{
      fontSize: 11, padding: '2px 6px', borderRadius: 20,
      background: up ? '#dcfce7' : '#fee2e2',
      color: up ? '#166534' : '#991b1b',
      marginLeft: 6,
    }}>
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [byStore, setByStore] = useState<Record<string, StoreRecord>>({})
  const [byDate, setByDate] = useState<Record<string, number>>({})
  const [prevByStore, setPrevByStore] = useState<Record<string, StoreRecord>>({})

  const applyRange = useCallback((key: RangeKey) => {
    if (key === 'custom') { setActiveRange(key); return }
    const r = getRange(key)
    setDateFrom(r.from)
    setDateTo(r.to)
    setActiveRange(key)
  }, [])

  const fetchData = useCallback(async () => {
    if (!dateFrom || !dateTo) return
    setLoading(true)
    setError('')
    try {
      const settings = JSON.parse(localStorage.getItem('ragic_settings') || '{}')
      const fields = { ...DEFAULT_FIELDS, ...JSON.parse(localStorage.getItem('ragic_fields') || '{}') }

      const params = new URLSearchParams({ limit: '3000' })
      if (settings.token) params.set('token', settings.token)
      if (settings.path) params.set('path', settings.path)

      const res = await fetch(`/api/ragic?${params}`)
      const raw = await res.json()

      const allRecords = Object.values(raw).filter((r): r is Record<string, unknown> =>
        typeof r === 'object' && r !== null && !Array.isArray(r)
      )

      // 過濾日期
      const dateField = fields.date || '營業日期'
      const inRange = allRecords.filter(r => {
        const d = String(r[dateField] || '')
        const iso = d.replace(/\//g, '-').slice(0, 10)
        return iso >= dateFrom && iso <= dateTo
      })

      // 上期
      const from = new Date(dateFrom), to = new Date(dateTo)
      const diff = to.getTime() - from.getTime()
      const prevTo = new Date(from.getTime() - 86400000)
      const prevFrom = new Date(prevTo.getTime() - diff)
      const prevFromStr = toISO(prevFrom), prevToStr = toISO(prevTo)

      const prevRange = allRecords.filter(r => {
        const d = String(r[dateField] || '')
        const iso = d.replace(/\//g, '-').slice(0, 10)
        return iso >= prevFromStr && iso <= prevToStr
      })

      const processed = processRecords(inRange, fields)
      const prevProcessed = processRecords(prevRange, fields)

      setByStore(processed.byStore)
      setByDate(processed.byDate)
      setPrevByStore(prevProcessed.byStore)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '載入失敗')
    }
    setLoading(false)
  }, [dateFrom, dateTo])

  const filtered = filterByStoreType(byStore, storeFilter)
  const prevFiltered = filterByStoreType(prevByStore, storeFilter)

  const totalRev = Object.values(filtered).reduce((s, v) => s + v.rev, 0)
  const prevTotalRev = Object.values(prevFiltered).reduce((s, v) => s + v.rev, 0)
  const totalGuests = Object.values(filtered).reduce((s, v) => s + v.guests, 0)
  const prevTotalGuests = Object.values(prevFiltered).reduce((s, v) => s + v.guests, 0)
  const totalGroups = Object.values(filtered).reduce((s, v) => s + v.groups, 0)
  const prevTotalGroups = Object.values(prevFiltered).reduce((s, v) => s + v.groups, 0)
  const allAvgPays = Object.values(filtered).flatMap(v => v.avgPays)
  const avgPay = allAvgPays.length ? allAvgPays.reduce((s, v) => s + v, 0) / allAvgPays.length : 0
  const prevAvgPays = Object.values(prevFiltered).flatMap(v => v.avgPays)
  const prevAvgPay = prevAvgPays.length ? prevAvgPays.reduce((s, v) => s + v, 0) / prevAvgPays.length : 0

  const hasData = Object.keys(filtered).length > 0

  return (
    <div style={{ padding: 24, maxWidth: 1400 }}>
      {/* Topbar */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1a2f4e', marginBottom: 12 }}>總覽</h1>

        {/* 篩選 */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {(['all', 'direct', 'franchise'] as StoreFilter[]).map(f => (
            <button key={f} onClick={() => setStoreFilter(f)} style={{
              padding: '5px 14px', borderRadius: 20, border: '1.5px solid',
              borderColor: storeFilter === f ? BRAND : '#e5e7eb',
              background: storeFilter === f ? BRAND : '#fff',
              color: storeFilter === f ? '#fff' : '#374151',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>
              {f === 'all' ? '全部' : f === 'direct' ? '直營' : '加盟'}
            </button>
          ))}

          <div style={{ width: 1, height: 20, background: '#e5e7eb', margin: '0 4px' }} />

          {(['thisweek', 'lastweek', 'thismonth', 'lastmonth', 'custom'] as RangeKey[]).map(r => (
            <button key={r} onClick={() => applyRange(r)} style={{
              padding: '5px 14px', borderRadius: 20, border: '1.5px solid',
              borderColor: activeRange === r ? BRAND : '#e5e7eb',
              background: activeRange === r ? BRAND : '#fff',
              color: activeRange === r ? '#fff' : '#374151',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>
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

          <button onClick={fetchData} disabled={loading} style={{
            padding: '7px 20px', borderRadius: 8, border: 'none',
            background: loading ? '#9ca3af' : BRAND,
            color: '#fff', fontSize: 13, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
          }}>
            {loading ? '載入中...' : '載入報表'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '10px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
          {error}
        </div>
      )}

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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
            {[
              { label: '總營業額', value: `$${fmt(totalRev)}`, prev: prevTotalRev, curr: totalRev },
              { label: '用餐人數', value: `${fmt(totalGuests)} 人`, prev: prevTotalGuests, curr: totalGuests },
              { label: '用餐組數', value: `${fmt(totalGroups)} 組`, prev: prevTotalGroups, curr: totalGroups },
              { label: '平均客單價', value: `$${fmt(avgPay)}`, prev: prevAvgPay, curr: avgPay },
            ].map(kpi => (
              <div key={kpi.label} style={{
                background: '#fff', borderRadius: 12, padding: '16px 20px',
                border: '1px solid #e8e6e1',
              }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>{kpi.label}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#1a2f4e', display: 'flex', alignItems: 'center' }}>
                  {kpi.value}
                  {diffBadge(kpi.curr, kpi.prev)}
                </div>
              </div>
            ))}
          </div>

          {/* 各分店概覽 */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e6e1', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #e8e6e1', fontWeight: 600, color: '#1a2f4e' }}>
              各分店概覽
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#fafaf8' }}>
                    {['分店', '營業額', '環比', '用餐人數', '用餐組數', 'No Show', '客單價'].map(h => (
                      <th key={h} style={{ padding: '10px 16px', textAlign: h === '分店' ? 'left' : 'right', color: '#6b7280', fontWeight: 600, borderBottom: '1.5px solid #e8e6e1', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(filtered).sort((a, b) => b[1].rev - a[1].rev).map(([name, s]) => {
                    const prev = prevFiltered[name]
                    const storeAvg = s.avgPays.length ? s.avgPays.reduce((a, b) => a + b, 0) / s.avgPays.length : 0
                    return (
                      <tr key={name} style={{ borderBottom: '1px solid #f0eee9' }}>
                        <td style={{ padding: '10px 16px', fontWeight: 600 }}>{s.displayName}</td>
                        <td style={{ padding: '10px 16px', textAlign: 'right' }}>${fmt(s.rev)}</td>
                        <td style={{ padding: '10px 16px', textAlign: 'right' }}>{prev ? diffBadge(s.rev, prev.rev) : '–'}</td>
                        <td style={{ padding: '10px 16px', textAlign: 'right' }}>{fmt(s.guests)}</td>
                        <td style={{ padding: '10px 16px', textAlign: 'right' }}>{fmt(s.groups)}</td>
                        <td style={{ padding: '10px 16px', textAlign: 'right' }}>{fmt(s.noshow)}</td>
                        <td style={{ padding: '10px 16px', textAlign: 'right' }}>${fmt(storeAvg)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 每日趨勢 */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e6e1', padding: '16px 20px', marginTop: 12 }}>
            <div style={{ fontWeight: 600, color: '#1a2f4e', marginBottom: 12 }}>每日趨勢</div>
            <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 80 }}>
              {Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).map(([date, rev]) => {
                const maxRev = Math.max(...Object.values(byDate))
                const h = maxRev > 0 ? (rev / maxRev) * 70 : 0
                const holiday = isHoliday(date)
                return (
                  <div key={date} title={`${date}: $${fmt(rev)}`} style={{
                    flex: 1, height: `${h}px`, minHeight: 4,
                    background: holiday ? '#8B6914' : BRAND,
                    borderRadius: '3px 3px 0 0', cursor: 'pointer',
                    opacity: 0.85,
                  }} />
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
