'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { getMonthlyStdH, fetchAllRecords, getFields } from '@/lib/ragic/fetchRecords'
import { processRecords } from '@/lib/ragic/processRecords'
import { fmt } from '@/lib/ragic/utils'
import {
  parsePay, parseAtt, parseLoc, parseAdj, parseBreak, buildBreakMap,
  adjDeltaForMonth, adjExtrasForMonth, empPfForMonth, calcResults, computeStoreDist,
  holidayPayForMonth, compHoursForMonth, latePenaltyForMonth, birthdayBonusForMonth,
  foreignerIdsFromNames, mergeExtras, emptyAdj,
  fT, fH,
  type HREmployee, type AttResult, type LocRecord, type BreakRecord, type CalcResult,
  type ParsedAdjustments,
} from '@/lib/hr/calc'


function rehydrateAtt(raw: AttResult): AttResult {
  const pd = (s: string) => { const m = String(s || '').match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/); return m ? new Date(+m[1], +m[2]-1, +m[3]) : null }
  return { ...raw, records: raw.records.map(r => ({ ...r, date: pd(r.dateStr) })) }
}
function rehydrateLoc(raw: LocRecord[]): LocRecord[] {
  const pd = (s: string) => { const m = String(s || '').match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/); return m ? new Date(+m[1], +m[2]-1, +m[3]) : null }
  return raw.map(r => ({ ...r, date: pd(r.dateStr) }))
}
function rehydrateAdj(raw: unknown): ParsedAdjustments {
  // 舊格式（陣列）轉新格式
  if (Array.isArray(raw)) {
    return {
      records: raw.map(r => ({
        ...r,
        startDate: r.startDate ? new Date(r.startDate) : null,
        endDate: r.endDate ? new Date(r.endDate) : null,
      })),
      holidays: [], lates: {}, compHours: {}, foreigners: [],
    }
  }
  const obj = raw as ParsedAdjustments
  return {
    records: (obj.records || []).map(r => ({
      ...r,
      startDate: r.startDate ? new Date(r.startDate as unknown as string) : null,
      endDate: r.endDate ? new Date(r.endDate as unknown as string) : null,
    })),
    holidays: (obj.holidays || []).map(h => ({
      ...h,
      date: h.date ? new Date(h.date as unknown as string) : null,
    })),
    lates: obj.lates || {},
    compHours: obj.compHours || {},
    foreigners: obj.foreigners || [],
  }
}

const BRAND = '#3c2929'
type ViewMode = 'week' | 'month'
type ResultTab = 'employees' | 'dept' | 'store' | 'anom'
type FileKey = 'pay' | 'att' | 'loc' | 'adj' | 'brk'
type FileStatus = 'idle' | 'loaded' | 'error'

function UploadZone({ label, status, onFile }: { label: string; status: FileStatus; onFile: (f: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const bg = status === 'loaded' ? '#f0fdf4' : status === 'error' ? '#fef2f2' : '#fafaf8'
  const border = status === 'loaded' ? '#86efac' : status === 'error' ? '#fca5a5' : '#e5e7eb'
  const icon = status === 'loaded' ? '✓' : status === 'error' ? '!' : '↑'
  const iconColor = status === 'loaded' ? '#16a34a' : status === 'error' ? '#dc2626' : '#9ca3af'
  return (
    <div onClick={() => inputRef.current?.click()}
      style={{ background: bg, border: `2px dashed ${border}`, borderRadius: 10, padding: '16px 12px', cursor: 'pointer', textAlign: 'center' }}>
      <input ref={inputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
        onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
      <div style={{ fontSize: 20, color: iconColor, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{label}</div>
      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>點擊上傳 .xlsx</div>
    </div>
  )
}

export default function HRPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [viewMode, setViewMode] = useState<ViewMode>('month')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [locFilter, setLocFilter] = useState('')
  const [stdH, setStdH] = useState(() => getMonthlyStdH(now.getFullYear(), now.getMonth() + 1))

  useEffect(() => { setStdH(getMonthlyStdH(year, month)) }, [year, month])
  const [excludeMgmt, setExcludeMgmt] = useState(false)
  const [resultTab, setResultTab] = useState<ResultTab>('employees')

  const [pay, setPay] = useState<HREmployee[]>([])
  const [att, setAtt] = useState<AttResult | null>(null)
  const [loc, setLoc] = useState<LocRecord[]>([])
  const [adj, setAdj] = useState<ParsedAdjustments>(emptyAdj)
  const [brk, setBrk] = useState<BreakRecord[]>([])
  const [fileStatus, setFileStatus] = useState<Record<FileKey, FileStatus>>({ pay: 'idle', att: 'idle', loc: 'idle', adj: 'idle', brk: 'idle' })
  const [parseErr, setParseErr] = useState<Record<FileKey, string>>({ pay: '', att: '', loc: '', adj: '', brk: '' })
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [chartData, setChartData] = useState<{ name: string; rev: number; cost: number }[]>([])

  useEffect(() => {
    try {
      const s = (k: string) => { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null }
      const sp = s('hr_data_pay'); if (sp) { setPay(sp); setFileStatus(p => ({ ...p, pay: 'loaded' })) }
      const sa = s('hr_data_att'); if (sa) { setAtt(rehydrateAtt(sa)); setFileStatus(p => ({ ...p, att: 'loaded' })) }
      const sl = s('hr_data_loc'); if (sl) { setLoc(rehydrateLoc(sl)); setFileStatus(p => ({ ...p, loc: 'loaded' })) }
      const sb = s('hr_data_brk'); if (sb) { setBrk(sb); setFileStatus(p => ({ ...p, brk: 'loaded' })) }
      const sj = s('hr_data_adj'); if (sj) { setAdj(rehydrateAdj(sj)); setFileStatus(p => ({ ...p, adj: 'loaded' })) }
      const sm = s('hr_data_meta'); if (sm?.timestamp) setSavedAt(sm.timestamp)
    } catch { /* ignore */ }
  }, [])

  const [calcResult, setCalcResult] = useState<CalcResult | null>(null)
  const [storeDist, setStoreDist] = useState<ReturnType<typeof computeStoreDist>>([])
  const [computing, setComputing] = useState(false)
  const [compErr, setCompErr] = useState('')

  const handleFile = useCallback(async (key: FileKey, file: File) => {
    setParseErr(prev => ({ ...prev, [key]: '' }))
    setFileStatus(prev => ({ ...prev, [key]: 'idle' }))
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: true })
      let parsed: unknown
      if (key === 'pay') { parsed = parsePay(wb); setPay(parsed as HREmployee[]) }
      else if (key === 'att') { parsed = parseAtt(wb); setAtt(parsed as AttResult) }
      else if (key === 'loc') { parsed = parseLoc(wb); setLoc(parsed as LocRecord[]) }
      else if (key === 'adj') { parsed = parseAdj(wb); setAdj(parsed as ParsedAdjustments) }
      else { parsed = parseBreak(wb); setBrk(parsed as BreakRecord[]) }
      setFileStatus(prev => ({ ...prev, [key]: 'loaded' }))
      try {
        localStorage.setItem(`hr_data_${key}`, JSON.stringify(parsed))
        const ts = Date.now()
        localStorage.setItem('hr_data_meta', JSON.stringify({ timestamp: ts }))
        setSavedAt(ts)
      } catch { /* storage full, ignore */ }
    } catch (e: unknown) {
      setFileStatus(prev => ({ ...prev, [key]: 'error' }))
      setParseErr(prev => ({ ...prev, [key]: e instanceof Error ? e.message : '解析失敗' }))
    }
  }, [])

  const compute = useCallback(async () => {
    if (!pay.length || !att) { setCompErr('請先上傳薪資表與出勤記錄'); return }
    setComputing(true); setCompErr('')
    try {
      const monthStart = new Date(year, month - 1, 1)
      const monthEnd = new Date(year, month, 0)
      const totalDays = monthEnd.getDate()
      let sDate: Date, eDate: Date, pf: number

      if (viewMode === 'month' || (!dateFrom && !dateTo)) {
        sDate = monthStart; eDate = monthEnd; pf = 1
      } else {
        sDate = dateFrom ? new Date(dateFrom) : monthStart
        eDate = dateTo ? new Date(dateTo) : monthEnd
        const periodDays = Math.round((eDate.getTime() - sDate.getTime()) / 86400000) + 1
        pf = Math.min(1, periodDays / totalDays)
      }

      const adjMap = adjDeltaForMonth(year, month, adj.records, pay)

      // 把所有來源的 extras 全部 merge 在一起
      const breakMap = buildBreakMap(brk)
      const lateRes = latePenaltyForMonth(adj.lates, pay)
      const merged = mergeExtras(
        // 舊：att 的加扣項
        { extras: att.extras || {}, details: att.extrasDetail || {} },
        // 調整表 其他加扣
        adjExtrasForMonth(adj.records, pay) as { extras: Record<string, number>; details: Record<string, { code: string; desc: string; amt: number; note: string }[]> },
        // 國定假日加給
        holidayPayForMonth(adj.holidays, pay, att, breakMap),
        // 加班換補休
        compHoursForMonth(adj.compHours, pay),
        // 遲到扣考績（FT）
        lateRes.extras,
        // 生日禮金
        birthdayBonusForMonth(year, month, pay),
      )
      const mergedAtt: AttResult = { ...att, extras: merged.extras, extrasDetail: merged.details }

      // 新進/離職的個別比例
      const empPfMap = empPfForMonth(year, month, adj.records, pay)

      // 外籍員工 id set
      const foreignerIds = foreignerIdsFromNames(adj.foreigners, pay)

      const result = calcResults(
        sDate, eDate, storeFilter, stdH, pf, adjMap, excludeMgmt, locFilter,
        pay, mergedAtt, loc, {}, breakMap, empPfMap, foreignerIds, lateRes.ptZeroIds,
      )
      setCalcResult(result)
      const dist = computeStoreDist(result.results, result.locR)
      setStoreDist(dist)

      // Fetch Ragic revenue for chart comparison
      try {
        const allRecords = await fetchAllRecords()
        const fields = getFields()
        const dateField = fields.date || '營業日期'
        const pad = (n: number) => String(n).padStart(2, '0')
        const mFrom = `${year}-${pad(month)}-01`
        const mTo = `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}`
        const inMonth = allRecords.filter(r => {
          const d = String(r[dateField] || '').replace(/\//g, '-').slice(0, 10)
          return d >= mFrom && d <= mTo
        })
        const ragic = processRecords(inMonth, fields)
        const mapCatToRev = (cat: string) => {
          const entry = Object.values(ragic.byStore).find(s => {
            const dn = s.displayName
            if (cat.includes('概念')) return dn.includes('概念') || dn.includes('仁愛')
            if (cat.includes('2號')) return dn.includes('2號') || dn.includes('二號') || dn.includes('台北')
            if (cat.includes('3號')) return dn.includes('3號') || dn.includes('三號') || dn.includes('北屯')
            if (cat.includes('英洙')) return dn.includes('英洙') || dn.includes('英洸')
            return false
          })
          return entry?.rev || 0
        }
        setChartData(dist.map(d => ({ name: d.cat.replace(/（.*）$/, ''), rev: mapCatToRev(d.cat), cost: d.totalCost })))
      } catch { /* no Ragic data, skip chart */ }
    } catch (e: unknown) {
      setCompErr(e instanceof Error ? e.message : '計算失敗')
    }
    setComputing(false)
  }, [pay, att, loc, adj, brk, year, month, viewMode, dateFrom, dateTo, storeFilter, stdH, excludeMgmt, locFilter])

  const results = calcResult?.results || []
  const ftCount = results.filter(e => e.type === '月薪正職').length
  const ptCount = results.filter(e => e.type === '時薪工讀').length
  const totalH = results.reduce((s, e) => s + e.totalH, 0)
  const isWeek = viewMode === 'week' && !!calcResult
  const totalCost = results.reduce((s, e) => {
    return s + (e.type === '月薪正職'
      ? (e.propSal || 0) + (e.weekOtPay || 0) + (e.propIns || 0)
      : (e.propSal || 0) + (e.propIns || 0))
  }, 0)

  const deptMap: Record<string, { ft: number; pt: number; totalH: number; cost: number }> = {}
  results.forEach(e => {
    if (!deptMap[e.dept]) deptMap[e.dept] = { ft: 0, pt: 0, totalH: 0, cost: 0 }
    deptMap[e.dept].ft += e.type === '月薪正職' ? 1 : 0
    deptMap[e.dept].pt += e.type === '時薪工讀' ? 1 : 0
    deptMap[e.dept].totalH += e.totalH
    deptMap[e.dept].cost += e.type === '月薪正職'
      ? (e.propSal || 0) + (e.weekOtPay || 0) + (e.propIns || 0)
      : (e.propSal || 0) + (e.propIns || 0)
  })
  const depts = Object.keys(deptMap).sort()
  const hasResult = results.length > 0

  const btnStyle = (active: boolean) => ({
    padding: '5px 14px', borderRadius: 20, border: '1.5px solid',
    borderColor: active ? BRAND : '#e5e7eb', background: active ? BRAND : '#fff',
    color: active ? '#fff' : '#374151', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  } as React.CSSProperties)

  const tabStyle = (active: boolean) => ({
    padding: '10px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'none',
    border: 'none', borderBottom: `2px solid ${active ? BRAND : 'transparent'}`,
    color: active ? BRAND : '#6b7280',
  } as React.CSSProperties)

  return (
    <div style={{ padding: 24, maxWidth: 1400 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1a2f4e', marginBottom: 16 }}>人事成本</h1>

      {/* 上傳區域 */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e6e1', marginBottom: 16 }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #e8e6e1', fontWeight: 600, color: '#1a2f4e', fontSize: 14 }}>
          Excel 檔案上傳
        </div>
        <div style={{ padding: '16px 20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 10 }}>
            {([
              { key: 'pay' as FileKey, label: '薪資表（必填）' },
              { key: 'att' as FileKey, label: '出勤紀錄（必填）' },
              { key: 'loc' as FileKey, label: '上班打卡（必填）' },
              { key: 'brk' as FileKey, label: '休息紀錄（必填）' },
              { key: 'adj' as FileKey, label: '調整表（選填，月報用）' },
            ]).map(({ key, label }) => (
              <div key={key}>
                <UploadZone label={label} status={fileStatus[key]} onFile={f => handleFile(key, f)} />
                {parseErr[key] && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 4 }}>{parseErr[key]}</div>}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: '#9ca3af', flexWrap: 'wrap' }}>
            <span>
              已載入：薪資 {pay.length} 筆 · 出勤 {att?.records.length || 0} 筆 · 打卡 {loc.length} 筆 · 休息 {brk.length} 筆
              {' · 調整：'}請假/到離職/加扣 {adj.records.length} 筆
              {adj.holidays.length > 0 && ` · 國定假日 ${adj.holidays.length} 天`}
              {Object.keys(adj.lates).length > 0 && ` · 遲到 ${Object.keys(adj.lates).length} 人`}
              {Object.keys(adj.compHours).length > 0 && ` · 換補休 ${Object.keys(adj.compHours).length} 人`}
              {adj.foreigners.length > 0 && ` · 外籍 ${adj.foreigners.length} 人`}
            </span>
            {savedAt && (
              <span style={{ color: '#16a34a', fontSize: 11 }}>
                ✓ 上次記憶：{new Date(savedAt).toLocaleDateString('zh-TW')} {new Date(savedAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 計算設定 */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e6e1', marginBottom: 16 }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #e8e6e1', fontWeight: 600, color: '#1a2f4e', fontSize: 14 }}>
          計算設定
        </div>
        <div style={{ padding: '16px 20px', display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>年份</div>
            <select value={year} onChange={e => setYear(+e.target.value)}
              style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}>
              {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>月份</div>
            <select value={month} onChange={e => setMonth(+e.target.value)}
              style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}>
              {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}月</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>計算模式</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setViewMode('month')} style={btnStyle(viewMode === 'month')}>整月</button>
              <button onClick={() => setViewMode('week')} style={btnStyle(viewMode === 'week')}>週期</button>
            </div>
          </div>
          {viewMode === 'week' && (
            <>
              <div>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>開始日</div>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                  style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>結束日</div>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                  style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }} />
              </div>
            </>
          )}
          <div>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>門市篩選</div>
            <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12, minWidth: 120 }}>
              <option value="">（全部）</option>
              {Array.from(new Set(pay.map(p => p.dept).filter(Boolean))).sort().map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>職區</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {['', '內場', '外場'].map(v => (
                <button key={v || 'all'} onClick={() => setLocFilter(v)} style={btnStyle(locFilter === v)}>
                  {v || '全部'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>標準工時</div>
            <input type="number" value={stdH} onChange={e => setStdH(+e.target.value)} step={0.01}
              style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12, width: 80 }} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={excludeMgmt} onChange={e => setExcludeMgmt(e.target.checked)} />
            排除總部
          </label>
          <button onClick={compute} disabled={computing || !pay.length || !att}
            style={{ padding: '8px 20px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600,
              background: (!pay.length || !att) ? '#9ca3af' : BRAND,
              color: '#fff', cursor: (!pay.length || !att) ? 'not-allowed' : 'pointer' }}>
            {computing ? '計算中...' : '開始計算'}
          </button>
        </div>
        {compErr && <div style={{ padding: '0 20px 14px', fontSize: 12, color: '#dc2626' }}>{compErr}</div>}
      </div>

      {/* 空態 */}
      {!hasResult && !computing && (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>👥</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>尚無計算結果</div>
          <div style={{ fontSize: 13 }}>上傳薪資表與出勤記錄後點擊「開始計算」</div>
        </div>
      )}

      {/* 結果 */}
      {hasResult && (
        <>
          {/* 本月套用的調整摘要 — 讓使用者一眼看到調整表有沒有被讀進來 */}
          {(() => {
            const sumExtraByCode = (code: string) => results.reduce((s, e) => {
              const items = e.extraDetail?.filter(d => d.code === code) || []
              return s + items.reduce((a, b) => a + b.amt, 0)
            }, 0)
            const countByCode = (code: string) => results.reduce((s, e) => s + (e.extraDetail?.some(d => d.code === code) ? 1 : 0), 0)
            const proratedCount = results.filter(e => e.propFactor !== undefined && e.propFactor !== 1).length
            const items = [
              { label: '國定假日加給', val: sumExtraByCode('6002'), n: countByCode('6002'), source: '調整表 → 國定假日 sheet' },
              { label: '加班換補休', val: sumExtraByCode('comp'), n: countByCode('comp'), source: '調整表 → 加班換補休 sheet' },
              { label: '遲到扣考績', val: sumExtraByCode('5001'), n: countByCode('5001'), source: '調整表 → 遲到記錄 sheet' },
              { label: '生日禮金', val: sumExtraByCode('9000'), n: results.filter(e => e.extraDetail?.some(d => d.code === '9000' && d.desc === '生日禮金')).length, source: '薪資表 → 生日欄位' },
              { label: '外籍員工費率', val: 0, n: adj.foreigners.length, source: '調整表 → 外籍員工 sheet', noMoney: true },
              { label: '新進/離職比例計薪', val: 0, n: proratedCount, source: '調整表 → 新進與離職 sheet', noMoney: true },
            ]
            return (
              <div style={{ background: '#fef9c3', border: '1px solid #fde047', borderRadius: 12, padding: '14px 18px', marginBottom: 16 }}>
                <div style={{ fontWeight: 600, color: '#713f12', fontSize: 13, marginBottom: 10 }}>📋 本月套用的調整（用來確認調整表有讀進來）</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, fontSize: 12 }}>
                  {items.map(it => (
                    <div key={it.label} style={{ background: '#fff', borderRadius: 8, padding: '10px 12px', border: '1px solid #fde047' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span style={{ fontWeight: 600, color: '#713f12' }}>{it.label}</span>
                        <span style={{ color: it.n > 0 ? '#16a34a' : '#9ca3af', fontWeight: 600 }}>
                          {it.n > 0 ? '✓' : '–'} {it.n} 人
                        </span>
                      </div>
                      {!it.noMoney && it.n > 0 && (
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#1a2f4e', marginTop: 4 }}>{fT(it.val)}</div>
                      )}
                      <div style={{ fontSize: 10, color: '#a16207', marginTop: 4 }}>{it.source}</div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* 人事成本佔比明細 — 卡片版 */}
          {(() => {
            const salTotal = results.reduce((s, e) => s + (e.propSal || 0), 0)
            const otTotal = results.reduce((s, e) => s + (e.type === '月薪正職' ? (e.weekOtPay || 0) : 0), 0)
            const insTotal = results.reduce((s, e) => s + (e.propIns || 0), 0)
            // 國定假日加倍：抓代碼 6002（修正以前抓錯成 2000=免稅加班費的問題）
            const holi6002 = results.reduce((s, e) => {
              const items = e.extraDetail?.filter(d => d.code === '6002') || []
              return s + items.reduce((a, b) => a + b.amt, 0)
            }, 0)
            const annual20032 = results.reduce((s, e) => {
              const items = e.extraDetail?.filter(d => d.code === '20032') || []
              return s + items.reduce((a, b) => a + b.amt, 0)
            }, 0)
            // 其他加扣（非已分類項目）
            const COUNTED_CODES = new Set(['6002', '20032'])
            const otherExtras = results.reduce((s, e) => {
              const items = e.extraDetail?.filter(d => !COUNTED_CODES.has(d.code)) || []
              return s + items.reduce((a, b) => a + b.amt, 0)
            }, 0)
            const grandTotal = salTotal + otTotal + insTotal + holi6002 + annual20032 + otherExtras
            const totalRev = chartData.reduce((s, d) => s + d.rev, 0)
            const pct = (v: number, base: number) => base > 0 ? `${(v / base * 100).toFixed(1)}%` : null
            const items: { label: string; val: number; icon: string; color: string }[] = [
              { label: '薪資', val: salTotal, icon: '💼', color: '#3b82f6' },
              { label: '加班費', val: otTotal, icon: '⏱️', color: '#f59e0b' },
              { label: '勞健保', val: insTotal, icon: '🏥', color: '#10b981' },
              { label: '國定假日加給', val: holi6002, icon: '🎉', color: '#8b5cf6' },
              { label: '特休轉薪資', val: annual20032, icon: '🏖️', color: '#ec4899' },
              { label: '其他加扣', val: otherExtras, icon: '📋', color: '#64748b' },
            ]
            const ratio = totalRev > 0 ? grandTotal / totalRev : 0
            return (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 600, color: '#1a2f4e', fontSize: 14, marginBottom: 10 }}>人事成本佔比明細</div>

                {/* 細項卡片 */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
                  {items.map(it => {
                    const pCost = grandTotal > 0 ? (it.val / grandTotal * 100) : 0
                    return (
                      <div key={it.label} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e6e1', padding: '14px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <div style={{ width: 32, height: 32, borderRadius: 8, background: `${it.color}1a`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>{it.icon}</div>
                          <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>{it.label}</div>
                        </div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: '#1a2f4e', marginBottom: 8 }}>{fT(it.val)}</div>
                        <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>佔人事成本 {pct(it.val, grandTotal) || '–'}</div>
                        <div style={{ height: 6, background: '#f3f4f6', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pCost.toFixed(1)}%`, background: it.color, borderRadius: 3 }} />
                        </div>
                        {totalRev > 0 && (
                          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>佔月營業額 {pct(it.val, totalRev)}</div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* 合計卡片（強調） */}
                <div style={{
                  background: `linear-gradient(135deg, ${BRAND} 0%, #5c4040 100%)`,
                  borderRadius: 12, padding: '20px 24px', color: '#fff',
                  display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16,
                }}>
                  <div>
                    <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>人事成本合計</div>
                    <div style={{ fontSize: 28, fontWeight: 700 }}>{fT(grandTotal)}</div>
                  </div>
                  {totalRev > 0 && (
                    <>
                      <div style={{ width: 1, height: 40, background: 'rgba(255,255,255,0.2)' }} />
                      <div>
                        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>月營業額</div>
                        <div style={{ fontSize: 22, fontWeight: 700 }}>{fT(totalRev)}</div>
                      </div>
                      <div style={{ width: 1, height: 40, background: 'rgba(255,255,255,0.2)' }} />
                      <div>
                        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>佔月營業額</div>
                        <div style={{ fontSize: 24, fontWeight: 700, color: ratio > 0.35 ? '#fca5a5' : '#86efac' }}>
                          {(ratio * 100).toFixed(1)}%
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )
          })()}

          {/* KPI */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
            {[
              { label: '正職人數', val: `${ftCount} 人`, est: false },
              { label: '工讀人數', val: `${ptCount} 人`, est: false },
              { label: '總出勤時數', val: fH(totalH), est: false },
              { label: isWeek ? '期間人事成本（估）' : '月人事成本', val: fT(totalCost), est: isWeek },
            ].map(kpi => (
              <div key={kpi.label} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e6e1', padding: '14px 18px' }}>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>{kpi.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#1a2f4e', fontStyle: kpi.est ? 'italic' : 'normal' }}>
                  {kpi.est ? '~' : ''}{kpi.val}
                </div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e6e1', overflow: 'hidden' }}>
            <div style={{ display: 'flex', borderBottom: '1px solid #e8e6e1', padding: '0 20px' }}>
              {([
                { key: 'employees' as ResultTab, label: `員工明細（${results.length}）` },
                { key: 'dept' as ResultTab, label: `門市彙整（${depts.length}）` },
                { key: 'store' as ResultTab, label: `分店分攤（${storeDist.length}）` },
                { key: 'anom' as ResultTab, label: `異常（${calcResult?.anom.length || 0}）` },
              ]).map(t => (
                <button key={t.key} onClick={() => setResultTab(t.key)} style={tabStyle(resultTab === t.key)}>
                  {t.label}
                </button>
              ))}
            </div>

            <div style={{ overflowX: 'auto' }}>
              {resultTab === 'employees' && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#fafaf8' }}>
                      {['工號','姓名','門市','類型','出勤H','標準H','加班H', isWeek ? '估薪資' : '薪資','加扣項','保費','合計','職區'].map(h => (
                        <th key={h} style={{ padding: '9px 12px', textAlign: ['工號','姓名','門市','職區'].includes(h) ? 'left' : 'right', color: '#6b7280', fontWeight: 600, borderBottom: '1.5px solid #e8e6e1', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {results.map(e => {
                      const isFT = e.type === '月薪正職'
                      const sal = e.propSal || 0
                      const ot = isFT ? (isWeek ? (e.weekOtPay || 0) : (e.otPay || 0)) : 0
                      const ins = e.propIns || 0
                      const total = sal + ot + ins
                      return (
                        <tr key={e.id} style={{ borderBottom: '1px solid #f0eee9' }}>
                          <td style={{ padding: '8px 12px', color: '#9ca3af' }}>{e.id}</td>
                          <td style={{ padding: '8px 12px', fontWeight: 600 }}>{e.name}</td>
                          <td style={{ padding: '8px 12px' }}>{e.dept}</td>
                          <td style={{ padding: '8px 12px' }}>
                            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 20, background: isFT ? '#e0f2fe' : '#fef9c3', color: isFT ? '#0369a1' : '#854d0e' }}>
                              {isFT ? '正職' : '工讀'}
                            </span>
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fH(e.totalH)}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{isFT ? fH(isWeek ? e.weekStd : e.eStd) : '–'}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{isFT ? fH(isWeek ? e.weekOtH : e.otH) : fH(e.ptDailyOt)}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontStyle: isWeek ? 'italic' : 'normal' }}>
                            {e.noPunch ? '–' : `${isWeek ? '~' : ''}${fT(sal + ot)}`}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', color: (e.extra || 0) > 0 ? '#16a34a' : (e.extra || 0) < 0 ? '#dc2626' : '#9ca3af' }}>
                            {e.extra ? fT(e.extra) : '–'}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', color: '#6b7280' }}>{fT(ins)}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>{e.noPunch ? '–' : fT(total)}</td>
                          <td style={{ padding: '8px 12px' }}>{e.loc || '–'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}

              {resultTab === 'dept' && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#fafaf8' }}>
                      {['門市','正職','工讀','出勤時數','人事成本'].map(h => (
                        <th key={h} style={{ padding: '9px 12px', textAlign: h === '門市' ? 'left' : 'right', color: '#6b7280', fontWeight: 600, borderBottom: '1.5px solid #e8e6e1' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {depts.map(dept => {
                      const d = deptMap[dept]
                      return (
                        <tr key={dept} style={{ borderBottom: '1px solid #f0eee9' }}>
                          <td style={{ padding: '8px 12px', fontWeight: 600 }}>{dept}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{d.ft}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{d.pt}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fH(d.totalH)}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>{fT(d.cost)}</td>
                        </tr>
                      )
                    })}
                    <tr style={{ background: '#fafaf8', fontWeight: 700 }}>
                      <td style={{ padding: '8px 12px' }}>合計</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>{ftCount}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>{ptCount}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fH(totalH)}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fT(totalCost)}</td>
                    </tr>
                  </tbody>
                </table>
              )}

              {resultTab === 'store' && (
                storeDist.length === 0 ? (
                  <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
                    需上傳地點紀錄才能計算分店分攤
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: '#fafaf8' }}>
                        {['分店','正職','工讀','出勤H','內場H','外場H','分攤成本'].map(h => (
                          <th key={h} style={{ padding: '9px 12px', textAlign: h === '分店' ? 'left' : 'right', color: '#6b7280', fontWeight: 600, borderBottom: '1.5px solid #e8e6e1' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {storeDist.map(s => (
                        <tr key={s.cat} style={{ borderBottom: '1px solid #f0eee9' }}>
                          <td style={{ padding: '8px 12px', fontWeight: 600 }}>{s.cat}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{s.ft}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{s.pt}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fH(s.totalH)}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fH(s.innerH)}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fH(s.outerH)}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>{fT(s.totalCost)}</td>
                        </tr>
                      ))}
                      <tr style={{ background: '#fafaf8', fontWeight: 700 }}>
                        <td style={{ padding: '8px 12px' }}>合計</td>
                        <td colSpan={2} style={{ padding: '8px 12px' }} />
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fH(storeDist.reduce((s, d) => s + d.totalH, 0))}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fH(storeDist.reduce((s, d) => s + d.innerH, 0))}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fH(storeDist.reduce((s, d) => s + d.outerH, 0))}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fT(storeDist.reduce((s, d) => s + d.totalCost, 0))}</td>
                      </tr>
                    </tbody>
                  </table>
                )
              )}

              {resultTab === 'anom' && (
                (calcResult?.anom.length || 0) === 0 ? (
                  <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>✓ 無異常</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: '#fafaf8' }}>
                        {['嚴重度','類型','工號','姓名','日期','說明'].map(h => (
                          <th key={h} style={{ padding: '9px 12px', textAlign: 'left', color: '#6b7280', fontWeight: 600, borderBottom: '1.5px solid #e8e6e1' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {calcResult?.anom.map((a, i) => {
                        const sevBg = a.sev === 'error' ? '#fee2e2' : a.sev === 'warn' ? '#fef3c7' : '#dbeafe'
                        const sevColor = a.sev === 'error' ? '#dc2626' : a.sev === 'warn' ? '#d97706' : '#2563eb'
                        return (
                          <tr key={i} style={{ borderBottom: '1px solid #f0eee9' }}>
                            <td style={{ padding: '8px 12px' }}>
                              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 20, background: sevBg, color: sevColor }}>
                                {a.sev === 'error' ? '錯誤' : a.sev === 'warn' ? '警告' : '資訊'}
                              </span>
                            </td>
                            <td style={{ padding: '8px 12px' }}>{a.type}</td>
                            <td style={{ padding: '8px 12px', color: '#9ca3af' }}>{a.id}</td>
                            <td style={{ padding: '8px 12px', fontWeight: 600 }}>{a.name}</td>
                            <td style={{ padding: '8px 12px' }}>{a.date}</td>
                            <td style={{ padding: '8px 12px', color: '#6b7280' }}>{a.detail}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
