'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { fmt } from '@/lib/ragic/utils'
import { fetchAllRecords, getFields } from '@/lib/ragic/fetchRecords'
import { processRecords, filterByStoreType } from '@/lib/ragic/processRecords'

const BRAND = '#3c2929'
type StoreFilter = 'all' | 'direct' | 'franchise'

function diffBadge(curr: number, prev: number) {
  if (!prev) return null
  const pct = ((curr - prev) / prev * 100).toFixed(1)
  const up = curr >= prev
  return <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 20, background: up ? '#dcfce7' : '#fee2e2', color: up ? '#166534' : '#991b1b', marginLeft: 4 }}>{up ? '▲' : '▼'} {Math.abs(Number(pct))}%</span>
}

function statusBadge(curr: number, prev: number) {
  if (!prev) return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#f3f4f6', color: '#6b7280' }}>–</span>
  const p = (curr - prev) / prev * 100
  if (p >= 5) return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#dcfce7', color: '#166534' }}>成長</span>
  if (p <= -5) return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#fee2e2', color: '#991b1b' }}>衰退</span>
  return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#fef3c7', color: '#92400e' }}>持平</span>
}

function HBar({ curr, prev, maxVal, colorCurr, colorPrev }: { curr: number; prev: number; maxVal: number; colorCurr: string; colorPrev: string }) {
  const pCurr = maxVal > 0 ? curr / maxVal * 100 : 0
  const pPrev = maxVal > 0 ? prev / maxVal * 100 : 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ position: 'relative', height: 18, background: '#f3f4f6', borderRadius: 3 }}>
        <div style={{ position: 'absolute', height: '100%', width: `${pCurr.toFixed(1)}%`, background: colorCurr, borderRadius: 3 }} />
      </div>
      <div style={{ position: 'relative', height: 18, background: '#f3f4f6', borderRadius: 3 }}>
        <div style={{ position: 'absolute', height: '100%', width: `${pPrev.toFixed(1)}%`, background: colorPrev, borderRadius: 3 }} />
      </div>
    </div>
  )
}

export default function YoyPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [storeFilter, setStoreFilter] = useState<StoreFilter>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [currByStore, setCurrByStore] = useState<ReturnType<typeof processRecords>['byStore']>({})
  const [prevByStore, setPrevByStore] = useState<ReturnType<typeof processRecords>['byStore']>({})
  const [displayYear, setDisplayYear] = useState(0)
  const mounted = useRef(false)

  const fetchData = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const all = await fetchAllRecords()
      const fields = getFields()
      const pad = (n: number) => String(n).padStart(2, '0')
      const lastDay = new Date(year, month, 0).getDate()
      const currFrom = `${year}-${pad(month)}-01`, currTo = `${year}-${pad(month)}-${pad(lastDay)}`
      const prevLastDay = new Date(year - 1, month, 0).getDate()
      const prevFrom = `${year - 1}-${pad(month)}-01`, prevTo = `${year - 1}-${pad(month)}-${pad(prevLastDay)}`
      const dateField = fields.date || '營業日期'
      const inCurr = all.filter(r => { const d = String(r[dateField] || '').replace(/\//g, '-').slice(0, 10); return d >= currFrom && d <= currTo })
      const inPrev = all.filter(r => { const d = String(r[dateField] || '').replace(/\//g, '-').slice(0, 10); return d >= prevFrom && d <= prevTo })
      setCurrByStore(processRecords(inCurr, fields).byStore)
      setPrevByStore(processRecords(inPrev, fields).byStore)
      setDisplayYear(year)
    } catch (e: unknown) { setError(e instanceof Error ? e.message : '載入失敗') }
    setLoading(false)
  }, [year, month])

  useEffect(() => {
    if (!mounted.current) { mounted.current = true; fetchData() }
  }, [fetchData])

  const curr = filterByStoreType(currByStore, storeFilter)
  const prev = filterByStoreType(prevByStore, storeFilter)
  const allStores = Array.from(new Set([...Object.keys(curr), ...Object.keys(prev)])).sort()
  const hasData = allStores.length > 0

  const cRev = Object.values(curr).reduce((s, v) => s + v.rev, 0)
  const pRev = Object.values(prev).reduce((s, v) => s + v.rev, 0)
  const cGuests = Object.values(curr).reduce((s, v) => s + v.guests, 0)
  const pGuests = Object.values(prev).reduce((s, v) => s + v.guests, 0)
  const cAps = Object.values(curr).flatMap(v => v.avgPays)
  const pAps = Object.values(prev).flatMap(v => v.avgPays)
  const cAvg = cAps.length ? cAps.reduce((a, b) => a + b, 0) / cAps.length : 0
  const pAvg = pAps.length ? pAps.reduce((a, b) => a + b, 0) / pAps.length : 0
  const maxRev = Math.max(...allStores.map(s => Math.max(curr[s]?.rev || 0, prev[s]?.rev || 0)), 1)
  const getAvg = (aps: number[]) => aps.length ? aps.reduce((a, b) => a + b, 0) / aps.length : 0
  const maxAvg = Math.max(...allStores.map(s => Math.max(getAvg(curr[s]?.avgPays || []), getAvg(prev[s]?.avgPays || []))), 1)

  const btnStyle = (active: boolean) => ({
    padding: '5px 14px', borderRadius: 20, border: '1.5px solid',
    borderColor: active ? BRAND : '#e5e7eb', background: active ? BRAND : '#fff',
    color: active ? '#fff' : '#374151', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  } as React.CSSProperties)

  const years = Array.from({ length: 4 }, (_, i) => now.getFullYear() - i)
  const months = Array.from({ length: 12 }, (_, i) => i + 1)

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1a2f4e', marginBottom: 12 }}>年度比較</h1>

      {/* 控制列 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20 }}>
        {(['all', 'direct', 'franchise'] as StoreFilter[]).map(f => (
          <button key={f} onClick={() => setStoreFilter(f)} style={btnStyle(storeFilter === f)}>
            {f === 'all' ? '全部' : f === 'direct' ? '直營' : '加盟'}
          </button>
        ))}
        <div style={{ width: 1, height: 20, background: '#e5e7eb' }} />
        <select value={year} onChange={e => setYear(+e.target.value)} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13 }}>
          {years.map(y => <option key={y} value={y}>{y}年</option>)}
        </select>
        <select value={month} onChange={e => setMonth(+e.target.value)} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13 }}>
          {months.map(m => <option key={m} value={m}>{m}月</option>)}
        </select>
        <button onClick={fetchData} disabled={loading} style={{ padding: '7px 20px', borderRadius: 8, border: 'none', background: loading ? '#9ca3af' : BRAND, color: '#fff', fontSize: 13, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer' }}>
          {loading ? '載入中...' : '載入比較'}
        </button>
      </div>

      {error && <div style={{ background: '#fee2e2', color: '#991b1b', padding: '10px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{error}</div>}

      {!hasData && !loading && (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📈</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>尚無資料</div>
          <div style={{ fontSize: 13 }}>選擇年份與月份後點擊「載入比較」</div>
        </div>
      )}

      {hasData && (
        <>
          {/* 年份標示 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <span style={{ padding: '4px 14px', borderRadius: 20, background: BRAND, color: '#fff', fontSize: 13, fontWeight: 600 }}>{displayYear}年{month}月</span>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>vs</span>
            <span style={{ padding: '4px 14px', borderRadius: 20, background: '#d4b8b8', color: '#3c2929', fontSize: 13, fontWeight: 600 }}>{displayYear - 1}年{month}月</span>
          </div>

          {/* KPI 卡片 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
            {[
              { label: '月總營業額', curr: cRev, prev: pRev, fmt: (v: number) => `$${fmt(v)}`, sub: `去年同期 $${fmt(pRev)}` },
              { label: '總用餐人數', curr: cGuests, prev: pGuests, fmt: (v: number) => `${fmt(v)} 人`, sub: `去年同期 ${fmt(pGuests)} 人` },
              { label: '平均客單價', curr: cAvg, prev: pAvg, fmt: (v: number) => `$${fmt(v)}`, sub: `去年同期 $${fmt(pAvg)}` },
            ].map(kpi => (
              <div key={kpi.label} style={{ background: '#fff', borderRadius: 12, padding: '16px 20px', border: '1px solid #e8e6e1' }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>{kpi.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#1a2f4e' }}>{kpi.fmt(kpi.curr)}{diffBadge(kpi.curr, kpi.prev)}</div>
                <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>{kpi.sub}</div>
              </div>
            ))}
          </div>

          {/* 橫向長條圖比較 */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e6e1', padding: '16px 20px', marginBottom: 16 }}>
            <div style={{ fontWeight: 600, color: '#1a2f4e', fontSize: 14, marginBottom: 4 }}>各分店營業額對比</div>
            <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#6b7280', marginBottom: 12 }}>
              <span><span style={{ display: 'inline-block', width: 12, height: 8, background: BRAND, borderRadius: 2, marginRight: 4 }} />{displayYear}年</span>
              <span><span style={{ display: 'inline-block', width: 12, height: 8, background: '#d4b8b8', borderRadius: 2, marginRight: 4 }} />{displayYear - 1}年</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {allStores.map(s => {
                const c = curr[s], p = prev[s]
                const dn = c?.displayName || p?.displayName || s
                const cR = c?.rev || 0, pR = p?.rev || 0
                return (
                  <div key={s}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                      <span style={{ fontWeight: 600 }}>{dn}</span>
                      <span>${fmt(cR)} {diffBadge(cR, pR)}</span>
                    </div>
                    <HBar curr={cR} prev={pR} maxVal={maxRev} colorCurr={BRAND} colorPrev='#d4b8b8' />
                  </div>
                )
              })}
            </div>
          </div>

          {/* 客單價對比 */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e6e1', padding: '16px 20px', marginBottom: 16 }}>
            <div style={{ fontWeight: 600, color: '#1a2f4e', fontSize: 14, marginBottom: 4 }}>各分店客單價對比</div>
            <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#6b7280', marginBottom: 12 }}>
              <span><span style={{ display: 'inline-block', width: 12, height: 8, background: BRAND, borderRadius: 2, marginRight: 4 }} />{displayYear}年</span>
              <span><span style={{ display: 'inline-block', width: 12, height: 8, background: '#d4b8b8', borderRadius: 2, marginRight: 4 }} />{displayYear - 1}年</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {allStores.map(s => {
                const c = curr[s], p = prev[s]
                const dn = c?.displayName || p?.displayName || s
                const cAv = getAvg(c?.avgPays || []), pAv = getAvg(p?.avgPays || [])
                return (
                  <div key={s}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                      <span style={{ fontWeight: 600 }}>{dn}</span>
                      <span>${fmt(cAv)} {diffBadge(cAv, pAv)}</span>
                    </div>
                    <HBar curr={cAv} prev={pAv} maxVal={maxAvg} colorCurr={BRAND} colorPrev='#d4b8b8' />
                  </div>
                )
              })}
            </div>
          </div>

          {/* 詳細表格 */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e6e1', overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #e8e6e1', fontWeight: 600, color: '#1a2f4e', fontSize: 14 }}>各分店同期詳細比較</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#fafaf8' }}>
                    {['分店', '類型', `${displayYear}年營業額`, `${displayYear - 1}年營業額`, '漲跌', `${displayYear}年來客`, `${displayYear - 1}年來客`, `${displayYear}年客單價`, '狀態'].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: h === '分店' ? 'left' : 'right', color: '#6b7280', fontWeight: 600, borderBottom: '1.5px solid #e8e6e1', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allStores.map(s => {
                    const c = curr[s], p = prev[s]
                    const dn = c?.displayName || p?.displayName || s
                    const type = c?.type || p?.type || 'direct'
                    const cR = c?.rev || 0, pR = p?.rev || 0
                    const cG = c?.guests || 0, pG = p?.guests || 0
                    const cAp = c?.avgPays || [], pAp = p?.avgPays || []
                    const cAv = cAp.length ? cAp.reduce((a, b) => a + b, 0) / cAp.length : 0
                    const typeBadge = type === 'franchise'
                      ? <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#ede9fe', color: '#5b21b6' }}>加盟</span>
                      : <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#f5efef', color: BRAND }}>直營</span>
                    return (
                      <tr key={s} style={{ borderBottom: '1px solid #f0eee9' }}>
                        <td style={{ padding: '10px 14px', fontWeight: 600 }}>{dn}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right' }}>{typeBadge}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>${fmt(cR)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', color: '#9ca3af' }}>${fmt(pR)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right' }}>{diffBadge(cR, pR)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right' }}>{fmt(cG)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', color: '#9ca3af' }}>{fmt(pG)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right' }}>${fmt(cAv)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right' }}>{statusBadge(cR, pR)}</td>
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
