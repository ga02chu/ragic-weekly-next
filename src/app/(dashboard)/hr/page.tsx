'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { getMonthlyStdH, fetchAllRecords, getFields } from '@/lib/ragic/fetchRecords'
import { processRecords } from '@/lib/ragic/processRecords'
import { fmt } from '@/lib/ragic/utils'
import {
  parsePay, parseAtt, parseLoc, parseAdj, parseBreak, buildBreakMap,
  adjDeltaForMonth, adjExtrasForMonth, empPfForMonth, calcResults, computeStoreDist,
  holidayPayForMonth, compHoursIdMap, latePenaltyForMonth, birthdayBonusForMonth,
  foreignerIdsFromNames, mergeExtras, emptyAdj, adjTargetMonth,
  fT, fH,
  type HREmployee, type AttResult, type LocRecord, type BreakRecord, type CalcResult,
  type ParsedAdjustments,
} from '@/lib/hr/calc'


function rehydratePay(raw: HREmployee[]): HREmployee[] {
  return raw.map(p => ({
    ...p,
    hireDate: p.hireDate ? new Date(p.hireDate as unknown as string) : null,
    birthday: p.birthday ? new Date(p.birthday as unknown as string) : null,
  }))
}
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

  // 進入週報模式且日期未設定 → 自動帶入「本月至今」
  useEffect(() => {
    if (viewMode !== 'week') return
    if (dateFrom && dateTo) return
    const today = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const y = today.getFullYear(), m = today.getMonth() + 1
    setYear(y); setMonth(m)
    setDateFrom(`${y}-${pad(m)}-01`)
    setDateTo(`${y}-${pad(m)}-${pad(today.getDate())}`)
  }, [viewMode, dateFrom, dateTo])
  const [excludeMgmt, setExcludeMgmt] = useState(false)
  const [resultTab, setResultTab] = useState<ResultTab>('employees')

  const [pay, setPay] = useState<HREmployee[]>([])
  const [att, setAtt] = useState<AttResult | null>(null)
  const [loc, setLoc] = useState<LocRecord[]>([])
  const [adj, setAdj] = useState<ParsedAdjustments>(emptyAdj)
  const [brk, setBrk] = useState<BreakRecord[]>([])
  // 區塊摺疊狀態
  const [uploadOpen, setUploadOpen] = useState(true)
  const [adjSummaryOpen, setAdjSummaryOpen] = useState(false)
  // 常用區間 preset 選中狀態
  const [activePreset, setActivePreset] = useState<'mtd' | 'lastSun' | 'lastWeek' | null>(null)
  const [fileStatus, setFileStatus] = useState<Record<FileKey, FileStatus>>({ pay: 'idle', att: 'idle', loc: 'idle', adj: 'idle', brk: 'idle' })
  const [parseErr, setParseErr] = useState<Record<FileKey, string>>({ pay: '', att: '', loc: '', adj: '', brk: '' })
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [chartData, setChartData] = useState<{ name: string; rev: number; cost: number }[]>([])

  useEffect(() => {
    try {
      const s = (k: string) => { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null }
      const sp = s('hr_data_pay'); if (sp) { setPay(rehydratePay(sp)); setFileStatus(p => ({ ...p, pay: 'loaded' })) }
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

      if (viewMode === 'month') {
        sDate = monthStart; eDate = monthEnd; pf = 1
      } else {
        // 週報模式：日期空時預設「本月 1 號到今天」
        const today = new Date()
        let s = dateFrom ? new Date(dateFrom) : monthStart
        let e = dateTo ? new Date(dateTo) : (today < monthEnd ? today : monthEnd)
        // 裁切到選定月份：避免跨月範圍使 pf 被夾為 1
        if (s < monthStart) s = monthStart
        if (e > monthEnd) e = monthEnd
        sDate = s; eDate = e
        if (eDate < sDate) { sDate = monthStart; eDate = monthEnd }
        const periodDays = Math.round((eDate.getTime() - sDate.getTime()) / 86400000) + 1
        pf = Math.min(1, Math.max(0.01, periodDays / totalDays))
      }

      const adjMap = adjDeltaForMonth(year, month, adj.records, pay)

      // 判斷調整表是哪個月，與計算月份不符時不套用月份敏感的加扣項
      const adjTM = adjTargetMonth(adj)
      const adjMonthMatches = !adjTM || (adjTM.year === year && adjTM.month === month)

      // 把所有來源的 extras 全部 merge 在一起
      const breakMap = buildBreakMap(brk)
      const lateRes = adjMonthMatches ? latePenaltyForMonth(adj.lates, pay) : { extras: { extras: {}, details: {} }, ptZeroIds: new Set<string>() }
      // 國定假日加給：限制在當前計算月（避免跨月區間誤套到別月的清明等）
      const holidaysInMonth = adjMonthMatches
        ? adj.holidays.filter(h => h.date && h.date.getFullYear() === year && h.date.getMonth() + 1 === month)
        : []
      const merged = mergeExtras(
        // 舊：att 的加扣項
        { extras: att.extras || {}, details: att.extrasDetail || {} },
        // 調整表 其他加扣（月份對才套）
        adjMonthMatches
          ? (adjExtrasForMonth(adj.records, pay) as { extras: Record<string, number>; details: Record<string, { code: string; desc: string; amt: number; note: string }[]> })
          : { extras: {}, details: {} },
        // 國定假日加給（已過濾到當前月）
        holidayPayForMonth(holidaysInMonth, pay, att, breakMap),
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

      // 加班換補休：傳 id map 進 calcResults 內，依實際 otH 扣（沒加班費就不扣）
      // 月份不符時不套用
      const compHIdM = adjMonthMatches ? compHoursIdMap(adj.compHours, pay) : {}

      const result = calcResults(
        sDate, eDate, storeFilter, stdH, pf, adjMap, excludeMgmt, locFilter,
        pay, mergedAtt, loc, {}, breakMap, empPfMap, foreignerIds, lateRes.ptZeroIds, compHIdM,
      )
      setCalcResult(result)
      const dist = computeStoreDist(result.results, result.locR, brk)
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

  // 週報視角：基於目前期間 pf 線性外推月底估值
  const monthDays = new Date(year, month, 0).getDate()
  const pfActual = (() => {
    if (!isWeek || !dateFrom || !dateTo) return 1
    // 把日期範圍裁切到選定月份（避免跨月時 pf 被誇大）
    const monthS = new Date(year, month - 1, 1)
    const monthE = new Date(year, month, 0)
    const f = new Date(dateFrom)
    const t = new Date(dateTo)
    const ef = f > monthS ? f : monthS
    const et = t < monthE ? t : monthE
    if (ef > et) return 0.01
    const days = Math.round((et.getTime() - ef.getTime()) / 86400000) + 1
    return Math.max(0.01, Math.min(1, days / monthDays))
  })()
  const projectMonthEnd = (val: number) => pfActual > 0 && pfActual < 1 ? val / pfActual : val
  const projTotalCost = isWeek
    ? results.reduce((s, e) => {
        if (e.type === '月薪正職') {
          // 月薪：固定薪整月固定、加扣項月固定（生日/加給/考績扣）、OT 線性外推、保費月固定
          return s + e.fixedSalary + (e.extra || 0) + projectMonthEnd(e.weekOtPay || 0) + (e.propIns || 0)
        } else {
          // 工讀：base+ot 都是時薪×時數，線性外推。注意 propSal 已含 extras（生日禮金等月固定）
          // 為避免月固定項被外推，把 extras 拆出來不外推
          const variableSal = (e.propSal || 0) - (e.extra || 0)
          return s + projectMonthEnd(variableSal) + (e.extra || 0) + (e.propIns || 0)
        }
      }, 0)
    : totalCost
  const projOtCost = isWeek
    ? results.reduce((s, e) => s + (e.type === '月薪正職' ? projectMonthEnd(e.weekOtPay || 0) : 0), 0)
    : results.reduce((s, e) => s + (e.type === '月薪正職' ? (e.weekOtPay || 0) : 0), 0)
  const insCost = results.reduce((s, e) => s + (e.propIns || 0), 0)

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

      {/* 1. 人事成本佔比明細（最上方主視覺） */}
      {hasResult ? (() => {
        const salTotal = results.reduce((s, e) => s + (e.propSal || 0), 0)
        const otTotal = results.reduce((s, e) => s + (e.type === '月薪正職' ? (e.weekOtPay || 0) : 0), 0)
        const insTotal = results.reduce((s, e) => s + (e.propIns || 0), 0)
        const holi6002 = results.reduce((s, e) => s + (e.extraDetail?.filter(d => d.code === '6002') || []).reduce((a, b) => a + b.amt, 0), 0)
        const annual20032 = results.reduce((s, e) => s + (e.extraDetail?.filter(d => d.code === '20032') || []).reduce((a, b) => a + b.amt, 0), 0)
        const COUNTED_CODES = new Set(['6002', '20032'])
        const otherExtras = results.reduce((s, e) => s + (e.extraDetail?.filter(d => !COUNTED_CODES.has(d.code)) || []).reduce((a, b) => a + b.amt, 0), 0)
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
          <div style={{ marginBottom: 20 }}>
            {/* 合計卡片（強調，置頂） */}
            <div style={{
              background: `linear-gradient(135deg, ${BRAND} 0%, #5c4040 100%)`,
              borderRadius: 12, padding: '20px 24px', color: '#fff', marginBottom: 12,
              display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16,
            }}>
              <div>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{isWeek ? '期間人事成本（至今）' : '月人事成本合計'}</div>
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
            {/* 細項卡片 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
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
          </div>
        )
      })() : (
        <div style={{ background: '#fafaf8', border: '1px dashed #e5e7eb', borderRadius: 12, padding: '32px 24px', marginBottom: 20, textAlign: 'center', color: '#9ca3af' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
          <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 4 }}>人事成本佔比明細</div>
          <div style={{ fontSize: 12 }}>下方上傳資料 + 計算後，這裡會顯示總覽卡片</div>
        </div>
      )}

      {/* 2. 上傳區域（可摺疊） */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e6e1', marginBottom: 16 }}>
        <div onClick={() => setUploadOpen(o => !o)}
          style={{ padding: '14px 20px', borderBottom: uploadOpen ? '1px solid #e8e6e1' : 'none', fontWeight: 600, color: '#1a2f4e', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, userSelect: 'none' }}>
          <span style={{ fontSize: 12, transition: 'transform .2s', transform: uploadOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
          <span>Excel 檔案上傳</span>
          {!uploadOpen && (
            <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 400, marginLeft: 'auto' }}>
              已載入 薪資 {pay.length} · 出勤 {att?.records.length || 0} · 打卡 {loc.length} · 休息 {brk.length} · 調整 {adj.records.length}
              {savedAt && ` · ✓ 上次記憶 ${new Date(savedAt).toLocaleDateString('zh-TW')}`}
            </span>
          )}
        </div>
        {uploadOpen && <div style={{ padding: '16px 20px' }}>
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
            {(() => {
              const tm = adjTargetMonth(adj)
              if (!tm) return null
              const matches = tm.year === year && tm.month === month
              return (
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: matches ? '#dcfce7' : '#fef3c7', color: matches ? '#166534' : '#92400e' }}>
                  {matches ? '✓' : '⚠'} 調整表為 {tm.year}/{tm.month} 月{!matches && `（不符當前 ${year}/${month}，月份相關加扣不套用）`}
                </span>
              )
            })()}
            {savedAt && (
              <span style={{ color: '#16a34a', fontSize: 11 }}>
                ✓ 上次記憶：{new Date(savedAt).toLocaleDateString('zh-TW')} {new Date(savedAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>}
      </div>

      {/* 3. 計算設定（篩選區間） */}
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
              <button onClick={() => setViewMode('month')} style={btnStyle(viewMode === 'month')}>整月結算</button>
              <button onClick={() => setViewMode('week')} style={btnStyle(viewMode === 'week')}>週報（至今+預估）</button>
            </div>
          </div>
          {viewMode === 'week' && (
            <>
              <div>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>開始日</div>
                <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setActivePreset(null) }}
                  style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>結束日</div>
                <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setActivePreset(null) }}
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
        {viewMode === 'week' && (() => {
          const chipStyle = (active: boolean): React.CSSProperties => ({
            padding: '3px 12px', borderRadius: 14,
            border: `1.5px solid ${active ? BRAND : '#e5e7eb'}`,
            background: active ? BRAND : '#fff',
            color: active ? '#fff' : '#374151',
            fontSize: 11, fontWeight: active ? 600 : 400, cursor: 'pointer',
          })
          return (
            <div style={{ padding: '0 20px 14px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: '#6b7280' }}>常用區間：</span>
              <button onClick={() => {
                const today = new Date()
                const pad = (n: number) => String(n).padStart(2, '0')
                const y = today.getFullYear(), m = today.getMonth() + 1
                setYear(y); setMonth(m)
                setDateFrom(`${y}-${pad(m)}-01`)
                setDateTo(`${y}-${pad(m)}-${pad(today.getDate())}`)
                setActivePreset('mtd')
              }} style={chipStyle(activePreset === 'mtd')}>本月至今</button>
              <button onClick={() => {
                const today = new Date()
                const pad = (n: number) => String(n).padStart(2, '0')
                const y = today.getFullYear(), m = today.getMonth() + 1
                const dow = today.getDay()
                const lastSun = new Date(today); lastSun.setDate(today.getDate() - (dow === 0 ? 7 : dow))
                const sunInThisMonth = lastSun.getMonth() + 1 === m && lastSun.getFullYear() === y
                setYear(y); setMonth(m)
                setDateFrom(`${y}-${pad(m)}-01`)
                setDateTo(sunInThisMonth ? `${y}-${pad(m)}-${pad(lastSun.getDate())}` : `${y}-${pad(m)}-01`)
                setActivePreset('lastSun')
              }} style={chipStyle(activePreset === 'lastSun')}>月初至上週日</button>
              <button onClick={() => {
                const today = new Date()
                const pad = (n: number) => String(n).padStart(2, '0')
                const dow = today.getDay()
                const lastSun = new Date(today); lastSun.setDate(today.getDate() - (dow === 0 ? 7 : dow))
                const lastMon = new Date(lastSun); lastMon.setDate(lastSun.getDate() - 6)
                setYear(lastSun.getFullYear()); setMonth(lastSun.getMonth() + 1)
                setDateFrom(`${lastMon.getFullYear()}-${pad(lastMon.getMonth() + 1)}-${pad(lastMon.getDate())}`)
                setDateTo(`${lastSun.getFullYear()}-${pad(lastSun.getMonth() + 1)}-${pad(lastSun.getDate())}`)
                setActivePreset('lastWeek')
              }} style={chipStyle(activePreset === 'lastWeek')}>上週</button>
            </div>
          )
        })()}
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
            const totalApplied = items.reduce((s, it) => s + it.n, 0)
            return (
              <div style={{ background: '#fef9c3', border: '1px solid #fde047', borderRadius: 12, marginBottom: 16 }}>
                <div onClick={() => setAdjSummaryOpen(o => !o)}
                  style={{ padding: '12px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, userSelect: 'none' }}>
                  <span style={{ fontSize: 12, color: '#713f12', transition: 'transform .2s', transform: adjSummaryOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                  <span style={{ fontWeight: 600, color: '#713f12', fontSize: 13 }}>📋 本月套用的調整</span>
                  <span style={{ fontSize: 11, color: '#a16207', marginLeft: 'auto' }}>
                    共 {totalApplied} 筆 · {items.filter(it => it.n > 0).map(it => it.label).join(' / ') || '無'}
                  </span>
                </div>
                {adjSummaryOpen && (
                  <div style={{ padding: '0 18px 14px' }}>
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
                )}
              </div>
            )
          })()}

          {/* 佔比明細已搬到頁面最上方 */}

          {/* 週報模式專屬：至今 vs 預估月底對照卡 */}
          {isWeek && (
            <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e6e1', padding: '16px 20px', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, color: '#1a2f4e', fontSize: 14 }}>📊 週報視角</span>
                <span style={{ fontSize: 12, color: '#6b7280' }}>{dateFrom} ～ {dateTo}（{year}/{month} 月）</span>
                <span style={{ fontSize: 11, color: '#9ca3af' }}>已涵蓋 {(pfActual * 100).toFixed(0)}% 月份（{Math.round(pfActual * monthDays)}/{monthDays} 天）</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                {[
                  { label: '至今人事成本', cur: totalCost, proj: projTotalCost, color: '#3c2929' },
                  { label: '加班費', cur: results.reduce((s, e) => s + (e.type === '月薪正職' ? (e.weekOtPay || 0) : 0), 0), proj: projOtCost, color: '#f59e0b', subText: '月底預估' },
                  { label: '保費（月固定）', cur: insCost, proj: insCost, color: '#10b981', noProj: true },
                ].map(it => (
                  <div key={it.label} style={{ background: '#fafaf8', borderRadius: 10, padding: '12px 14px', borderLeft: `3px solid ${it.color}` }}>
                    <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>{it.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2f4e' }}>{fT(it.cur)}</div>
                    {!it.noProj && (
                      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                        預估月底 <span style={{ color: it.color, fontWeight: 600 }}>{fT(it.proj)}</span>
                      </div>
                    )}
                    {it.noProj && (
                      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>不依週期比例縮減</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* KPI */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
            {[
              { label: '正職人數', val: `${ftCount} 人`, est: false },
              { label: '工讀人數', val: `${ptCount} 人`, est: false },
              { label: isWeek ? '至今出勤時數' : '總出勤時數', val: fH(totalH), est: false },
              { label: isWeek ? '預估月底人事成本' : '月人事成本', val: fT(isWeek ? projTotalCost : totalCost), est: isWeek },
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
                      {['工號','姓名','門市','類型','時薪','工時（實際/應執勤）', '基本工資',
                        isWeek ? '預估加班費' : '加班費', '加扣項',
                        isWeek ? '期間保費' : '保費', isWeek ? '期間成本' : '人事成本'].map(h => (
                        <th key={h} style={{ padding: '9px 12px', textAlign: ['工號','姓名','門市'].includes(h) ? 'left' : 'right', color: h === '期間保費' || h === '期間成本' ? '#16a34a' : h === '預估加班費' ? '#f59e0b' : '#6b7280', fontWeight: 600, borderBottom: '1.5px solid #e8e6e1', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {results.map(e => {
                      const isFT = e.type === '月薪正職'
                      // 加班費：FT 用 weekOtPay/otPay；PT 用 ptDailyOt（每日超過 8H 的加班費總和）
                      // 整月結算 = 實際；週報模式 = 預估月底（線性外推）
                      const otActual = isFT
                        ? (isWeek ? (e.weekOtPay || 0) : (e.otPay || 0))
                        : (e.ptDailyOt || 0)
                      const otShown = isWeek ? projectMonthEnd(otActual) : otActual
                      const ins = e.propIns || 0
                      // 基本工資：FT=propSal；PT=propSal - extras - ptDailyOt（剝離加扣與加班費，純 base+資深加給+門檻獎金）
                      const baseSal = isFT
                        ? (e.propSal || 0)
                        : Math.max(0, (e.propSal || 0) - (e.extra || 0) - (e.ptDailyOt || 0))
                      // 加扣項：週報模式只顯示生日禮金，其他項都歸 0；整月結算才完整顯示
                      const filteredExtraDetail = isWeek
                        ? (e.extraDetail || []).filter(d => d.desc === '生日禮金')
                        : (e.extraDetail || [])
                      const filteredExtraAmt = isWeek
                        ? filteredExtraDetail.reduce((s, d) => s + d.amt, 0)
                        : (e.extra || 0)
                      // 期間成本：週報模式 = 基本工資 + 期間保費（只算這兩項）；整月 = 全部
                      const total = isWeek
                        ? baseSal + ins
                        : baseSal + otActual + (e.extra || 0) + ins
                      // 工時進度：FT 用實際/應執勤
                      const expectedH = isFT ? (isWeek ? e.weekStd : e.eStd) : 0
                      const pct = expectedH > 0 ? (e.totalH / expectedH * 100) : 0
                      const progBg = !isFT ? '' : pct >= 100 ? '#fee2e2' : pct >= 80 ? '#fef3c7' : '#dcfce7'
                      const progColor = !isFT ? '' : pct >= 100 ? '#991b1b' : pct >= 80 ? '#92400e' : '#166534'
                      const arrow = pct >= 100 ? '↑' : '↓'
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
                          <td style={{ padding: '8px 12px', textAlign: 'right', color: isFT ? '#cbd5e1' : '#6b7280', fontStyle: isFT ? 'italic' : 'normal' }}>
                            {isFT ? fT(e.hr) : (e.hourlyRate > 0 ? `$${e.hourlyRate}` : '–')}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                            {isFT && expectedH > 0 ? (
                              <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 6, background: progBg, color: progColor, fontWeight: 600 }}>
                                {fH(e.totalH)} / {fH(expectedH)} {arrow}{pct.toFixed(0)}%
                              </span>
                            ) : (
                              <span>{fH(e.totalH)}</span>
                            )}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontStyle: isWeek ? 'italic' : 'normal' }}>
                            {e.noPunch ? '–' : `${isWeek ? '~' : ''}${fT(baseSal)}`}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', color: otShown > 0 ? '#f59e0b' : '#9ca3af', fontStyle: isWeek ? 'italic' : 'normal' }}>
                            {otShown > 0 ? `${isWeek ? '~' : ''}${fT(otShown)}` : '–'}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', color: filteredExtraAmt > 0 ? '#16a34a' : filteredExtraAmt < 0 ? '#dc2626' : '#9ca3af' }}>
                            {filteredExtraAmt ? fT(filteredExtraAmt) : '–'}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', color: '#16a34a', fontStyle: isWeek ? 'italic' : 'normal' }}>
                            {isWeek ? '~' : ''}{fT(ins)}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: '#1a2f4e' }}>
                            {e.noPunch ? '–' : `${isWeek ? '~' : ''}${fT(total)}`}
                          </td>
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
                  <>
                    {/* 卡片版 — 方便秘書複製貼上 */}
                    <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                      {storeDist.map(s => (
                        <div key={s.cat} style={{ background: '#fafaf8', border: '1px solid #e8e6e1', borderRadius: 10, padding: '14px 16px' }}>
                          <div style={{ fontWeight: 700, color: '#1a2f4e', fontSize: 14, marginBottom: 10 }}>[{s.cat}]</div>

                          {/* 正職區塊 */}
                          <div style={{ marginBottom: 8 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid #e0f2fe' }}>
                              <span style={{ fontWeight: 600, color: '#0369a1' }}>正職</span>
                              <span style={{ fontWeight: 700, color: '#0369a1' }}>{s.ftH.toFixed(2)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '3px 0 3px 12px', color: '#6b7280' }}>
                              <span>├ 內場</span><span>{s.ftInnerH.toFixed(2)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '3px 0 3px 12px', color: '#6b7280' }}>
                              <span>└ 外場</span><span>{s.ftOuterH.toFixed(2)}</span>
                            </div>
                          </div>

                          {/* 工讀區塊 */}
                          <div style={{ marginBottom: 8 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid #fef3c7' }}>
                              <span style={{ fontWeight: 600, color: '#854d0e' }}>工讀</span>
                              <span style={{ fontWeight: 700, color: '#854d0e' }}>{s.ptH.toFixed(2)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '3px 0 3px 12px', color: '#6b7280' }}>
                              <span>├ 內場</span><span>{s.ptInnerH.toFixed(2)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '3px 0 3px 12px', color: '#6b7280' }}>
                              <span>└ 外場</span><span>{s.ptOuterH.toFixed(2)}</span>
                            </div>
                          </div>

                          {/* 總時數 */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0 0', borderTop: '1px solid #e8e6e1' }}>
                            <span style={{ fontWeight: 600 }}>總時數</span>
                            <span style={{ fontWeight: 700, color: '#1a2f4e' }}>{s.totalH.toFixed(2)}</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* 一鍵複製文字（秘書貼到別處用） */}
                    <div style={{ padding: '0 20px 16px' }}>
                      <button onClick={() => {
                        const text = storeDist.map(s =>
                          `[${s.cat}]\n正職： ${s.ftH.toFixed(2)} (內場 ${s.ftInnerH.toFixed(2)} / 外場 ${s.ftOuterH.toFixed(2)})\n工讀： ${s.ptH.toFixed(2)} (內場 ${s.ptInnerH.toFixed(2)} / 外場 ${s.ptOuterH.toFixed(2)})\n總時數： ${s.totalH.toFixed(2)}`
                        ).join('\n\n')
                        navigator.clipboard.writeText(text).then(() => alert('已複製到剪貼簿'))
                      }} style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid #e5e7eb', background: '#fff', fontSize: 12, cursor: 'pointer', color: '#374151' }}>
                        📋 複製文字（給秘書貼）
                      </button>
                    </div>

                    {/* 詳細表格 */}
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, borderTop: '1px solid #e8e6e1' }}>
                      <thead>
                        <tr style={{ background: '#fafaf8' }}>
                          {['分店','正職人數','工讀人數','正職H','工讀H','總時數H','內場H','外場H','分攤成本'].map(h => (
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
                            <td style={{ padding: '8px 12px', textAlign: 'right', color: '#0369a1' }}>{fH(s.ftH)}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', color: '#854d0e' }}>{fH(s.ptH)}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>{fH(s.totalH)}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', color: '#9ca3af' }}>{fH(s.innerH)}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', color: '#9ca3af' }}>{fH(s.outerH)}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>{fT(s.totalCost)}</td>
                          </tr>
                        ))}
                        <tr style={{ background: '#fafaf8', fontWeight: 700 }}>
                          <td style={{ padding: '8px 12px' }}>合計</td>
                          <td colSpan={2} style={{ padding: '8px 12px' }} />
                          <td style={{ padding: '8px 12px', textAlign: 'right', color: '#0369a1' }}>{fH(storeDist.reduce((s, d) => s + d.ftH, 0))}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', color: '#854d0e' }}>{fH(storeDist.reduce((s, d) => s + d.ptH, 0))}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fH(storeDist.reduce((s, d) => s + d.totalH, 0))}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', color: '#9ca3af' }}>{fH(storeDist.reduce((s, d) => s + d.innerH, 0))}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', color: '#9ca3af' }}>{fH(storeDist.reduce((s, d) => s + d.outerH, 0))}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fT(storeDist.reduce((s, d) => s + d.totalCost, 0))}</td>
                        </tr>
                      </tbody>
                    </table>
                  </>
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
