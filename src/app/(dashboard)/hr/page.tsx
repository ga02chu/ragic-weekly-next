'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { getMonthlyStdH, fetchAllRecords, getFields } from '@/lib/ragic/fetchRecords'
import { processRecords } from '@/lib/ragic/processRecords'
import { fmt } from '@/lib/ragic/utils'
import {
  parsePay, parseAtt, parseLoc, parseAdj, parseBreak,
  computeStoreDist, computeCrossStoreDetail, detectPunchAnomalies,
  emptyAdj, adjTargetMonth, deriveTitleLoc,
  fT, fH,
  type HREmployee, type AttResult, type LocRecord, type BreakRecord, type CalcResult,
  type ParsedAdjustments, type PunchAnomaly,
} from '@/lib/hr/calc'
import { computeHr, detectPeriod } from '@/lib/hr/computeSnapshot'


interface StoreAdjustment {
  id: string
  period_start: string
  period_end: string
  kind?: 'manual' | 'reassign'
  store_cat: string | null
  delta_h: number
  // reassign 用
  from_cat?: string | null
  to_cat?: string | null
  emp_id?: string | null
  emp_name?: string | null
  src_date?: string | null
  reason: string
  created_at?: string
  created_by?: string | null
}

function rehydratePay(raw: HREmployee[]): HREmployee[] {
  return raw.map(p => ({
    ...p,
    titleLoc: deriveTitleLoc(p.title),
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
type ResultTab = 'employees' | 'dept' | 'store' | 'crossStore' | 'anom'
type FileKey = 'pay' | 'att' | 'loc' | 'adj' | 'brk'
type FileStatus = 'idle' | 'loaded' | 'error' | 'parsing'
type FileMeta = { name: string; size: number; uploadedAt: number }

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}
function fmtTimeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '剛剛'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分鐘前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小時前`
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function UploadZone({ label, icon, hint, status, meta, error, onFile, onClear }: {
  label: string
  icon: string
  hint?: string
  status: FileStatus
  meta?: FileMeta
  error?: string
  onFile: (f: File) => void
  onClear?: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const isLoaded = status === 'loaded'
  const isError = status === 'error'
  const isParsing = status === 'parsing'

  const bg = isParsing ? '#fffbeb' : isLoaded ? '#f0fdf4' : isError ? '#fef2f2' : dragOver ? '#eff6ff' : '#fafaf8'
  const border = isParsing ? '#fbbf24' : isLoaded ? '#86efac' : isError ? '#fca5a5' : dragOver ? '#3b82f6' : '#d1d5db'
  const borderStyle = dragOver || isParsing ? 'solid' : isLoaded || isError ? 'solid' : 'dashed'
  const iconColor = isParsing ? '#d97706' : isLoaded ? '#16a34a' : isError ? '#dc2626' : '#9ca3af'

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragOver(true) }
  const onDragLeave = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false) }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) onFile(file)
  }

  return (
    <div
      onClick={() => !isParsing && inputRef.current?.click()}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        position: 'relative',
        background: bg,
        border: `2px ${borderStyle} ${border}`,
        borderRadius: 10,
        padding: '14px 12px',
        cursor: isParsing ? 'wait' : 'pointer',
        textAlign: 'center',
        transition: 'all .15s',
        minHeight: 110,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 4,
      }}
    >
      <input ref={inputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
        onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />

      {/* Clear button (loaded state) */}
      {isLoaded && onClear && (
        <button
          onClick={e => { e.stopPropagation(); onClear() }}
          title="清除這個檔案"
          style={{
            position: 'absolute', top: 4, right: 4, border: 'none', background: 'transparent',
            cursor: 'pointer', color: '#9ca3af', fontSize: 16, padding: '0 6px', lineHeight: 1,
          }}
        >×</button>
      )}

      {/* Icon */}
      <div style={{ fontSize: 22, lineHeight: 1, color: iconColor }}>
        {isParsing ? <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⏳</span>
          : isLoaded ? '✓'
          : isError ? '⚠'
          : dragOver ? '⬇'
          : icon}
      </div>

      {/* Label */}
      <div style={{ fontSize: 13, fontWeight: 600, color: '#1a2f4e' }}>{label}</div>

      {/* Status content */}
      {isParsing ? (
        <div style={{ fontSize: 11, color: '#d97706', fontWeight: 600 }}>解析中…</div>
      ) : isLoaded && meta ? (
        <>
          <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 600, wordBreak: 'break-all', lineHeight: 1.3 }} title={meta.name}>
            {meta.name.length > 26 ? meta.name.slice(0, 24) + '…' : meta.name}
          </div>
          <div style={{ fontSize: 10, color: '#6b7280' }}>
            {fmtBytes(meta.size)} · {fmtTimeAgo(meta.uploadedAt)}
          </div>
        </>
      ) : isError ? (
        <div style={{ fontSize: 11, color: '#dc2626', wordBreak: 'break-all' }}>{error || '解析失敗'}</div>
      ) : (
        <div style={{ fontSize: 11, color: '#6b7280' }}>{dragOver ? '放開以上傳' : hint || '點擊或拖拉 .xlsx'}</div>
      )}

      <style>{`@keyframes spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }`}</style>
    </div>
  )
}

function BatchDropZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const files = Array.from(e.dataTransfer.files || [])
    if (files.length) onFiles(files)
  }
  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={e => { e.preventDefault(); setDragOver(false) }}
      onDrop={handleDrop}
      style={{
        background: dragOver ? '#eff6ff' : '#fafaf8',
        border: `2px ${dragOver ? 'solid' : 'dashed'} ${dragOver ? '#3b82f6' : '#cbd5e1'}`,
        borderRadius: 12,
        padding: '20px 16px',
        marginBottom: 14,
        cursor: 'pointer',
        textAlign: 'center',
        transition: 'all .15s',
      }}
    >
      <input ref={inputRef} type="file" accept=".xlsx,.xls" multiple style={{ display: 'none' }}
        onChange={e => { const fs = Array.from(e.target.files || []); if (fs.length) onFiles(fs); e.target.value = '' }} />
      <div style={{ fontSize: 24, marginBottom: 4 }}>{dragOver ? '⬇' : '📥'}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#1a2f4e', marginBottom: 4 }}>
        {dragOver ? '放開以一次上傳所有檔案' : '一次拖拉所有 Excel 檔到這裡'}
      </div>
      <div style={{ fontSize: 11, color: '#6b7280' }}>
        系統會依檔名關鍵字自動分類（出勤 / 打卡 / 休息）
      </div>
    </div>
  )
}

// HR 系統正式結算的店 ↔ 週報分店分攤類別對映（台北在正式結算不分明曜/仁愛）
const OFFICIAL_STORE_MAP: { store: string; cats: string[] }[] = [
  { store: '料韓男台北', cats: ['品牌概念店', '料韓男2號店'] },
  { store: '料韓男3號店', cats: ['料韓男3號店'] },
  { store: '英洙家', cats: ['英洙家'] },
]

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

  // HR 系統該月正式結算（每店加總），沒有結算時為 null
  const [official, setOfficial] = useState<Record<string, { gross: number; ins: number; cost: number }> | null>(null)
  useEffect(() => {
    let alive = true
    setOfficial(null)
    fetch(`/api/hr-official?year=${year}&month=${month}`)
      .then(r => r.json())
      .then(res => {
        if (alive && res?.stores && Object.keys(res.stores).length > 0) setOfficial(res.stores)
      })
      .catch(() => { /* 讀不到就不顯示對帳卡 */ })
    return () => { alive = false }
  }, [year, month])

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
  const [fileMeta, setFileMeta] = useState<Record<FileKey, FileMeta | undefined>>({ pay: undefined, att: undefined, loc: undefined, adj: undefined, brk: undefined })
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [chartData, setChartData] = useState<{ name: string; rev: number; cost: number }[]>([])

  // 進場時自動從 HR 系統帶最新薪資保險現值（rehydrate 完才跑，避免被雲端舊資料蓋回去）
  const loadPayFromHRRef = useRef<() => void>(() => {})

  // 雲端=唯一真實來源；localStorage 只當離線快取/初次 paint。
  // 進場流程：先從 /api/hr-raw 抓最新，cloud 有→ override local；cloud 沒→ 清掉舊 local；
  // cloud 掛掉→ 退而 fallback localStorage。
  useEffect(() => {
    let aborted = false
    const loadFromLocal = () => {
      try {
        const s = (k: string) => { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null }
        const sp = s('hr_data_pay'); if (sp) { setPay(rehydratePay(sp)); setFileStatus(p => ({ ...p, pay: 'loaded' })) }
        const sa = s('hr_data_att'); if (sa) { setAtt(rehydrateAtt(sa)); setFileStatus(p => ({ ...p, att: 'loaded' })) }
        const sl = s('hr_data_loc'); if (sl) { setLoc(rehydrateLoc(sl)); setFileStatus(p => ({ ...p, loc: 'loaded' })) }
        const sb = s('hr_data_brk'); if (sb) { setBrk(sb); setFileStatus(p => ({ ...p, brk: 'loaded' })) }
        // 調整表已停用（月結都在 HR 系統做），不再載入舊資料
        const sm = s('hr_data_meta'); if (sm?.timestamp) setSavedAt(sm.timestamp)
        const keys: FileKey[] = ['pay', 'att', 'loc', 'adj', 'brk']
        const nextMeta: Record<FileKey, FileMeta | undefined> = { pay: undefined, att: undefined, loc: undefined, adj: undefined, brk: undefined }
        keys.forEach(k => {
          const m = s(`hr_meta_${k}`)
          if (m && typeof m.name === 'string') nextMeta[k] = m as FileMeta
        })
        setFileMeta(nextMeta)
      } catch { /* ignore */ }
    }

    // 先樂觀畫一版（避免一進來空白）
    loadFromLocal()

    // 再從雲端覆蓋
    fetch('/api/hr-raw').then(r => r.json()).then(({ uploads, error }) => {
      if (aborted) return
      if (error || !Array.isArray(uploads)) throw new Error(error || 'bad response')
      const byKey: Record<string, { file_key: FileKey; data: unknown; meta: FileMeta | null; uploaded_at: string }> = {}
      uploads.forEach((u: { file_key: FileKey; data: unknown; meta: FileMeta | null; uploaded_at: string }) => {
        byKey[u.file_key] = u
      })

      const applyState = <T,>(key: FileKey, raw: unknown, setData: (v: T) => void, rehydrate?: (r: unknown) => T) => {
        const v = (rehydrate ? rehydrate(raw) : raw) as T
        setData(v)
      }
      const applyOrClear = (key: FileKey, clearFn: () => void) => {
        const u = byKey[key]
        if (u) {
          if (key === 'pay') applyState<HREmployee[]>(key, u.data, setPay, (r) => rehydratePay(r as HREmployee[]))
          else if (key === 'att') applyState<AttResult>(key, u.data, setAtt, (r) => rehydrateAtt(r as AttResult))
          else if (key === 'loc') applyState<LocRecord[]>(key, u.data, setLoc, (r) => rehydrateLoc(r as LocRecord[]))
          else if (key === 'adj') applyState<ParsedAdjustments>(key, u.data, setAdj, (r) => rehydrateAdj(r))
          else applyState<BreakRecord[]>(key, u.data, setBrk)
          setFileStatus(p => ({ ...p, [key]: 'loaded' }))
          if (u.meta && typeof u.meta.name === 'string') setFileMeta(p => ({ ...p, [key]: u.meta as FileMeta }))
          try {
            localStorage.setItem(`hr_data_${key}`, JSON.stringify(u.data))
            if (u.meta) localStorage.setItem(`hr_meta_${key}`, JSON.stringify(u.meta))
          } catch { /* ignore */ }
        } else {
          // 雲端沒有 → 清掉本機殘留
          clearFn()
          setFileStatus(p => ({ ...p, [key]: 'idle' }))
          setFileMeta(p => ({ ...p, [key]: undefined }))
          try {
            localStorage.removeItem(`hr_data_${key}`)
            localStorage.removeItem(`hr_meta_${key}`)
          } catch { /* ignore */ }
        }
      }

      applyOrClear('pay', () => setPay([]))
      applyOrClear('att', () => setAtt(null))
      applyOrClear('loc', () => setLoc([]))
      // 調整表已停用，雲端殘留也不套用
      applyOrClear('brk', () => setBrk([]))

      if (uploads.length) {
        const latest = Math.max(...uploads.map((u: { uploaded_at: string }) => new Date(u.uploaded_at).getTime()))
        setSavedAt(latest)
        try { localStorage.setItem('hr_data_meta', JSON.stringify({ timestamp: latest })) } catch { /* ignore */ }
      } else {
        setSavedAt(null)
        try { localStorage.removeItem('hr_data_meta') } catch { /* ignore */ }
      }
      // rehydrate 完成後再用 HR 系統現值覆蓋薪資保險（HR 為正解）
      if (!aborted) loadPayFromHRRef.current()
    }).catch(() => {
      // 雲端掛掉時保留剛剛樂觀載入的 local；薪資保險仍嘗試連 HR 系統
      if (!aborted) loadPayFromHRRef.current()
    })

    return () => { aborted = true }
  }, [])

  const [calcResult, setCalcResult] = useState<CalcResult | null>(null)
  const [storeDist, setStoreDist] = useState<ReturnType<typeof computeStoreDist>>([])
  const [crossStore, setCrossStore] = useState<ReturnType<typeof computeCrossStoreDetail>>([])
  const [punchAnom, setPunchAnom] = useState<{ anomalies: PunchAnomaly[]; suspectH: number }>({ anomalies: [], suspectH: 0 })
  // C. 分店分攤手動調整
  const [storeAdj, setStoreAdj] = useState<StoreAdjustment[]>([])
  const [adjForm, setAdjForm] = useState<{ store: string; delta: string; reason: string }>({ store: '品牌概念店', delta: '', reason: '' })
  const [adjBusy, setAdjBusy] = useState(false)
  // 異常分頁「逐筆改歸」：每列下拉選的目標店、套用中的列
  const [reassignSel, setReassignSel] = useState<Record<string, string>>({})
  const [reassignBusy, setReassignBusy] = useState('')
  const [crossOnly, setCrossOnly] = useState(true)
  const [crossFtOnly, setCrossFtOnly] = useState(true)
  const [computing, setComputing] = useState(false)
  const [compErr, setCompErr] = useState('')

  // 標記「使用者剛上傳過」→ 觸發自動計算存快照（避免進場讀雲端時也誤觸發）
  const dirtyRef = useRef(false)
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleFile = useCallback(async (key: FileKey, file: File) => {
    setParseErr(prev => ({ ...prev, [key]: '' }))
    setFileStatus(prev => ({ ...prev, [key]: 'parsing' }))
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
      const meta: FileMeta = { name: file.name, size: file.size, uploadedAt: Date.now() }
      setFileMeta(prev => ({ ...prev, [key]: meta }))
      dirtyRef.current = true   // 觸發下方「上傳後自動計算」effect
      try {
        localStorage.setItem(`hr_data_${key}`, JSON.stringify(parsed))
        localStorage.setItem(`hr_meta_${key}`, JSON.stringify(meta))
        const ts = Date.now()
        localStorage.setItem('hr_data_meta', JSON.stringify({ timestamp: ts }))
        setSavedAt(ts)
      } catch { /* storage full, ignore */ }
      // 同步上雲端（不阻塞 UI；失敗只 log，不影響本機已 parse 的結果）
      fetch('/api/hr-raw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_key: key, data: parsed, meta }),
      }).then(r => r.json()).then(res => {
        if (res?.error) console.warn('[hr-raw upload]', res.error)
      }).catch(err => console.warn('[hr-raw upload]', err))
    } catch (e: unknown) {
      setFileStatus(prev => ({ ...prev, [key]: 'error' }))
      setParseErr(prev => ({ ...prev, [key]: e instanceof Error ? e.message : '解析失敗' }))
    }
  }, [])

  // 薪資保險改從 HR 系統帶入（同資料庫 public.employees 現值），走與 handleFile 相同的後續流程
  const [hrPayBusy, setHrPayBusy] = useState(false)
  const loadPayFromHR = useCallback(async () => {
    setHrPayBusy(true)
    setParseErr(prev => ({ ...prev, pay: '' }))
    setFileStatus(prev => ({ ...prev, pay: 'parsing' }))
    try {
      const res = await fetch('/api/hr-employees').then(r => r.json())
      if (res?.error || !Array.isArray(res?.employees)) throw new Error(res?.error || '讀取 HR 系統失敗')
      const parsed = res.employees as HREmployee[]
      setPay(rehydratePay(parsed))
      setFileStatus(prev => ({ ...prev, pay: 'loaded' }))
      const meta: FileMeta = { name: `🔗 HR 系統帶入（${res.count} 人在職）`, size: 0, uploadedAt: Date.now() }
      setFileMeta(prev => ({ ...prev, pay: meta }))
      dirtyRef.current = true   // 觸發「上傳後自動計算」effect
      try {
        localStorage.setItem('hr_data_pay', JSON.stringify(parsed))
        localStorage.setItem('hr_meta_pay', JSON.stringify(meta))
        const ts = Date.now()
        localStorage.setItem('hr_data_meta', JSON.stringify({ timestamp: ts }))
        setSavedAt(ts)
      } catch { /* storage full, ignore */ }
      fetch('/api/hr-raw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_key: 'pay', data: parsed, meta }),
      }).then(r => r.json()).then(r2 => {
        if (r2?.error) console.warn('[hr-raw upload]', r2.error)
      }).catch(err => console.warn('[hr-raw upload]', err))
    } catch (e: unknown) {
      setFileStatus(prev => ({ ...prev, pay: 'error' }))
      setParseErr(prev => ({ ...prev, pay: e instanceof Error ? e.message : '讀取 HR 系統失敗' }))
    }
    setHrPayBusy(false)
  }, [])
  useEffect(() => { loadPayFromHRRef.current = loadPayFromHR }, [loadPayFromHR])

  const clearFile = useCallback((key: FileKey) => {
    setFileStatus(prev => ({ ...prev, [key]: 'idle' }))
    setFileMeta(prev => ({ ...prev, [key]: undefined }))
    setParseErr(prev => ({ ...prev, [key]: '' }))
    if (key === 'pay') setPay([])
    else if (key === 'att') setAtt(null)
    else if (key === 'loc') setLoc([])
    else if (key === 'adj') setAdj(emptyAdj)
    else setBrk([])
    try {
      localStorage.removeItem(`hr_data_${key}`)
      localStorage.removeItem(`hr_meta_${key}`)
    } catch { /* ignore */ }
    // 同步刪雲端，避免下次重整時又被拉回來
    fetch(`/api/hr-raw?file_key=${encodeURIComponent(key)}`, { method: 'DELETE' })
      .then(r => r.json()).then(res => {
        if (res?.error) console.warn('[hr-raw delete]', res.error)
      }).catch(err => console.warn('[hr-raw delete]', err))
  }, [])

  const compute = useCallback(async () => {
    if (!pay.length || !att) { setCompErr('請先上傳薪資表與出勤記錄'); return }
    setComputing(true); setCompErr('')
    try {
      // 計算核心抽到 computeHr（與「上傳後自動計算」共用同一份，數字零漂移）
      const { result, dist } = computeHr({
        pay, att, loc, adj, brk, year, month, viewMode, dateFrom, dateTo,
        stdH, storeFilter, excludeMgmt, locFilter,
      })
      setCalcResult(result)
      setStoreDist(dist)
      setCrossStore(computeCrossStoreDetail(result.results, result.locR, brk))
      setPunchAnom(detectPunchAnomalies(result.locR, brk, result.results))

      // 把人事成本摘要存進 localStorage（個人記錄）+ POST 到 Supabase（跨用戶共享）
      const snapshot = {
        calcAt: Date.now(),
        year, month, viewMode, dateFrom, dateTo,
        totalCost: dist.reduce((s, d) => s + d.totalCost, 0),
        byStore: dist.map(d => ({ cat: d.cat, totalCost: d.totalCost })),
      }
      try { localStorage.setItem('hr_last_result', JSON.stringify(snapshot)) } catch { /* ignore */ }
      fetch('/api/hr-snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year, month,
          view_mode: viewMode,
          date_from: dateFrom || null,
          date_to: dateTo || null,
          total_cost: snapshot.totalCost,
          by_store: snapshot.byStore,
          calc_at: new Date().toISOString(),
        }),
      }).catch(() => { /* 即使失敗，本機 localStorage 還是有 */ })

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

  // 把一張快照 POST 到雲端（給總覽等頁面讀）
  const postSnapshot = useCallback(async (
    p: { year: number; month: number; viewMode: ViewMode; dateFrom: string | null; dateTo: string | null },
    dist: ReturnType<typeof computeStoreDist>,
  ) => {
    await fetch('/api/hr-snapshot', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        year: p.year, month: p.month, view_mode: p.viewMode,
        date_from: p.dateFrom, date_to: p.dateTo,
        total_cost: dist.reduce((s, d) => s + d.totalCost, 0),
        by_store: dist.map(d => ({ cat: d.cat, totalCost: d.totalCost })),
        calc_at: new Date().toISOString(),
      }),
    }).catch(() => { /* 失敗忽略，不影響上傳 */ })
  }, [])

  // 上傳後自動計算並存快照（月 + 資料實際週區間），全站直接拿最新值，免按「開始計算」。
  // 用資料自身偵測到的月份/區間 + 該月 stdH 計算，與 HR 頁口徑一致。
  useEffect(() => {
    if (!dirtyRef.current || !pay.length || !att) return
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => {
      try {
        const per = detectPeriod(att)
        if (!per) return
        const base = { pay, att, loc, adj, brk, stdH: getMonthlyStdH(per.year, per.month) }
        // 月快照（pf=1）
        const mDist = computeHr({ ...base, year: per.year, month: per.month, viewMode: 'month' }).dist
        postSnapshot({ year: per.year, month: per.month, viewMode: 'month', dateFrom: null, dateTo: null }, mDist)
        // 週快照（資料實際涵蓋區間）
        const wDist = computeHr({ ...base, year: per.year, month: per.month, viewMode: 'week', dateFrom: per.from, dateTo: per.to }).dist
        postSnapshot({ year: per.year, month: per.month, viewMode: 'week', dateFrom: per.from, dateTo: per.to }, wDist)
      } catch (e) { console.warn('[auto snapshot]', e) }
    }, 1000)
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current) }
  }, [pay, att, loc, adj, brk, postSnapshot])

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

  // C. 分店分攤手動調整：期間（與報表 from/to 對齊）、載入、加、刪
  const periodRange = useMemo(() => {
    const pad = (n: number) => String(n).padStart(2, '0')
    return viewMode === 'week'
      ? { from: dateFrom, to: dateTo }
      : { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}` }
  }, [viewMode, dateFrom, dateTo, year, month])

  useEffect(() => {
    const { from, to } = periodRange
    if (!from || !to) { setStoreAdj([]); return }
    let cancelled = false
    fetch(`/api/hr-store-adj?from=${from}&to=${to}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setStoreAdj(Array.isArray(d.adjustments) ? d.adjustments : []) })
      .catch(() => { if (!cancelled) setStoreAdj([]) })
    return () => { cancelled = true }
  }, [periodRange])

  // 各店調整加總（給分店分攤表用）
  // manual：store_cat += delta_h（可正可負）；reassign：from_cat −H、to_cat +H
  const adjByStore = useMemo(() => {
    const m: Record<string, number> = {}
    storeAdj.forEach(a => {
      const d = Number(a.delta_h) || 0
      if (a.kind === 'reassign') {
        const h = Math.abs(d)
        if (a.from_cat) m[a.from_cat] = (m[a.from_cat] || 0) - h
        if (a.to_cat) m[a.to_cat] = (m[a.to_cat] || 0) + h
      } else if (a.store_cat) {
        m[a.store_cat] = (m[a.store_cat] || 0) + d
      }
    })
    return m
  }, [storeAdj])

  // 逐筆改歸：用 (工號|日期|來源店) 當 key，方便異常列判斷「已套用」與復原
  const reassignByKey = useMemo(() => {
    const m: Record<string, StoreAdjustment> = {}
    storeAdj.forEach(a => {
      if (a.kind === 'reassign' && a.emp_id && a.src_date && a.from_cat)
        m[`${a.emp_id}|${a.src_date}|${a.from_cat}`] = a
    })
    return m
  }, [storeAdj])

  const addStoreAdj = useCallback(async () => {
    const delta = parseFloat(adjForm.delta)
    if (!Number.isFinite(delta) || delta === 0) { alert('請輸入非零的調整時數（可正可負）'); return }
    const { from, to } = periodRange
    if (!from || !to) { alert('請先選好期間'); return }
    setAdjBusy(true)
    try {
      const res = await fetch('/api/hr-store-adj', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period_start: from, period_end: to, store_cat: adjForm.store, delta_h: delta, reason: adjForm.reason }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.adjustment) {
        setStoreAdj(p => [...p, data.adjustment as StoreAdjustment])
        setAdjForm(f => ({ ...f, delta: '', reason: '' }))
      } else alert(`❌ 新增失敗：${data.error || res.status}`)
    } catch (e) {
      alert(`❌ 失敗：${e instanceof Error ? e.message : '網路錯誤'}`)
    } finally { setAdjBusy(false) }
  }, [adjForm, periodRange])

  const delStoreAdj = useCallback(async (id: string) => {
    setStoreAdj(p => p.filter(a => a.id !== id))
    try { await fetch(`/api/hr-store-adj?id=${id}`, { method: 'DELETE' }) } catch { /* 樂觀刪除，失敗忽略 */ }
  }, [])

  // 異常分頁逐筆改歸：把某人某筆 H 從 fromCat 改歸 toCat（系統自動 from −H / to +H）
  const applyReassign = useCallback(async (a: PunchAnomaly, toCat: string) => {
    if (!a.fromCat || !a.hours) return
    if (toCat === a.fromCat) { alert('改歸的店不能跟原本同一間'); return }
    const { from, to } = periodRange
    if (!from || !to) { alert('請先選好期間'); return }
    const rk = `${a.id}|${a.date}|${a.fromCat}`
    setReassignBusy(rk)
    try {
      const res = await fetch('/api/hr-store-adj', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'reassign', period_start: from, period_end: to,
          from_cat: a.fromCat, to_cat: toCat, delta_h: Math.abs(a.hours),
          emp_id: a.id, emp_name: a.name, src_date: a.date,
          reason: `${a.name} ${a.date} ${a.type}：${a.fromCat}→${toCat} ${Math.abs(a.hours).toFixed(2)}H`,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.adjustment) setStoreAdj(p => [...p, data.adjustment as StoreAdjustment])
      else alert(`❌ 改歸失敗：${data.error || res.status}`)
    } catch (e) {
      alert(`❌ 失敗：${e instanceof Error ? e.message : '網路錯誤'}`)
    } finally { setReassignBusy('') }
  }, [periodRange])

  // 週報視角：基於目前期間 pf 線性外推月底估值
  const monthDays = new Date(year, month, 0).getDate()
  const pfActual = (() => {
    if (!isWeek || !dateFrom || !dateTo) return 1
    // 跨月區間整段歸選定月份算（與 computeHr 的 pf 同一套口徑），
    // pf = 期間天數 ÷ 選定月天數，這樣月底估值 = 週成本 ÷ pf 才不會失真
    const f = new Date(dateFrom)
    const t = new Date(dateTo)
    if (f > t) return 0.01
    const days = Math.round((t.getTime() - f.getTime()) / 86400000) + 1
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
        // 上方合計卡＝全部（含總部）；下方組成明細卡＝不含總部（跟分店口徑一致）
        const COUNTED_CODES = new Set(['6002', '20032'])
        const isHQEmp = (e: (typeof results)[number]) => e.dept.includes('總部') || e.dept.includes('執行長')
        const calcParts = (rs: typeof results) => {
          const sal = rs.reduce((s, e) => s + (e.propSal || 0), 0)
          const ot = rs.reduce((s, e) => s + (e.type === '月薪正職' ? (e.weekOtPay || 0) : 0), 0)
          const ins = rs.reduce((s, e) => s + (e.propIns || 0), 0)
          const holi = rs.reduce((s, e) => s + (e.extraDetail?.filter(d => d.code === '6002') || []).reduce((a, b) => a + b.amt, 0), 0)
          const annual = rs.reduce((s, e) => s + (e.extraDetail?.filter(d => d.code === '20032') || []).reduce((a, b) => a + b.amt, 0), 0)
          const other = rs.reduce((s, e) => s + (e.extraDetail?.filter(d => !COUNTED_CODES.has(d.code)) || []).reduce((a, b) => a + b.amt, 0), 0)
          return { sal, ot, ins, holi, annual, other, total: sal + ot + ins + holi + annual + other }
        }
        const all = calcParts(results)
        const storeOnly = calcParts(results.filter(e => !isHQEmp(e)))
        const grandTotal = all.total
        const totalRev = chartData.reduce((s, d) => s + d.rev, 0)
        const pct = (v: number, base: number) => base > 0 ? `${(v / base * 100).toFixed(1)}%` : null
        const items: { label: string; val: number; icon: string; color: string }[] = [
          { label: '薪資', val: storeOnly.sal, icon: '💼', color: '#3b82f6' },
          { label: '加班費', val: storeOnly.ot, icon: '⏱️', color: '#f59e0b' },
          { label: '勞健保', val: storeOnly.ins, icon: '🏥', color: '#10b981' },
          { label: '國定假日加給', val: storeOnly.holi, icon: '🎉', color: '#8b5cf6' },
          { label: '特休轉薪資', val: storeOnly.annual, icon: '🏖️', color: '#ec4899' },
          { label: '其他加扣', val: storeOnly.other, icon: '📋', color: '#64748b' },
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
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{isWeek ? '期間人事成本（至今，含總部）' : '月人事成本合計（含總部）'}</div>
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
            {/* 細項卡片（不含總部，跟分店/對帳口徑一致） */}
            <div style={{ fontSize: 11, color: '#9ca3af', margin: '0 2px 6px' }}>
              組成明細（不含總部）：合計 {fT(storeOnly.total)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              {items.map(it => {
                const pCost = storeOnly.total > 0 ? (it.val / storeOnly.total * 100) : 0
                return (
                  <div key={it.label} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e6e1', padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: `${it.color}1a`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>{it.icon}</div>
                      <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>{it.label}</div>
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#1a2f4e', marginBottom: 8 }}>{fT(it.val)}</div>
                    <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>佔人事成本 {pct(it.val, storeOnly.total) || '–'}</div>
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
          {/* 批次拖拉區 */}
          <BatchDropZone onFiles={files => {
            files.forEach(f => {
              const lower = f.name.toLowerCase()
              const name = f.name
              let key: FileKey | null = null
              if (name.includes('出勤') || lower.includes('att')) key = 'att'
              else if (name.includes('上下班') || name.includes('上班打卡') || name.includes('打卡') || lower.includes('loc') || lower.includes('clock')) key = 'loc'
              else if (name.includes('休息') || lower.includes('brk') || lower.includes('break')) key = 'brk'
              if (key) handleFile(key, f)
            })
          }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <button onClick={loadPayFromHR} disabled={hrPayBusy}
              style={{
                padding: '7px 14px', borderRadius: 8,
                border: `1px solid ${pay.length ? '#bbf7d0' : '#3c2929'}`,
                background: hrPayBusy ? '#f5f5f4' : pay.length ? '#f0fdf4' : '#3c2929',
                color: hrPayBusy ? '#9ca3af' : pay.length ? '#166534' : '#fff',
                fontSize: 12, fontWeight: 700, cursor: hrPayBusy ? 'wait' : 'pointer',
              }}>
              {hrPayBusy ? '⏳ 同步 HR 系統中…'
                : pay.length ? `✓ 薪資保險已連結 HR 系統（${pay.length} 人在職）· 點擊重新同步`
                : '🔗 薪資保險：連結 HR 系統'}
            </button>
            <span style={{ fontSize: 12, color: '#6b7280' }}>
              💡 出勤/打卡/休息檔直接點擊或<strong>拖拉</strong>到下方方塊。資料會自動存在你的瀏覽器，下次打開不用再上傳。
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 10 }}>
            {([
              { key: 'att' as FileKey, label: '出勤紀錄',   icon: '📋', hint: '必填' },
              { key: 'loc' as FileKey, label: '上班打卡',   icon: '📍', hint: '必填' },
              { key: 'brk' as FileKey, label: '休息紀錄',   icon: '☕', hint: '必填' },
            ]).map(({ key, label, icon, hint }) => (
              <UploadZone
                key={key}
                label={label}
                icon={icon}
                hint={hint}
                status={fileStatus[key]}
                meta={fileMeta[key]}
                error={parseErr[key]}
                onFile={f => handleFile(key, f)}
                onClear={() => clearFile(key)}
              />
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: '#9ca3af', flexWrap: 'wrap' }}>
            <span>
              已載入：薪資 {pay.length} 筆（HR 系統）· 出勤 {att?.records.length || 0} 筆 · 打卡 {loc.length} 筆 · 休息 {brk.length} 筆
            </span>
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
            <div style={{ display: 'inline-flex', background: '#f3f0ea', borderRadius: 10, padding: 3, border: '1px solid #e8e6e1' }}>
              <button onClick={() => setViewMode('month')}
                style={{
                  padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: viewMode === 'month' ? BRAND : 'transparent',
                  color: viewMode === 'month' ? '#fff' : '#6b7280',
                  fontSize: 13, fontWeight: 700,
                  boxShadow: viewMode === 'month' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all .15s',
                }}>
                📅 整月結算
              </button>
              <button onClick={() => setViewMode('week')}
                style={{
                  padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: viewMode === 'week' ? BRAND : 'transparent',
                  color: viewMode === 'week' ? '#fff' : '#6b7280',
                  fontSize: 13, fontWeight: 700,
                  boxShadow: viewMode === 'week' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all .15s',
                }}>
                📊 週報（至今+預估）
              </button>
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

          {/* 整月模式專屬：與 HR 系統正式結算對帳 */}
          {!isWeek && official && storeDist.length > 0 && (() => {
            const rows = OFFICIAL_STORE_MAP.map(m => {
              const off = m.store === '料韓男台北'
                ? (official['料韓男台北']?.cost ?? 0) + (official['料韓男明曜']?.cost ?? 0) + (official['料韓男仁愛']?.cost ?? 0)
                : official[m.store]?.cost ?? 0
              const week = storeDist.filter(d => m.cats.includes(d.cat)).reduce((s, d) => s + d.totalCost, 0)
              return { store: m.store, off, week, diff: week - off }
            }).filter(r => r.off > 0 || r.week > 0)
            if (!rows.length) return null
            const tOff = rows.reduce((s, r) => s + r.off, 0)
            const tWeek = rows.reduce((s, r) => s + r.week, 0)
            const pctColor = (diff: number, off: number) =>
              off > 0 && Math.abs(diff / off) > 0.05 ? '#dc2626' : '#6b7280'
            // 防呆：載入的出勤資料要涵蓋整個選定月份，對帳才有意義。
            // 例如載著 6/29-7/5 的週檔去算 6 月整月，工讀只有 2 天時數，差率會假性爆炸。
            const inMonthDates = new Set(
              (att?.records || [])
                .filter(r => r.date && r.date.getFullYear() === year && r.date.getMonth() + 1 === month)
                .map(r => r.dateStr)
            )
            const coverOk = inMonthDates.size >= monthDays * 0.9
            if (!coverOk) {
              return (
                <div style={{ background: '#fffbeb', borderRadius: 12, border: '1px solid #fde68a', padding: '16px 20px', marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, color: '#92400e', fontSize: 14, marginBottom: 6 }}>
                    🧾 對帳暫停：出勤資料不涵蓋 {year}/{month} 整月
                  </div>
                  <div style={{ fontSize: 12, color: '#92400e', lineHeight: 1.7 }}>
                    目前載入的出勤紀錄在 {year}/{month} 月裡只有 <b>{inMonthDates.size} 天</b>（整月 {monthDays} 天），
                    拿來算整月會嚴重低估，跟正式結算對帳沒有意義。
                    想對 {year}/{month} 月的帳，請重新上傳涵蓋該月整月的出勤/打卡/休息檔案再計算。
                    <br />參考：HR 正式結算 {rows.map(r => `${r.store} ${fT(r.off)}`).join('、')}（合計 {fT(tOff)}）。
                  </div>
                </div>
              )
            }
            return (
              <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e6e1', padding: '16px 20px', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, color: '#1a2f4e', fontSize: 14 }}>🧾 與 HR 系統正式結算對帳</span>
                  <span style={{ fontSize: 12, color: '#6b7280' }}>{year}/{month} 月（含勞健保；總部兩邊都不列入）</span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: '#fafaf8' }}>
                        {['分店', 'HR 正式結算', '週報估算', '差額', '差率'].map(h => (
                          <th key={h} style={{ padding: '8px 12px', textAlign: h === '分店' ? 'left' : 'right', color: '#6b7280', fontWeight: 600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(r => (
                        <tr key={r.store} style={{ borderTop: '1px solid #f0eeea' }}>
                          <td style={{ padding: '8px 12px', fontWeight: 600 }}>{r.store}{r.store === '料韓男台北' ? '（=明曜+仁愛）' : ''}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fT(r.off)}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fT(r.week)}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', color: pctColor(r.diff, r.off) }}>{r.diff >= 0 ? '+' : ''}{fT(r.diff)}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: pctColor(r.diff, r.off) }}>
                            {r.off > 0 ? `${r.diff >= 0 ? '+' : ''}${(r.diff / r.off * 100).toFixed(1)}%` : '—'}
                          </td>
                        </tr>
                      ))}
                      <tr style={{ borderTop: '2px solid #e8e6e1', background: '#fafaf8' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 700 }}>合計</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700 }}>{fT(tOff)}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700 }}>{fT(tWeek)}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: pctColor(tWeek - tOff, tOff) }}>{tWeek - tOff >= 0 ? '+' : ''}{fT(tWeek - tOff)}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: pctColor(tWeek - tOff, tOff) }}>
                          {tOff > 0 ? `${tWeek - tOff >= 0 ? '+' : ''}${((tWeek - tOff) / tOff * 100).toFixed(1)}%` : '—'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>
                  正式結算 = HR 人事系統的月結數字（唯一正確答案）。差率長期偏同一方向屬正常——週報少算考績扣款、季獎金等月結項目，看趨勢時心裡校正即可。
                </div>
              </div>
            )
          })()}

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
                { key: 'crossStore' as ResultTab, label: `跨店明細（${crossStore.filter(r => r.storeCount >= 2).length}）` },
                { key: 'anom' as ResultTab, label: `異常（${(calcResult?.anom.length || 0) + punchAnom.anomalies.length}）` },
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
                            <span style={{ fontWeight: 600 }}>{adjByStore[s.cat] ? '系統時數' : '總時數'}</span>
                            <span style={{ fontWeight: 700, color: '#1a2f4e' }}>{s.totalH.toFixed(2)}</span>
                          </div>
                          {/* C. 手動調整 + 校正後 */}
                          {!!adjByStore[s.cat] && (
                            <>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', color: adjByStore[s.cat] > 0 ? '#059669' : '#dc2626' }}>
                                <span>手動調整</span>
                                <span>{adjByStore[s.cat] > 0 ? '+' : ''}{adjByStore[s.cat].toFixed(2)}</span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0 0', borderTop: '1px dashed #d6d3cd' }}>
                                <span style={{ fontWeight: 700 }}>校正後總時數</span>
                                <span style={{ fontWeight: 800, color: '#1a2f4e' }}>{(s.totalH + adjByStore[s.cat]).toFixed(2)}</span>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* 一鍵複製文字 / 傳到 LINE */}
                    <div style={{ padding: '0 20px 16px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button onClick={() => {
                        const text = storeDist.map(s => {
                          const adj = adjByStore[s.cat] || 0
                          const totalLine = adj
                            ? `系統時數： ${s.totalH.toFixed(2)}\n手動調整： ${adj > 0 ? '+' : ''}${adj.toFixed(2)}\n校正後總時數： ${(s.totalH + adj).toFixed(2)}`
                            : `總時數： ${s.totalH.toFixed(2)}`
                          return `[${s.cat}]\n正職： ${s.ftH.toFixed(2)} (內場 ${s.ftInnerH.toFixed(2)} / 外場 ${s.ftOuterH.toFixed(2)})\n工讀： ${s.ptH.toFixed(2)} (內場 ${s.ptInnerH.toFixed(2)} / 外場 ${s.ptOuterH.toFixed(2)})\n${totalLine}`
                        }).join('\n\n')
                        navigator.clipboard.writeText(text).then(() => alert('已複製到剪貼簿'))
                      }} style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid #e5e7eb', background: '#fff', fontSize: 12, cursor: 'pointer', color: '#374151' }}>
                        📋 複製文字
                      </button>
                      <button onClick={async () => {
                        const pad = (n: number) => String(n).padStart(2, '0')
                        const period = viewMode === 'week'
                          ? { from: dateFrom, to: dateTo }
                          : { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}` }
                        try {
                          const res = await fetch('/api/notify-line', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ storeDist, period, viewMode }),
                          })
                          const data = await res.json().catch(() => ({}))
                          if (res.ok) alert('✓ 已傳到 LINE 群組')
                          else alert(`❌ 失敗：${data.error || res.status}`)
                        } catch (e) {
                          alert(`❌ 失敗：${e instanceof Error ? e.message : '網路錯誤'}`)
                        }
                      }} style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid #10b981', background: '#10b981', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                        📨 傳到 LINE 群組
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

                    {/* C. 分店分攤手動調整 — 跨店支援/休息卡打錯店等系統算不準的人工校正 */}
                    <div style={{ margin: '4px 20px 20px', padding: '14px 16px', background: '#fbfaf7', border: '1px solid #e8e6e1', borderRadius: 10 }}>
                      <div style={{ fontWeight: 700, color: '#1a2f4e', fontSize: 13, marginBottom: 4 }}>🔧 手動調整（{periodRange.from} ~ {periodRange.to}）</div>
                      <div style={{ fontSize: 11.5, color: '#9ca3af', marginBottom: 10 }}>
                        跨店支援、休息卡打錯店等系統算不準的情況，可在這裡針對某間店 +/- 時數。調整只影響「校正後總時數」，會跟著期間自動帶出。
                        逐筆改歸（標 🔁）是從「異常」分頁套用的個人校正，也會列在這裡。
                      </div>

                      {storeAdj.length > 0 && (
                        <div style={{ marginBottom: 10 }}>
                          {storeAdj.map(a => {
                            const isRe = a.kind === 'reassign'
                            const h = Number(a.delta_h) || 0
                            return (
                              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, padding: '5px 0', borderBottom: '1px solid #f0eee9' }}>
                                <span style={{ minWidth: 116, fontWeight: 600, color: '#1a2f4e' }}>{isRe ? `🔁 ${a.from_cat}→${a.to_cat}` : a.store_cat}</span>
                                <span style={{ minWidth: 64, textAlign: 'right', fontWeight: 700, color: isRe ? '#1a2f4e' : (h > 0 ? '#059669' : '#dc2626') }}>{isRe ? `${Math.abs(h).toFixed(2)}H` : `${h > 0 ? '+' : ''}${h.toFixed(2)}H`}</span>
                                <span style={{ flex: 1, color: '#6b7280' }}>{a.reason || '—'}</span>
                                <button onClick={() => delStoreAdj(a.id)} style={{ padding: '2px 8px', borderRadius: 6, border: '1px solid #fca5a5', background: '#fff', color: '#dc2626', fontSize: 11, cursor: 'pointer' }}>刪除</button>
                              </div>
                            )
                          })}
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <select value={adjForm.store} onChange={e => setAdjForm(f => ({ ...f, store: e.target.value }))}
                          style={{ padding: '6px 10px', borderRadius: 7, border: '1px solid #e5e7eb', fontSize: 12, background: '#fff' }}>
                          {['品牌概念店', '料韓男2號店', '料韓男3號店', '英洙家', '其他'].map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <input value={adjForm.delta} onChange={e => setAdjForm(f => ({ ...f, delta: e.target.value }))}
                          placeholder="時數 (例 +9.93 / -8.95)" inputMode="decimal"
                          style={{ width: 150, padding: '6px 10px', borderRadius: 7, border: '1px solid #e5e7eb', fontSize: 12 }} />
                        <input value={adjForm.reason} onChange={e => setAdjForm(f => ({ ...f, reason: e.target.value }))}
                          placeholder="說明 (例 加英洙家支援)"
                          style={{ flex: 1, minWidth: 160, padding: '6px 10px', borderRadius: 7, border: '1px solid #e5e7eb', fontSize: 12 }} />
                        <button onClick={addStoreAdj} disabled={adjBusy}
                          style={{ padding: '6px 16px', borderRadius: 7, border: '1px solid #1a2f4e', background: adjBusy ? '#9ca3af' : '#1a2f4e', color: '#fff', fontSize: 12, fontWeight: 600, cursor: adjBusy ? 'default' : 'pointer' }}>
                          {adjBusy ? '新增中…' : '＋ 新增調整'}
                        </button>
                      </div>
                    </div>
                  </>
                )
              )}

              {resultTab === 'crossStore' && (
                crossStore.length === 0 ? (
                  <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
                    需上傳地點紀錄才能計算跨店明細
                  </div>
                ) : (() => {
                  const storeCols = ['品牌概念店', '料韓男2號店', '料韓男3號店', '英洙家', '其他']
                  let rows = crossStore
                  if (crossOnly) rows = rows.filter(r => r.storeCount >= 2)
                  if (crossFtOnly) rows = rows.filter(r => r.type === 'FT')
                  return (
                    <>
                      <div style={{ padding: '12px 20px', borderBottom: '1px solid #f0eee9', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
                        <label style={{ display: 'flex', gap: 6, cursor: 'pointer', alignItems: 'center' }}>
                          <input type="checkbox" checked={crossOnly} onChange={e => setCrossOnly(e.target.checked)} />
                          只看跨店者（≥2 店）
                        </label>
                        <label style={{ display: 'flex', gap: 6, cursor: 'pointer', alignItems: 'center' }}>
                          <input type="checkbox" checked={crossFtOnly} onChange={e => setCrossFtOnly(e.target.checked)} />
                          只看正職
                        </label>
                        <span style={{ color: '#6b7280' }}>顯示 {rows.length} 筆</span>
                      </div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: '#fafaf8' }}>
                            {(['工號','姓名','職稱','本店(部門)','身份','內/外','總時數', ...storeCols, '跨店數'] as string[]).map(h => (
                              <th key={h} style={{ padding: '9px 10px', textAlign: h === '姓名' || h === '職稱' || h === '本店(部門)' ? 'left' : 'right', color: '#6b7280', fontWeight: 600, borderBottom: '1.5px solid #e8e6e1', whiteSpace: 'nowrap' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map(r => (
                            <tr key={r.id} style={{ borderBottom: '1px solid #f0eee9' }}>
                              <td style={{ padding: '7px 10px', color: '#9ca3af', textAlign: 'right' }}>{r.id}</td>
                              <td style={{ padding: '7px 10px', fontWeight: 600 }}>{r.name}</td>
                              <td style={{ padding: '7px 10px', color: '#374151' }}>{r.title}</td>
                              <td style={{ padding: '7px 10px', color: '#6b7280' }}>{r.dept}</td>
                              <td style={{ padding: '7px 10px', textAlign: 'right' }}>
                                <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 20, background: r.type === 'FT' ? '#dbeafe' : '#fef3c7', color: r.type === 'FT' ? '#2563eb' : '#d97706' }}>
                                  {r.type === 'FT' ? '正職' : '工讀'}
                                </span>
                              </td>
                              <td style={{ padding: '7px 10px', color: '#6b7280', textAlign: 'right' }}>{r.loc || '—'}</td>
                              <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 600 }}>{fH(r.totalH)}</td>
                              {storeCols.map(c => {
                                const v = r.byStore[c] || 0
                                const isMain = c === r.mainStore && r.storeCount >= 2
                                return (
                                  <td key={c} style={{ padding: '7px 10px', textAlign: 'right', color: v > 0 ? (isMain ? '#0369a1' : '#374151') : '#d1d5db', fontWeight: isMain ? 600 : 400 }}>
                                    {v > 0 ? fH(v) : '—'}
                                  </td>
                                )
                              })}
                              <td style={{ padding: '7px 10px', textAlign: 'right' }}>
                                {r.storeCount >= 2 ? (
                                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 20, background: '#fee2e2', color: '#dc2626', fontWeight: 600 }}>{r.storeCount}</span>
                                ) : <span style={{ color: '#d1d5db' }}>{r.storeCount}</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )
                })()
              )}

              {resultTab === 'anom' && (() => {
                // 把基本異常（跨日/無出勤/未建檔）和「可疑打卡」(B) 合併一張表
                const STORES = ['品牌概念店', '料韓男2號店', '料韓男3號店', '英洙家', '其他']
                const baseAnom = (calcResult?.anom || []).map(a => ({ ...a, hours: undefined as number | undefined, fromCat: undefined as string | undefined, toCat: undefined as string | undefined }))
                const allAnom = [...baseAnom, ...punchAnom.anomalies]
                if (allAnom.length === 0)
                  return <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>✓ 無異常</div>
                return (
                  <>
                    {punchAnom.suspectH > 0 && (
                      <div style={{ margin: '14px 20px 4px', padding: '10px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12.5, color: '#92400e' }}>
                        ⚠️ 可疑打卡共 <b>{punchAnom.anomalies.length}</b> 筆、合計 <b>{punchAnom.suspectH.toFixed(2)}H</b>（跨店/非分店/休息卡對不上）。
                        想修哪一筆，就在右邊「改歸」選對的店按「套用」—— 系統會自動把原本算錯的店扣掉、改歸的店加上，「分店分攤」的校正後總時數會立刻跟著變。
                      </div>
                    )}
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: '#fafaf8' }}>
                          {['嚴重度','類型','工號','姓名','日期','時數','說明','改歸'].map(h => (
                            <th key={h} style={{ padding: '9px 12px', textAlign: h === '時數' ? 'right' : 'left', color: '#6b7280', fontWeight: 600, borderBottom: '1.5px solid #e8e6e1' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {allAnom.map((a, i) => {
                          const sevBg = a.sev === 'error' ? '#fee2e2' : a.sev === 'warn' ? '#fef3c7' : '#dbeafe'
                          const sevColor = a.sev === 'error' ? '#dc2626' : a.sev === 'warn' ? '#d97706' : '#2563eb'
                          const canReassign = !!a.fromCat && !!a.hours
                          const rk = `${a.id}|${a.date}|${a.fromCat}`
                          const applied = canReassign ? reassignByKey[rk] : undefined
                          const sel = reassignSel[rk] ?? (a.toCat && a.toCat !== a.fromCat ? a.toCat : STORES.find(c => c !== a.fromCat)!)
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
                              <td style={{ padding: '8px 12px', textAlign: 'right', color: '#6b7280' }}>{a.hours != null ? a.hours.toFixed(2) : '–'}</td>
                              <td style={{ padding: '8px 12px', color: '#6b7280' }}>{a.detail}</td>
                              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                                {!canReassign ? (
                                  <span style={{ color: '#d1d5db' }}>—</span>
                                ) : applied ? (
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ color: '#059669', fontWeight: 700 }}>→ {applied.to_cat} ✓</span>
                                    <button onClick={() => delStoreAdj(applied.id)}
                                      style={{ padding: '2px 8px', borderRadius: 6, border: '1px solid #fca5a5', background: '#fff', color: '#dc2626', fontSize: 11, cursor: 'pointer' }}>復原</button>
                                  </span>
                                ) : (
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ color: '#9ca3af' }}>{a.fromCat}→</span>
                                    <select value={sel} onChange={e => setReassignSel(s => ({ ...s, [rk]: e.target.value }))}
                                      style={{ padding: '3px 6px', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 11, background: '#fff' }}>
                                      {STORES.filter(c => c !== a.fromCat).map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                    <button disabled={reassignBusy === rk} onClick={() => applyReassign(a as PunchAnomaly, sel)}
                                      style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid #1a2f4e', background: reassignBusy === rk ? '#9ca3af' : '#1a2f4e', color: '#fff', fontSize: 11, fontWeight: 600, cursor: reassignBusy === rk ? 'default' : 'pointer' }}>
                                      {reassignBusy === rk ? '…' : '套用'}
                                    </button>
                                  </span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </>
                )
              })()}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
