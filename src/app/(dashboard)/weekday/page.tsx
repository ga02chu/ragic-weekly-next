'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { fmt, isHoliday, getStoreType, getStoreDisplayName } from '@/lib/ragic/utils'
import { fetchAllRecords, getFields } from '@/lib/ragic/fetchRecords'

const BRAND = '#3c2929'
const HOLIDAY_COLOR = '#5c7a6e'
type StoreFilter = 'all' | 'direct' | 'franchise'
type SessionFilter = 'all' | 'noon' | 'evening'

interface WdBucket {
  rev: number; guests: number; groups: number; noshow: number
  avgPays: number[]; days: Set<string>
}
interface WdStore {
  rev: number; guests: number; groups: number; avgPays: number[]
  displayName: string; type: 'direct' | 'franchise'
}

function diffBadge(curr: number, prev: number) {
  if (!prev) return null
  const pct = ((curr - prev) / prev * 100).toFixed(1)
  const up = curr >= prev
  return <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 20, background: up ? '#dcfce7' : '#fee2e2', color: up ? '#166534' : '#991b1b', marginLeft: 4 }}>{up ? '▲' : '▼'} {Math.abs(Number(pct))}%</span>
}

function HBar({ a, b, maxVal, label1, label2, c1, c2 }: { a: number; b: number; maxVal: number; label1: string; label2: string; c1: string; c2: string }) {
  const p1 = maxVal > 0 ? a / maxVal * 100 : 0
  const p2 = maxVal > 0 ? b / maxVal * 100 : 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10, color: '#6b7280', width: 28, flexShrink: 0 }}>{label1}</span>
        <div style={{ flex: 1, position: 'relative', height: 16, background: '#f3f4f6', borderRadius: 3 }}>
          <div style={{ position: 'absolute', height: '100%', width: `${p1.toFixed(1)}%`, background: c1, borderRadius: 3 }} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10, color: '#6b7280', width: 28, flexShrink: 0 }}>{label2}</span>
        <div style={{ flex: 1, position: 'relative', height: 16, background: '#f3f4f6', borderRadius: 3 }}>
          <div style={{ position: 'absolute', height: '100%', width: `${p2.toFixed(1)}%`, background: c2, borderRadius: 3 }} />
        </div>
      </div>
    </div>
  )
}

export default function WeekdayPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [storeFilter, setStoreFilter] = useState<StoreFilter>('all')
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [wd, setWd] = useState<WdBucket | null>(null)
  const [hd, setHd] = useState<WdBucket | null>(null)
  const [wdByStore, setWdByStore] = useState<Record<string, WdStore>>({})
  const [hdByStore, setHdByStore] = useState<Record<string, WdStore>>({})
  const [displayInfo, setDisplayInfo] = useState('')
  const mounted = useRef(false)

  const fetchData = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const all = await fetchAllRecords()
      const fields = getFields()
      const pad = (n: number) => String(n).padStart(2, '0')
      const lastDay = new Date(year, month, 0).getDate()
      const from = `${year}-${pad(month)}-01`, to = `${year}-${pad(month)}-${pad(lastDay)}`
      const dateField = fields.date || '營業日期'
      const sessionField = fields.session || '營業時間'
      const storeField = fields.store || '分店簡稱'
      const records = all.filter(r => {
        const d = String(r[dateField] || '').replace(/\//g, '-').slice(0, 10)
        return d >= from && d <= to
      })

      const newWd: WdBucket = { rev: 0, guests: 0, groups: 0, noshow: 0, avgPays: [], days: new Set() }
      const newHd: WdBucket = { rev: 0, guests: 0, groups: 0, noshow: 0, avgPays: [], days: new Set() }
      const newWdByStore: Record<string, WdStore> = {}
      const newHdByStore: Record<string, WdStore> = {}

      const toNum = (v: unknown) => { const n = parseFloat(String(v || '').replace(/,/g, '')); return isNaN(n) ? 0 : n }

      for (const r of records) {
        const storeName = String(r[storeField] || '').trim() || '未知分店'
        const session = String(r[sessionField] || '').trim()
        const date = String(r[dateField] || '').replace(/\//g, '-').slice(0, 10)
        const storeType = getStoreType(storeName)

        if (storeFilter === 'direct' && storeType !== 'direct') continue
        if (storeFilter === 'franchise' && storeType !== 'franchise') continue
        if (sessionFilter === 'noon' && session !== '中午') continue
        if (sessionFilter === 'evening' && session !== '晚上') continue

        const revField = fields.revenue || '當日營業額'
        const rev = toNum(r[revField])
        const guests = toNum(r[fields.guests || '用餐人數'])
        const groups = toNum(r[fields.groups || '用餐組數'])
        const noshow = toNum(r[fields.noshow || 'No Show組數'])
        const avgPay = toNum(r[fields.avgPay || '客單價'])
        const holiday = isHoliday(date)
        const bucket = holiday ? newHd : newWd
        const byStore = holiday ? newHdByStore : newWdByStore

        bucket.rev += rev; bucket.guests += guests; bucket.groups += groups; bucket.noshow += noshow
        if (avgPay > 0) bucket.avgPays.push(avgPay)
        if (date) bucket.days.add(date)

        if (!byStore[storeName]) byStore[storeName] = { rev: 0, guests: 0, groups: 0, avgPays: [], displayName: getStoreDisplayName(storeName), type: storeType }
        byStore[storeName].rev += rev; byStore[storeName].guests += guests; byStore[storeName].groups += groups
        if (avgPay > 0) byStore[storeName].avgPays.push(avgPay)
      }

      setWd(newWd); setHd(newHd)
      setWdByStore(newWdByStore); setHdByStore(newHdByStore)
      setDisplayInfo(`${year}年${month}月`)
    } catch (e: unknown) { setError(e instanceof Error ? e.message : '載入失敗') }
    setLoading(false)
  }, [year, month, storeFilter, sessionFilter])

  useEffect(() => {
    if (!mounted.current) { mounted.current = true; fetchData() }
  }, [fetchData])

  const hasData = wd !== null && (wd.days.size > 0 || hd!.days.size > 0)
  const wdDays = wd?.days.size || 1, hdDays = hd?.days.size || 1
  const wdAvg = wd?.avgPays.length ? wd.avgPays.reduce((a, b) => a + b, 0) / wd.avgPays.length : 0
  const hdAvg = hd?.avgPays.length ? hd.avgPays.reduce((a, b) => a + b, 0) / hd.avgPays.length : 0
  const allStores = Array.from(new Set([...Object.keys(wdByStore), ...Object.keys(hdByStore)])).sort()
  const maxRev = Math.max(...allStores.map(s => Math.max((wdByStore[s]?.rev || 0) / wdDays, (hdByStore[s]?.rev || 0) / hdDays)), 1)

  const btnStyle = (active: boolean) => ({
    padding: '5px 14px', borderRadius: 20, border: '1.5px solid',
    borderColor: active ? BRAND : '#e5e7eb', background: active ? BRAND : '#fff',
    color: active ? '#fff' : '#374151', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  } as React.CSSProperties)

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1a2f4e', marginBottom: 12 }}>平假日分析</h1>

      {/* 控制列 */}
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
        <select value={year} onChange={e => setYear(+e.target.value)} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13 }}>
          {Array.from({ length: 4 }, (_, i) => now.getFullYear() - i).map(y => <option key={y} value={y}>{y}年</option>)}
        </select>
        <select value={month} onChange={e => setMonth(+e.target.value)} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13 }}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}月</option>)}
        </select>
        <button onClick={fetchData} disabled={loading} style={{ padding: '7px 20px', borderRadius: 8, border: 'none', background: loading ? '#9ca3af' : BRAND, color: '#fff', fontSize: 13, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer' }}>
          {loading ? '載入中...' : '載入分析'}
        </button>
      </div>

      {error && <div style={{ background: '#fee2e2', color: '#991b1b', padding: '10px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{error}</div>}

      {!hasData && !loading && (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📅</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>尚無資料</div>
          <div style={{ fontSize: 13 }}>選擇年份與月份後點擊「載入分析」</div>
        </div>
      )}

      {hasData && wd && hd && (
        <>
          {/* 標示 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <span style={{ padding: '4px 14px', borderRadius: 20, background: BRAND, color: '#fff', fontSize: 13, fontWeight: 600 }}>平日</span>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>vs</span>
            <span style={{ padding: '4px 14px', borderRadius: 20, background: HOLIDAY_COLOR, color: '#fff', fontSize: 13, fontWeight: 600 }}>假日</span>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>{displayInfo}・平日 {wd.days.size} 天 / 假日 {hd.days.size} 天</span>
          </div>

          {/* KPI */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
            {[
              { label: '平日日均營業額', curr: wd.rev / wdDays, prev: hd.rev / hdDays, sub: `假日日均 $${fmt(hd.rev / hdDays)}` },
              { label: '平日日均來客', curr: wd.guests / wdDays, prev: hd.guests / hdDays, sub: `假日日均 ${fmt(hd.guests / hdDays)} 人` },
              { label: '平日客單價', curr: wdAvg, prev: hdAvg, sub: `假日客單價 $${fmt(hdAvg)}` },
              { label: '平日 No Show', curr: wd.noshow, prev: hd.noshow, sub: `假日 No Show ${fmt(hd.noshow)} 組` },
            ].map(kpi => (
              <div key={kpi.label} style={{ background: '#fff', borderRadius: 12, padding: '16px 20px', border: '1px solid #e8e6e1' }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>{kpi.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#1a2f4e' }}>${fmt(kpi.curr)}{diffBadge(kpi.curr, kpi.prev)}</div>
                <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>{kpi.sub}</div>
              </div>
            ))}
          </div>

          {/* 分店橫向比較 */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e6e1', padding: '16px 20px', marginBottom: 16 }}>
            <div style={{ fontWeight: 600, color: '#1a2f4e', fontSize: 14, marginBottom: 4 }}>各分店日均營業額（平日 vs 假日）</div>
            <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#6b7280', marginBottom: 12 }}>
              <span><span style={{ display: 'inline-block', width: 12, height: 8, background: BRAND, borderRadius: 2, marginRight: 4 }} />平日日均</span>
              <span><span style={{ display: 'inline-block', width: 12, height: 8, background: HOLIDAY_COLOR, borderRadius: 2, marginRight: 4 }} />假日日均</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {allStores.map(s => {
                const w = wdByStore[s], h = hdByStore[s]
                const dn = (w || h).displayName
                const wR = (w?.rev || 0) / wdDays, hR = (h?.rev || 0) / hdDays
                return (
                  <div key={s}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                      <span style={{ fontWeight: 600 }}>{dn}</span>
                      <span>平 ${fmt(wR)} / 假 ${fmt(hR)}</span>
                    </div>
                    <HBar a={wR} b={hR} maxVal={maxRev} label1='平日' label2='假日' c1={BRAND} c2={HOLIDAY_COLOR} />
                  </div>
                )
              })}
            </div>
          </div>

          {/* 詳細表格 */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e6e1', overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #e8e6e1', fontWeight: 600, color: '#1a2f4e', fontSize: 14 }}>各分店平假日詳細比較</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#fafaf8' }}>
                    {['分店', '平日營業額', '假日營業額', '平日來客', '假日來客', '平日客單價', '假日客單價', '客單價差（假-平）'].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: h === '分店' ? 'left' : 'right', color: '#6b7280', fontWeight: 600, borderBottom: '1.5px solid #e8e6e1', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allStores.map(s => {
                    const w = wdByStore[s], h = hdByStore[s]
                    const dn = (w || h).displayName
                    const wAp = w?.avgPays || [], hAp = h?.avgPays || []
                    const wAv = wAp.length ? wAp.reduce((a, b) => a + b, 0) / wAp.length : 0
                    const hAv = hAp.length ? hAp.reduce((a, b) => a + b, 0) / hAp.length : 0
                    const diff = wAv > 0 ? hAv - wAv : null
                    const diffPct = wAv > 0 ? (hAv - wAv) / wAv * 100 : null
                    const diffEl = diff === null ? <span style={{ color: '#9ca3af' }}>–</span>
                      : diff > 0 ? <span style={{ color: '#166534' }}>▲ ${fmt(Math.abs(diff))} (+{Math.abs(diffPct!).toFixed(1)}%)</span>
                      : diff < 0 ? <span style={{ color: '#991b1b' }}>▼ ${fmt(Math.abs(diff))} (-{Math.abs(diffPct!).toFixed(1)}%)</span>
                      : <span style={{ color: '#9ca3af' }}>持平</span>
                    return (
                      <tr key={s} style={{ borderBottom: '1px solid #f0eee9' }}>
                        <td style={{ padding: '10px 14px', fontWeight: 600 }}>{dn}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right' }}>${fmt(w?.rev || 0)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right' }}>${fmt(h?.rev || 0)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right' }}>{fmt(w?.guests || 0)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right' }}>{fmt(h?.guests || 0)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right' }}>${fmt(wAv)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right' }}>${fmt(hAv)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right' }}>{diffEl}</td>
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
