'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { toISO, fmt } from '@/lib/ragic/utils'
import { processRecords, filterByStoreType, StoreRecord } from '@/lib/ragic/processRecords'
import { fetchAllRecords, getFields } from '@/lib/ragic/fetchRecords'

const BRAND = '#3c2929'
const COLORS = [BRAND, '#5c7a6e', '#8B6914', '#1e4d8c', '#6b4c8a', '#1a6b4a', '#7a3a1e', '#2d5a6b']

type StoreFilter = 'all' | 'direct' | 'franchise'
type SessionFilter = 'all' | 'noon' | 'evening'
type RangeKey = 'thisweek' | 'lastweek' | 'thismonth' | 'lastmonth' | 'custom'

function getRange(key: RangeKey) {
  const t = new Date(); const dow = t.getDay()
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
    <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 20, background: up ? '#dcfce7' : '#fee2e2', color: up ? '#166534' : '#991b1b', marginLeft: 4 }}>
      {up ? '▲' : '▼'} {Math.abs(Number(pct))}%
    </span>
  )
}

function statusBadge(curr: number, prev: number) {
  if (!prev) return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#f3f4f6', color: '#6b7280' }}>無對比</span>
  const pct = (curr - prev) / prev * 100
  if (pct >= 5) return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#dcfce7', color: '#166534' }}>↑ 成長</span>
  if (pct <= -5) return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#fee2e2', color: '#991b1b' }}>↓ 衰退</span>
  return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#fef3c7', color: '#92400e' }}>→ 持平</span>
}

export default function StoresPage() {
  const initial = getRange('thismonth')
  const [dateFrom, setDateFrom] = useState(initial.from)
  const [dateTo, setDateTo] = useState(initial.to)
  const [activeRange, setActiveRange] = useState<RangeKey>('thismonth')
  const [storeFilter, setStoreFilter] = useState<StoreFilter>('all')
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [byStore, setByStore] = useState<Record<string, StoreRecord>>({})
  const [prevByStore, setPrevByStore] = useState<Record<string, StoreRecord>>({})
  const mounted = useRef(false)

  const fetchData = useCallback(async (fromOverride?: string, toOverride?: string) => {
    const f = fromOverride ?? dateFrom
    const t = toOverride ?? dateTo
    if (!f || !t) return
    setLoading(true); setError('')
    try {
      const all = await fetchAllRecords()
      const fields = getFields()
      const dateField = fields.date || '營業日期'
      const inRange = all.filter(r => {
        const d = String(r[dateField] || '').replace(/\//g, '-').slice(0, 10)
        return d >= f && d <= t
      })
      const from = new Date(f), to = new Date(t)
      const diff = to.getTime() - from.getTime()
      const prevTo = new Date(from.getTime() - 86400000)
      const prevFrom = new Date(prevTo.getTime() - diff)
      const prevFromStr = toISO(prevFrom), prevToStr = toISO(prevTo)
      const prevRange = all.filter(r => {
        const d = String(r[dateField] || '').replace(/\//g, '-').slice(0, 10)
        return d >= prevFromStr && d <= prevToStr
      })
      setByStore(processRecords(inRange, fields, sessionFilter).byStore)
      setPrevByStore(processRecords(prevRange, fields, sessionFilter).byStore)
    } catch (e: unknown) { setError(e instanceof Error ? e.message : '載入失敗') }
    setLoading(false)
  }, [dateFrom, dateTo, sessionFilter])

  useEffect(() => {
    if (!mounted.current) { mounted.current = true; fetchData() }
  }, [fetchData])

  const applyRange = useCallback((key: RangeKey) => {
    if (key === 'custom') { setActiveRange(key); return }
    const r = getRange(key); setDateFrom(r.from); setDateTo(r.to); setActiveRange(key)
    fetchData(r.from, r.to)
  }, [fetchData])

  const filtered = filterByStoreType(byStore, storeFilter)
  const prevFiltered = filterByStoreType(prevByStore, storeFilter)
  const stores = Object.entries(filtered).sort((a, b) => b[1].rev - a[1].rev)
  const maxRev = stores.length ? stores[0][1].rev : 1
  const hasData = stores.length > 0

  const btnStyle = (active: boolean) => ({
    padding: '5px 14px', borderRadius: 20, border: '1.5px solid',
    borderColor: active ? BRAND : '#e5e7eb',
    background: active ? BRAND : '#fff',
    color: active ? '#fff' : '#374151',
    fontSize: 12, fontWeight: 600, cursor: 'pointer',
  } as React.CSSProperties)

  return (
    <div style={{ padding: 24, maxWidth: 1400 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1a2f4e', marginBottom: 12 }}>分店比較</h1>

      {/* 篩選列 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20 }}>
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
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }} />
            <span style={{ color: '#9ca3af' }}>—</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }} />
          </>
        )}
        <button onClick={() => fetchData()} disabled={loading} style={{ padding: '7px 20px', borderRadius: 8, border: 'none', background: loading ? '#9ca3af' : BRAND, color: '#fff', fontSize: 13, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer' }}>
          {loading ? '載入中...' : '載入報表'}
        </button>
      </div>

      {error && <div style={{ background: '#fee2e2', color: '#991b1b', padding: '10px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{error}</div>}

      {!hasData && !loading && (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🏪</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>尚無資料</div>
          <div style={{ fontSize: 13 }}>選擇日期區間後點擊「載入報表」</div>
        </div>
      )}

      {hasData && (
        <>
          {/* 排行榜 */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e6e1', marginBottom: 16 }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #e8e6e1', fontWeight: 600, color: '#1a2f4e', fontSize: 14 }}>
              分店營業額排行
            </div>
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {stores.map(([, s], i) => {
                const prev = prevFiltered[Object.keys(byStore).find(k => byStore[k] === s) || '']
                const pct = maxRev > 0 ? (s.rev / maxRev * 100) : 0
                const prevPct = prev && maxRev > 0 ? (prev.rev / maxRev * 100) : 0
                return (
                  <div key={s.displayName}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
                      <span style={{ fontWeight: 600 }}>{i + 1}. {s.displayName}</span>
                      <span>${fmt(s.rev)} {prev ? diffBadge(s.rev, prev.rev) : null}</span>
                    </div>
                    <div style={{ position: 'relative', height: 22, background: '#f3f4f6', borderRadius: 4, overflow: 'hidden' }}>
                      {prev && <div style={{ position: 'absolute', height: '100%', width: `${prevPct.toFixed(1)}%`, background: '#d4b8b8', borderRadius: 4 }} />}
                      <div style={{ position: 'absolute', height: '100%', width: `${pct.toFixed(1)}%`, background: COLORS[i % COLORS.length], borderRadius: 4 }} />
                    </div>
                  </div>
                )
              })}
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>深色＝本期　淡色＝上一期</div>
            </div>
          </div>

          {/* 詳細比較表 */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e6e1', overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #e8e6e1', fontWeight: 600, color: '#1a2f4e', fontSize: 14 }}>
              詳細數據比較
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#fafaf8' }}>
                    {['分店', '類型', '總營業額', '上期', '用餐人數', '用餐組數', 'No Show', 'No Show率', '客單價', '狀態'].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: h === '分店' ? 'left' : 'right', color: '#6b7280', fontWeight: 600, borderBottom: '1.5px solid #e8e6e1', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stores.map(([name, s]) => {
                    const prev = prevFiltered[name]
                    const avg = s.avgPays.length ? s.avgPays.reduce((a, b) => a + b, 0) / s.avgPays.length : 0
                    const nr = s.groups > 0 ? (s.noshow / s.groups * 100).toFixed(1) : '0.0'
                    const typeBadge = s.type === 'franchise'
                      ? <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#ede9fe', color: '#5b21b6' }}>加盟</span>
                      : <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#f5efef', color: BRAND }}>直營</span>
                    return (
                      <tr key={name} style={{ borderBottom: '1px solid #f0eee9' }}>
                        <td style={{ padding: '10px 14px', fontWeight: 600 }}>{s.displayName}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right' }}>{typeBadge}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>${fmt(s.rev)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', color: '#9ca3af' }}>{prev ? `$${fmt(prev.rev)}` : '–'}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right' }}>{fmt(s.guests)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right' }}>{fmt(s.groups)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right' }}>{fmt(s.noshow)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right' }}>{nr}%</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right' }}>${fmt(avg)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right' }}>{prev ? statusBadge(s.rev, prev.rev) : statusBadge(0, 0)}</td>
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
