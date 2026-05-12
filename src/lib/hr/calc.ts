import * as XLSX from 'xlsx'

// ── 保費費率（雇主負擔）────────────────────────────────────────────────────
// 註：職保費率依行業類別不同，餐飲業實際約 0.17%
export const R = { lb: 0.0875, voc: 0.0017, rsv: 0.00025, pen: 0.06, hb: 0.0484 }
const FT_DIV = 240

// ── Types ──────────────────────────────────────────────────────────────────
export interface HREmployee {
  id: string; name: string; dept: string
  baseSalary: number; mealAllow: number; hourlyRate: number
  mgmtAllow: number; housingAllow: number
  perfBonus: number; annualBonus: number; skillAllow: number
  title: string; titleLoc: string
  fixedSalary: number
  lbB: number; vocB: number; penB: number; hbB: number
  type: '月薪正職' | '時薪工讀' | '未設定'
  hireDate: Date | null
  birthday: Date | null
}

export interface AttRecord {
  dept: string; id: string; name: string
  dateStr: string; date: Date | null
  hours: number; inTime: string; outTime: string
  crossMidnight: boolean; rule?: string
}

export interface AttResult {
  isApollo: boolean
  records: AttRecord[]
  extras: Record<string, number>
  extrasDetail: Record<string, { code: string; desc: string; amt: number; note: string }[]>
}

export interface LocRecord {
  id: string; name: string
  dateStr: string; date: Date | null
  inLoc: string; outLoc: string
  hours: number; cross: boolean
  inMin?: number | null; outMin?: number | null
}

export interface AdjRecord {
  name: string; type: string; days: number
  startDate: Date | null; endDate: Date | null
  code?: string  // 加扣項目專用：科目代碼
}

export interface HolidayEntry {
  dateStr: string; date: Date | null; name: string; multiplier: number
}

export interface ParsedAdjustments {
  records: AdjRecord[]
  holidays: HolidayEntry[]
  lates: Record<string, { count: number; mins: number }>
  compHours: Record<string, number>
  foreigners: string[]
}

export const emptyAdj: ParsedAdjustments = {
  records: [], holidays: [], lates: {}, compHours: {}, foreigners: [],
}

export interface BreakRecord {
  id: string; name: string; dateStr: string; mins: number
  startMin?: number | null; endMin?: number | null
  startLoc?: string; endLoc?: string
}

export interface Insurance { lb: number; voc: number; rsv: number; pen: number; hb: number; total: number }

export interface EmployeeResult extends HREmployee {
  totalH: number; noPunch: boolean; eStd: number; hr: number
  otH: number; otPay: number | null; gross: number | null
  ins: Insurance; rule: string; loc: string
  extra: number; extraDetail: { code: string; desc: string; amt: number; note: string }[] | null
  propSal: number; propIns: number; propFactor: number
  weekStd: number; weekOtH: number; weekOtPay: number; pace: number
  ptDailyOt: number; b66: number; bH: number; rAddon: number
  projBH?: number; projB66?: number
}

export interface Anomaly {
  sev: 'error' | 'warn' | 'info'
  type: string; id: string; name: string; date: string; detail: string
}

export interface CalcResult {
  results: EmployeeResult[]; anom: Anomaly[]
  sr: AttRecord[]; locR: LocRecord[]; isApollo: boolean
}

// ── Utility helpers ────────────────────────────────────────────────────────
function pd(s: string | number | unknown): Date | null {
  const m = String(s || '').trim().match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/)
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null
}

function pMin(t: unknown): number | null {
  const p = String(t || '').trim().split(':')
  if (p.length < 2) return null
  const h = +p[0], m = +p[1]
  return isNaN(h) || isNaN(m) ? null : h * 60 + m
}

function rawH(i: number | null, o: number | null): number {
  if (i == null || o == null) return 0
  let e = o; if (e <= i) e += 1440
  return (e - i) / 60
}

function isCross(i: number | null, o: number | null): boolean {
  return i != null && o != null && o <= i && o > 0
}

function parseTimeFrac(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null
  if (typeof val === 'number' && val >= 0 && val < 1) {
    return Math.round(val * 1440)
  }
  if (val instanceof Date && !isNaN(val.getTime())) {
    return val.getHours() * 60 + val.getMinutes()
  }
  const s = String(val).trim()
  const m = s.match(/^(\d{1,2}):(\d{2})/)
  if (m) return +m[1] * 60 + +m[2]
  return null
}

function parseAttDate(val: unknown): { str: string; date: Date | null } {
  if (!val && val !== 0) return { str: '', date: null }
  if (val instanceof Date && !isNaN(val.getTime())) {
    const str = `${val.getFullYear()}/${String(val.getMonth() + 1).padStart(2, '0')}/${String(val.getDate()).padStart(2, '0')}`
    return { str, date: val }
  }
  if (typeof val === 'number') {
    const d = new Date(Math.round((val - 25569) * 86400000))
    const str = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
    return { str, date: d }
  }
  const s = String(val).trim()
  return { str: s, date: pd(s) }
}

function parseLeaveDate(val: unknown): Date | null {
  if (!val && val !== 0) return null
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val
  if (typeof val === 'number') {
    const d = new Date(Math.round((val - 25569) * 86400000))
    return isNaN(d.getTime()) ? null : d
  }
  return pd(String(val))
}

function fuzzyCol(hdr: string[], keyword: string): number {
  const k = keyword.replace(/\s/g, '')
  return hdr.findIndex(c => String(c).trim().replace(/\s/g, '').includes(k))
}

// ── Insurance ──────────────────────────────────────────────────────────────
const FOREIGN_LB_RATE = 0.0805 // 11.5% × 70% (不含就業保險)

function calcIns(e: HREmployee, isForeigner = false): Insurance {
  const lbRate = isForeigner ? FOREIGN_LB_RATE : R.lb
  const lb = (e.lbB || 0) * lbRate
  const voc = (e.vocB || 0) * R.voc
  const rsv = (e.lbB || 0) * R.rsv
  const pen = (e.penB || 0) * R.pen
  const hb = (e.hbB || 0) * R.hb
  return { lb, voc, rsv, pen, hb, total: lb + voc + rsv + pen + hb }
}

// ── PT bonus ───────────────────────────────────────────────────────────────
// spec 第三條工讀加給規則：
//   料韓男各店，職稱含「資深」且時數 ≥ 66H → 每小時 +10 元
//   英洙家，時數 ≥ 66H → 固定 +600 元
//   資深 OR 英洙家，時數 ≥ 100H → +1,000 元
function ptBonus(emp: HREmployee, h: number): { b66: number; rAddon: number; bH: number } {
  const isE = emp.dept === '英洙家'
  const isSenior = (emp.title || '').includes('資深')
  let b66 = 0, rAddon = 0
  if (isE) { if (h >= 66) b66 = 600 }
  else { if (h >= 66 && isSenior) rAddon = 10 }
  const bH = ((isSenior || isE) && h >= 100) ? 1000 : 0
  return { b66, rAddon, bH }
}

function ptOTP(h: number, rate: number): number {
  if (h <= 8) return 0
  const ot = h - 8
  return Math.min(ot, 2) * rate * 0.34 + Math.max(0, ot - 2) * rate * 0.67
}

// ── FT OT ──────────────────────────────────────────────────────────────────
function ftOTbase(e: HREmployee): number {
  return e.baseSalary + e.mealAllow + e.mgmtAllow + e.perfBonus + e.annualBonus + e.skillAllow
}

function ftOT(otH: number, hr: number): number {
  if (otH <= 0) return 0
  return otH <= 40 ? otH * hr * 1.34 : 40 * hr * 1.34 + (otH - 40) * hr * 1.67
}

// ── effStd ─────────────────────────────────────────────────────────────────
function effStd(
  id: string, defaultStd: number,
  adjMap: Record<string, { delta: number; name: string }>,
  ovr: Record<string, number>,
  pay: HREmployee[]
): number {
  if (ovr[id] !== undefined) return ovr[id]
  if (adjMap[id] !== undefined) return Math.max(0, defaultStd + (adjMap[id].delta || 0))
  const emp = pay.find(e => e.id === id)
  if (emp) {
    const nk = '__name__' + emp.name
    if (adjMap[nk] !== undefined) return Math.max(0, defaultStd + (adjMap[nk].delta || 0))
  }
  return defaultStd
}

// ── parsePay ───────────────────────────────────────────────────────────────
export function parsePay(wb: XLSX.WorkBook): HREmployee[] {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }) as string[][]
  let hi = rows.findIndex(r => String(r[0]).trim() === '工號' || String(r[1]).trim() === '工號')
  if (hi < 0) hi = 1
  const hdr = rows[hi].map(c => String(c).trim())
  const fC = (n: string) => hdr.findIndex(h => h.includes(n))
  const lbAmtIdx = fC('勞保投保金額'), vocAmtIdx = fC('職保投保金額')
  const penAmtIdx = fC('勞退投保金額'), hbAmtIdx = fC('健保投保金額')
  const titleIdx = hdr.indexOf('職稱')
  const hireIdx = fC('到職日')
  const birthIdx = fC('生日')

  return rows.slice(hi + 1).filter(r => String(r[0]).trim().startsWith('N')).map(r => {
    const bs = +r[3] || 0, hr = +r[5] || 0, meal = +r[4] || 0, mgmt = +r[6] || 0, housing = +r[7] || 0
    const perf = +r[8] || 0, annual = +r[9] || 0, skill = +r[10] || 0
    const title = titleIdx >= 0 ? String(r[titleIdx] || '').trim() : ''
    let titleLoc = ''
    if (title.includes('內場') || title === '廚師長') titleLoc = '內場'
    else if (title.includes('外場')) titleLoc = '外場'
    else if (title === '兼職人員') titleLoc = '兼職'
    else if (['督導', '行政助理', '執行長', '廚師長'].some(t => title.includes(t)) && !title.includes('內場') && !title.includes('外場')) titleLoc = '總部'
    return {
      id: String(r[0]).trim(), name: String(r[1]).trim(), dept: String(r[2]).trim(),
      baseSalary: bs, mealAllow: meal, hourlyRate: hr, mgmtAllow: mgmt, housingAllow: housing,
      perfBonus: perf, annualBonus: annual, skillAllow: skill, title, titleLoc,
      fixedSalary: bs + meal + mgmt + housing + perf + annual + skill,
      lbB: lbAmtIdx >= 0 ? +r[lbAmtIdx] || 0 : 0,
      vocB: vocAmtIdx >= 0 ? +r[vocAmtIdx] || 0 : 0,
      penB: penAmtIdx >= 0 ? +r[penAmtIdx] || 0 : 0,
      hbB: hbAmtIdx >= 0 ? +r[hbAmtIdx] || 0 : 0,
      type: (bs > 0 ? '月薪正職' : hr > 0 ? '時薪工讀' : '未設定') as HREmployee['type'],
      hireDate: hireIdx >= 0 ? parseLeaveDate(r[hireIdx]) : null,
      birthday: birthIdx >= 0 ? parseLeaveDate(r[birthIdx]) : null,
    }
  })
}

// ── parseAtt ───────────────────────────────────────────────────────────────
export function parseAtt(wb: XLSX.WorkBook): AttResult {
  const EXTRA_INCLUDE = ['1000', '2000', '5001', '6000', '6002', '6004', '7000', '8000', '9000', '20032', '7001', '6005', '6001', '6003']
  const EXTRA_SKIP = ['7004', '3006', '3007', '3008']
  const CODE_DESC: Record<string, string> = {
    '1000': '時數不足扣回', '2000': '免稅加班費', '5001': '考績獎金',
    '6000': '加給', '6002': '國定假日加給', '6004': '人力不足加給',
    '8000': '扣項-其他', '9000': '加項-其他',
    '20032': '不休假代金-特休', '7001': '補發',
  }

  for (const nm of wb.SheetNames) {
    const ws = wb.Sheets[nm]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][]
    const hi = rows.findIndex(r => (r as string[]).some(c => {
      const s = String(c).trim(); return s === '實際工時' || s === '上班打卡時間'
    }))
    if (hi < 0) continue
    const hdr = (rows[hi] as string[]).map(c => String(c).trim())
    const C = (n: string) => fuzzyCol(hdr, n)
    const cu = C('單位'), ci = C('工號'), cn = C('姓名'), cd = C('日期')
    const cin = C('上班打卡時間'), cout = C('下班打卡時間'), ca = C('實際工時')
    if (ci < 0) continue
    const records: AttRecord[] = rows.slice(hi + 1)
      .filter(r => String((r as string[])[ci] || '').trim().startsWith('N'))
      .map(r => {
        const row = r as unknown[]
        const iM = parseTimeFrac(row[cin]), oM = parseTimeFrac(row[cout])
        const { str: dateStr, date } = parseAttDate(row[cd])
        const caVal = ca >= 0 ? row[ca] : undefined
        const hours = caVal != null && caVal !== '' ? +caVal || 0 : rawH(iM, oM)
        return {
          dept: String(row[cu] || '').trim(), id: String(row[ci]).trim(), name: String(row[cn] || '').trim(),
          dateStr, date, hours,
          inTime: row[cin] != null ? String(row[cin]) : '',
          outTime: row[cout] != null ? String(row[cout]) : '',
          crossMidnight: isCross(iM, oM),
        }
      })

    if (records.length === 0) continue

    // Parse 加扣項
    const extras: Record<string, number> = {}
    const extrasDetail: Record<string, { code: string; desc: string; amt: number; note: string }[]> = {}
    const adjSN = wb.SheetNames.find(n => n.includes('加扣項'))
    if (adjSN) {
      const adjR = XLSX.utils.sheet_to_json(wb.Sheets[adjSN], { header: 1, defval: '' }) as string[][]
      adjR.forEach(r => {
        const eid = String(r[0] || '').trim()
        if (!eid.startsWith('N')) return
        const code = String(r[2] || '').trim()
        if (EXTRA_SKIP.includes(code) || !EXTRA_INCLUDE.includes(code)) return
        let amt = parseFloat(r[3])
        if (isNaN(amt) || amt === 0) return
        if (code === '8000') amt = -Math.abs(amt)
        const note = String(r[4] || '').trim().replace(/\n/g, ' ')
        extras[eid] = (extras[eid] || 0) + amt
        if (!extrasDetail[eid]) extrasDetail[eid] = []
        extrasDetail[eid].push({ code, desc: CODE_DESC[code] || code, amt, note })
      })
    }
    return { isApollo: ca >= 0, records, extras, extrasDetail }
  }

  // Fallback: 上下班打卡紀錄
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][]
  let hi = rows.findIndex(r => (r as string[]).some(c => String(c).trim() === '單位'))
  if (hi < 0) hi = 0
  const hdr = (rows[hi] as string[]).map(c => String(c).trim())
  const C = (n: string) => fuzzyCol(hdr, n)
  const cu = C('單位'), ci = C('工號'), cn = C('姓名'), cd = C('日期')
  const cin = C('上班時間'), cout = C('下班時間')
  return {
    isApollo: false, extras: {}, extrasDetail: {},
    records: rows.slice(hi + 1)
      .filter(r => String((r as string[])[ci] || '').trim().startsWith('N'))
      .map(r => {
        const row = r as unknown[]
        const iM = parseTimeFrac(row[cin]), oM = parseTimeFrac(row[cout])
        const { str: dateStr, date } = parseAttDate(row[cd])
        return {
          dept: String(row[cu] || '').trim(), id: String(row[ci]).trim(), name: String(row[cn] || '').trim(),
          dateStr, date, hours: rawH(iM, oM),
          inTime: row[cin] != null ? String(row[cin]) : '',
          outTime: row[cout] != null ? String(row[cout]) : '',
          crossMidnight: isCross(iM, oM),
        }
      }),
  }
}

// ── parseLoc ───────────────────────────────────────────────────────────────
export function parseLoc(wb: XLSX.WorkBook): LocRecord[] {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }) as unknown[][]
  let hi = rows.findIndex(r => String((r as string[])[0]).trim() === '單位')
  if (hi < 0) hi = 0
  const h = (rows[hi] as string[]).map(c => String(c).trim())
  const C = (n: string) => fuzzyCol(h, n)
  const ci = C('工號'), cn = C('姓名'), cd = C('日期'), cit = C('上班時間'), col = C('上班地點'), cot = C('下班時間'), cdl = C('下班地點')
  return rows.slice(hi + 1)
    .filter(r => String((r as string[])[ci] || '').trim().startsWith('N'))
    .map(r => {
      const row = r as unknown[]
      const iM = parseTimeFrac(row[cit]), oM = parseTimeFrac(row[cot])
      const hrs = rawH(iM, oM)
      const inL = String(row[col] || '').trim() || '未知'
      const outL = cdl >= 0 ? String(row[cdl] || '').trim() || '未知' : ''
      const cross = !!(outL && outL !== inL && outL !== '未知')
      const { str: dateStr, date } = parseAttDate(row[cd])
      return { id: String(row[ci]).trim(), name: String(row[cn] || '').trim(), dateStr, date, inLoc: inL, outLoc: outL, hours: hrs, cross, inMin: iM, outMin: oM }
    })
}

// ── parseAdj ───────────────────────────────────────────────────────────────
function findSheet(wb: XLSX.WorkBook, ...keywords: string[]): XLSX.WorkSheet | null {
  const name = wb.SheetNames.find(n => keywords.some(k => n.includes(k)))
  return name ? wb.Sheets[name] : null
}

// 找 header row：要求「整格」剛好等於某個 needle（避免「說明」段落誤判）
function findHeaderRow(rows: unknown[][], ...needles: string[]): number {
  return rows.findIndex(r =>
    (r as unknown[]).some(c => needles.includes(String(c || '').trim()))
  )
}

const isHeaderName = (name: string) => name === '姓名' || name === '人員姓名' || !name

export function parseAdj(wb: XLSX.WorkBook): ParsedAdjustments {
  const out: ParsedAdjustments = { records: [], holidays: [], lates: {}, compHours: {}, foreigners: [] }
  const cleanName = (s: unknown) => String(s || '').replace(/（範例）/g, '').trim()
  const addRec = (name: string, type: string, days: number, sd: Date | null, ed: Date | null) => {
    if (!name || name === '姓名' || name.includes('範例')) return
    if (type && (days !== 0 || type === '到職' || type === '離職')) {
      out.records.push({ name, type, days, startDate: sd, endDate: ed })
    }
  }

  // 1. 上個月不足
  const sShort = findSheet(wb, '上個月不足', '上月不足', '不足')
  if (sShort) {
    const r = XLSX.utils.sheet_to_json(sShort, { header: 1, defval: '' }) as unknown[][]
    const hi = findHeaderRow(r, '姓名')
    r.slice(Math.max(hi, 0) + 1).forEach(row => {
      const name = cleanName(row[0])
      const h = parseFloat(String(row[1] || ''))
      if (name && !isNaN(h) && h > 0) addRec(name, '前月不足', h, null, null)
    })
  }

  // 2. 本月請假
  const sLeave = findSheet(wb, '本月請假', '請假')
  if (sLeave) {
    const r = XLSX.utils.sheet_to_json(sLeave, { header: 1, defval: '' }) as unknown[][]
    const hi = findHeaderRow(r, '假別')
    r.slice(Math.max(hi, 0) + 1).forEach(row => {
      const name = cleanName(row[0])
      const type = String(row[1] || '').trim()
      const days = parseFloat(String(row[4] || ''))
      if (name && type && !isNaN(days) && days > 0) {
        addRec(name, type, days, parseLeaveDate(row[2]), parseLeaveDate(row[3]))
      }
    })
  }

  // 3. 新進與離職（合併或分頁）
  const sHire = findSheet(wb, '新進與離職')
  if (sHire) {
    const r = XLSX.utils.sheet_to_json(sHire, { header: 1, defval: '' }) as unknown[][]
    const hi = findHeaderRow(r, '到職日', '離職日')
    r.slice(Math.max(hi, 0) + 1).forEach(row => {
      const name = cleanName(row[0])
      if (!name) return
      const hireD = parseLeaveDate(row[1])
      const leaveD = parseLeaveDate(row[2])
      if (hireD) addRec(name, '到職', 0, hireD, null)
      if (leaveD) addRec(name, '離職', 0, leaveD, null)
    })
  } else {
    // 舊格式：兩個分頁分開
    const sH = findSheet(wb, '新進人員', '新進')
    if (sH) {
      const r = XLSX.utils.sheet_to_json(sH, { header: 1, defval: '' }) as unknown[][]
      const hi = findHeaderRow(r, '到職日', '到職日期')
      r.slice(Math.max(hi, 0) + 1).forEach(row => {
        const name = cleanName(row[0])
        const d = parseLeaveDate(row[1])
        if (name && d) addRec(name, '到職', 0, d, null)
      })
    }
    const sL = findSheet(wb, '離職人員', '離職')
    if (sL) {
      const r = XLSX.utils.sheet_to_json(sL, { header: 1, defval: '' }) as unknown[][]
      const hi = findHeaderRow(r, '最後上班日', '離職日')
      r.slice(Math.max(hi, 0) + 1).forEach(row => {
        const name = cleanName(row[0])
        const d = parseLeaveDate(row[1])
        if (name && d) addRec(name, '離職', 0, d, null)
      })
    }
  }

  // 4. 其他加扣（其他加扣項目）
  // spec：科目代碼 7004=股東分紅(不計人事成本)、8000=扣項(正數轉負)、其他加項保持正
  const sExtra = findSheet(wb, '其他加扣')
  if (sExtra) {
    const r = XLSX.utils.sheet_to_json(sExtra, { header: 1, defval: '' }) as unknown[][]
    const hi = findHeaderRow(r, '金額')
    r.slice(Math.max(hi, 0) + 1).forEach(row => {
      const name = cleanName(row[0])
      const code = String(row[1] || '').trim()
      const amt = parseFloat(String(row[3] || row[2] || ''))
      if (!name || isHeaderName(name) || isNaN(amt) || amt === 0) return
      if (code === '7004') return  // 股東分紅不計入人事成本
      // 8000 扣項：正數轉負；其他保持原符號
      const finalAmt = code === '8000' ? -Math.abs(amt) : amt
      const rec: AdjRecord = { name, type: '加扣項目', days: finalAmt, startDate: null, endDate: null, code }
      out.records.push(rec)
    })
  }

  // 5. 國定假日
  const sHoli = findSheet(wb, '國定假日', '假日')
  if (sHoli) {
    const r = XLSX.utils.sheet_to_json(sHoli, { header: 1, defval: '' }) as unknown[][]
    const hi = findHeaderRow(r, '日期')
    r.slice(Math.max(hi, 0) + 1).forEach(row => {
      const date = parseLeaveDate(row[0])
      if (!date) return
      const name = String(row[1] || '').trim()
      const mult = parseFloat(String(row[2] || '2')) || 2
      const dateStr = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
      out.holidays.push({ dateStr, date, name, multiplier: mult })
    })
  }

  // 6. 遲到記錄
  const sLate = findSheet(wb, '遲到')
  if (sLate) {
    const r = XLSX.utils.sheet_to_json(sLate, { header: 1, defval: '' }) as unknown[][]
    const hi = findHeaderRow(r, '遲到次數', '累積遲到分鐘')
    r.slice(Math.max(hi, 0) + 1).forEach(row => {
      const name = cleanName(row[0])
      if (isHeaderName(name)) return
      const cnt = parseFloat(String(row[1] || '')) || 0
      const mins = parseFloat(String(row[2] || '')) || 0
      if (name && (cnt > 0 || mins > 0)) out.lates[name] = { count: cnt, mins }
    })
  }

  // 7. 加班換補休
  const sComp = findSheet(wb, '換補休', '補休')
  if (sComp) {
    const r = XLSX.utils.sheet_to_json(sComp, { header: 1, defval: '' }) as unknown[][]
    const hi = findHeaderRow(r, '換補休時數', '補休時數', '時數')
    r.slice(Math.max(hi, 0) + 1).forEach(row => {
      const name = cleanName(row[0])
      if (isHeaderName(name)) return
      const h = parseFloat(String(row[1] || '')) || 0
      if (name && h > 0) out.compHours[name] = (out.compHours[name] || 0) + h
    })
  }

  // 8. 外籍員工
  const sFor = findSheet(wb, '外籍')
  if (sFor) {
    const r = XLSX.utils.sheet_to_json(sFor, { header: 1, defval: '' }) as unknown[][]
    const hi = findHeaderRow(r, '姓名')
    r.slice(Math.max(hi, 0) + 1).forEach(row => {
      const name = cleanName(row[0])
      if (isHeaderName(name)) return
      if (name) out.foreigners.push(name)
    })
  }

  // Fallback: 單頁、舊格式（只有請假）
  if (out.records.length === 0 && !sShort && !sLeave && !sHire && !sExtra) {
    const ws = wb.Sheets[wb.SheetNames[0]]
    if (ws) {
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][]
      const hi = findHeaderRow(rows, '假別')
      const hdr = (rows[Math.max(hi, 0)] as string[]).map(c => String(c).trim())
      const C = (n: string) => hdr.indexOf(n)
      const [cn, ct, cs, ce, cd] = [C('姓名'), C('假別'), C('開始日期'), C('結束日期'), C('請假天數（或不足時數）')]
      rows.slice(Math.max(hi, 0) + 1).filter(r => cn >= 0 && String((r as string[])[cn] || '').trim()).forEach(r => {
        const rr = r as unknown[]
        const name = cleanName(rr[cn])
        const type = String(rr[ct] || '').trim()
        const days = parseFloat(String(rr[cd] || '')) || 0
        addRec(name, type, days, parseLeaveDate(rr[cs]), parseLeaveDate(rr[ce]))
      })
    }
  }

  return out
}

// ── parseBreak ─────────────────────────────────────────────────────────────
export function parseBreak(wb: XLSX.WorkBook): BreakRecord[] {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }) as unknown[][]
  let hi = rows.findIndex(r => String((r as string[])[0]).trim() === '單位')
  if (hi < 0) hi = 0
  const h = (rows[hi] as string[]).map(c => String(c).trim())
  const C = (n: string) => fuzzyCol(h, n)
  const ci = C('工號'), cn = C('姓名'), cd = C('日期')
  const cbs = C('休息開始時間'), cbe = C('休息結束時間')
  const cbsl = C('休息開始地點'), cbel = C('休息結束地點')
  return rows.slice(hi + 1)
    .filter(r => String((r as string[])[ci] || '').trim().startsWith('N'))
    .map(r => {
      const row = r as unknown[]
      const id = String(row[ci]).trim()
      const name = String(row[cn] || '').trim()
      const { str: dateStr } = parseAttDate(row[cd])
      const sMin = parseTimeFrac(row[cbs]) ?? pMin(String(row[cbs] || '').trim()) ?? null
      const eMin = parseTimeFrac(row[cbe]) ?? pMin(String(row[cbe] || '').trim()) ?? null
      const startLoc = cbsl >= 0 ? String(row[cbsl] || '').trim() : ''
      const endLoc = cbel >= 0 ? String(row[cbel] || '').trim() : ''
      let mins = (sMin != null && eMin != null) ? eMin - sMin : 0
      if (mins <= 0 && sMin != null && sMin > 0 && eMin != null) mins += 1440
      return { id, name, dateStr, mins: Math.max(0, mins), startMin: sMin, endMin: eMin, startLoc, endLoc }
    })
    .filter(r => r.mins > 0 && r.dateStr)
}

export function buildBreakMap(breaks: BreakRecord[]): Record<string, number> {
  const map: Record<string, number> = {}
  breaks.forEach(r => {
    const key = `${r.id}:${r.dateStr}`
    map[key] = (map[key] || 0) + r.mins / 60
  })
  return map
}

// ── ExtrasResult helper type ────────────────────────────────────────────────
type ExtraItem = { code: string; desc: string; amt: number; note: string }
export interface ExtrasResult {
  extras: Record<string, number>
  details: Record<string, ExtraItem[]>
}
const emptyExtras = (): ExtrasResult => ({ extras: {}, details: {} })

function addExtra(out: ExtrasResult, id: string, item: ExtraItem) {
  if (!item.amt) return
  out.extras[id] = (out.extras[id] || 0) + item.amt
  if (!out.details[id]) out.details[id] = []
  out.details[id].push(item)
}

export function mergeExtras(...all: ExtrasResult[]): ExtrasResult {
  const out = emptyExtras()
  for (const e of all) {
    Object.entries(e.extras).forEach(([id, amt]) => { out.extras[id] = (out.extras[id] || 0) + amt })
    Object.entries(e.details).forEach(([id, items]) => {
      if (!out.details[id]) out.details[id] = []
      out.details[id].push(...items)
    })
  }
  return out
}

// ── adjExtrasForMonth ───────────────────────────────────────────────────────
// 把調整表的「其他加扣項目」轉成 {empId: 金額/明細} 以便併入 gross_pay
const ADJ_CODE_DESC: Record<string, string> = {
  '6000': '加給', '6004': '人力不足加給', '8000': '扣項-其他',
  '9000': '加項-其他', '5000': '住宿津貼', '20032': '不休假代金-特休',
  '7001': '年終獎金', '6002': '國定假日加給',
}
export function adjExtrasForMonth(
  adj: AdjRecord[], pay: HREmployee[]
): { extras: Record<string, number>; details: Record<string, { code: string; desc: string; amt: number; note: string }[]> } {
  const nameToId: Record<string, string> = {}
  pay.forEach(e => { if (e.name) nameToId[e.name.trim()] = e.id })
  const extras: Record<string, number> = {}
  const details: Record<string, { code: string; desc: string; amt: number; note: string }[]> = {}
  adj.forEach(r => {
    if (r.type !== '加扣項目') return
    const id = nameToId[r.name]
    if (!id) return
    const amt = r.days  // 加扣項目用 days 欄存金額
    extras[id] = (extras[id] || 0) + amt
    if (!details[id]) details[id] = []
    const code = r.code || 'adj'
    const desc = ADJ_CODE_DESC[code] || `調整表加扣項(${code})`
    details[id].push({ code, desc, amt, note: '' })
  })
  return { extras, details }
}

// ── empPfForMonth ───────────────────────────────────────────────────────────
// 新進/離職員工的個別比例：在職天數 / 當月總天數
export function empPfForMonth(
  year: number, month: number,
  adj: AdjRecord[], pay: HREmployee[]
): Record<string, { pf: number; reason: string }> {
  const nameToId: Record<string, string> = {}
  pay.forEach(e => { if (e.name) nameToId[e.name.trim()] = e.id })
  const totalDays = new Date(year, month, 0).getDate()
  const result: Record<string, { pf: number; reason: string }> = {}
  adj.forEach(r => {
    if (!r.startDate) return
    if (r.startDate.getFullYear() !== year || r.startDate.getMonth() !== month - 1) return
    const id = nameToId[r.name]
    if (!id) return
    if (r.type === '到職') {
      const daysWorked = totalDays - r.startDate.getDate() + 1
      result[id] = { pf: daysWorked / totalDays, reason: `新進(${r.startDate.getMonth() + 1}/${r.startDate.getDate()})` }
    } else if (r.type === '離職') {
      result[id] = { pf: r.startDate.getDate() / totalDays, reason: `離職(${r.startDate.getMonth() + 1}/${r.startDate.getDate()})` }
    }
  })
  return result
}

// ── 國定假日加給（工讀）─────────────────────────────────────────────────────
export function holidayPayForMonth(
  holidays: HolidayEntry[], pay: HREmployee[],
  att: AttResult, breakMap: Record<string, number>
): ExtrasResult {
  const out = emptyExtras()
  if (!holidays.length) return out
  const holiMult: Record<string, number> = {}
  holidays.forEach(h => { if (h.dateStr) holiMult[h.dateStr] = h.multiplier || 2 })
  const empById = Object.fromEntries(pay.map(e => [e.id, e]))
  // 累加每位工讀員工在國定假日當天的加給
  const acc: Record<string, { amt: number; days: number }> = {}
  att.records.forEach(p => {
    if (!p.dateStr || !(p.dateStr in holiMult)) return
    const e = empById[p.id]
    if (!e || e.type !== '時薪工讀') return
    const breakH = breakMap[`${p.id}:${p.dateStr}`] || 0
    const netH = Math.max(0, p.hours - breakH)
    if (netH <= 0) return
    const mult = holiMult[p.dateStr]
    const amt = Math.round(netH * e.hourlyRate * (mult - 1))
    if (amt <= 0) return
    if (!acc[p.id]) acc[p.id] = { amt: 0, days: 0 }
    acc[p.id].amt += amt
    acc[p.id].days += 1
  })
  Object.entries(acc).forEach(([id, { amt, days }]) => {
    addExtra(out, id, { code: '6002', desc: '國定假日加給', amt, note: `${days}天` })
  })
  return out
}

// ── 加班換補休：把姓名 map 轉成 id map（calcResults 內依 otH 才能精準扣）──
export function compHoursIdMap(
  compHours: Record<string, number>, pay: HREmployee[]
): Record<string, number> {
  const nameToId: Record<string, string> = {}
  pay.forEach(e => { if (e.name) nameToId[e.name] = e.id })
  const out: Record<string, number> = {}
  Object.entries(compHours).forEach(([name, hrs]) => {
    const id = nameToId[name]
    if (id && hrs > 0) out[id] = (out[id] || 0) + hrs
  })
  return out
}

// ── 遲到扣考績／扣加給 ──────────────────────────────────────────────────────
export function latePenaltyForMonth(
  lates: Record<string, { count: number; mins: number }>, pay: HREmployee[]
): { extras: ExtrasResult; ptZeroIds: Set<string> } {
  const out = emptyExtras()
  const ptZeroIds = new Set<string>()
  const nameToEmp: Record<string, HREmployee> = {}
  pay.forEach(e => { if (e.name) nameToEmp[e.name] = e })
  Object.entries(lates).forEach(([name, { count, mins }]) => {
    const e = nameToEmp[name]
    if (!e) return
    const triggered = count >= 4 || mins >= 20
    if (!triggered) return
    if (e.type === '月薪正職') {
      addExtra(out, e.id, { code: '5001', desc: '遲到扣考績', amt: -2000, note: `${count}次/${mins}分` })
    } else if (e.type === '時薪工讀') {
      ptZeroIds.add(e.id)
    }
  })
  return { extras: out, ptZeroIds }
}

// ── 生日禮金（正職）────────────────────────────────────────────────────────
// 計算月份 = M，發放給生日在 M+1 月的正職員工
export function birthdayBonusForMonth(year: number, month: number, pay: HREmployee[]): ExtrasResult {
  const out = emptyExtras()
  const targetMonth = month === 12 ? 1 : month + 1
  pay.forEach(e => {
    if (e.type !== '月薪正職') return
    if (!e.birthday || !e.hireDate) return
    if (e.birthday.getMonth() + 1 !== targetMonth) return
    // 生日當年到下次生日時到職滿幾年
    const bdayYear = targetMonth === 1 ? year + 1 : year
    let years = bdayYear - e.hireDate.getFullYear()
    const hireMD = (e.hireDate.getMonth() + 1) * 100 + e.hireDate.getDate()
    const bdayMD = (e.birthday.getMonth() + 1) * 100 + e.birthday.getDate()
    if (bdayMD < hireMD) years -= 1
    let amt = 0
    if (years >= 2) amt = 2000
    else if (years >= 1) amt = 1000
    if (amt > 0) addExtra(out, e.id, { code: '9000', desc: '生日禮金', amt, note: `到職${years}年` })
  })
  return out
}

// ── 推測這份調整表是哪個月 ──────────────────────────────────────────────────
// 從本月請假/到離職/國定假日的日期，找出最常出現的 (年, 月)
export function adjTargetMonth(adj: ParsedAdjustments): { year: number; month: number } | null {
  const counts: Record<string, number> = {}
  const bump = (d: Date | null) => {
    if (!d) return
    const k = `${d.getFullYear()}-${d.getMonth() + 1}`
    counts[k] = (counts[k] || 0) + 1
  }
  adj.records.forEach(r => bump(r.startDate))
  adj.holidays.forEach(h => bump(h.date))
  let maxK = '', maxV = 0
  for (const k in counts) if (counts[k] > maxV) { maxV = counts[k]; maxK = k }
  if (!maxK) return null
  const [y, m] = maxK.split('-').map(Number)
  return { year: y, month: m }
}

// ── 外籍員工 id set ────────────────────────────────────────────────────────
export function foreignerIdsFromNames(foreigners: string[], pay: HREmployee[]): Set<string> {
  const set = new Set<string>()
  const names = new Set(foreigners.map(s => s.trim()))
  pay.forEach(e => { if (names.has(e.name)) set.add(e.id) })
  return set
}

// ── adjDeltaForMonth ────────────────────────────────────────────────────────
export function adjDeltaForMonth(
  year: number, month: number,
  adj: AdjRecord[], pay: HREmployee[]
): Record<string, { delta: number; name: string }> {
  const nameToId: Record<string, string> = {}
  pay.forEach(e => { if (e.name) nameToId[e.name.trim()] = e.id })
  // 假別比對（spec MD 第五條）
  const deduct8 = ['特休', '事假', '公傷', '工傷', '公假', '喪假', '婚假']
  const deduct4 = ['病假', '生理假']
  const deltaByName: Record<string, number> = {}
  adj.forEach(r => {
    const { name, type, days, startDate } = r
    const isPrevDeficit = type.includes('前月不足')
    if (!isPrevDeficit) {
      if (!startDate) return
      if (startDate.getFullYear() !== year || startDate.getMonth() !== month - 1) return
    }
    if (!deltaByName[name]) deltaByName[name] = 0
    if (isPrevDeficit) deltaByName[name] += days
    else if (deduct8.some(t => type.includes(t))) deltaByName[name] -= days * 8
    else if (deduct4.some(t => type.includes(t))) deltaByName[name] -= days * 4
  })
  const result: Record<string, { delta: number; name: string }> = {}
  Object.entries(deltaByName).forEach(([name, delta]) => {
    const id = nameToId[name] || ('__name__' + name)
    result[id] = { delta, name }
  })
  return result
}

// ── mapLocToStore ──────────────────────────────────────────────────────────
export const STORE_CATS = ['品牌概念店', '料韓男2號店', '料韓男3號店', '英洙家', '其他']

function mapLocToStore(locName: string): string {
  if (!locName) return '其他'
  const l = locName.replace(/\s/g, '')
  if (l.includes('品牌') && l.includes('概念')) return '品牌概念店'
  if (l.includes('仁愛')) return '品牌概念店'
  if (l.includes('台北') || l.includes('2號') || l.includes('二號') || l.includes('1&2') || l.includes('明曜')) return '料韓男2號店'
  if (l.includes('3號') || l.includes('三號') || l.includes('北屯')) return '料韓男3號店'
  if (l.includes('英洙') || l.includes('英洸')) return '英洙家'
  return '其他'
}

// ── calcResults ────────────────────────────────────────────────────────────
export function calcResults(
  sDate: Date, eDate: Date,
  store: string,
  stdH: number, pf: number,
  adjMap: Record<string, { delta: number; name: string }>,
  excludeMgmt: boolean,
  locFilter: string,
  pay: HREmployee[],
  att: AttResult,
  loc: LocRecord[],
  ovr: Record<string, number> = {},
  breakMap: Record<string, number> = {},
  empPfMap: Record<string, { pf: number; reason: string }> = {},
  foreignerIds: Set<string> = new Set(),
  ptZeroIds: Set<string> = new Set(),
  compHIdMap: Record<string, number> = {}
): CalcResult {
  const recs = att.records.filter(p => p.date && p.date >= sDate && p.date <= eDate)
  const locR = loc.filter(p => p.date && p.date >= sDate && p.date <= eDate)
  const sr = store ? recs.filter(p => p.dept === store) : recs
  const sl = store ? locR.filter(p => sr.some(r => r.id === p.id)) : locR
  const payMap = Object.fromEntries(pay.map(p => [p.id, p]))
  const punchIds = new Set(sr.map(p => p.id))
  const payIds = new Set(pay.filter(e => e.type !== '未設定').map(p => p.id))

  const ruleMap: Record<string, string> = {}
  att.records.forEach(p => { if (p.rule && !ruleMap[p.id]) ruleMap[p.id] = p.rule })

  const hByE: Record<string, number> = {}
  const dByE: Record<string, Record<string, number>> = {}
  sr.forEach(p => {
    if (!hByE[p.id]) { hByE[p.id] = 0; dByE[p.id] = {} }
    const breakH = breakMap[`${p.id}:${p.dateStr}`] || 0
    const netH = Math.max(0, p.hours - breakH)
    hByE[p.id] += netH
    dByE[p.id][p.dateStr] = (dByE[p.id][p.dateStr] || 0) + netH
  })

  const payF = store ? pay.filter(e => e.dept === store || punchIds.has(e.id)) : pay

  const results: EmployeeResult[] = payF.filter(e => {
    if (e.type === '未設定') return false
    if (excludeMgmt && (e.dept.includes('總部') || e.dept.includes('執行長') || e.dept === '')) return false
    if (locFilter) {
      const r = ruleMap[e.id] || ''
      const al = r.includes('內場') ? '內場' : (r ? '外場' : '')
      const l = e.titleLoc || al || '外場'
      if (l !== locFilter) return false
    }
    return true
  }).map(e => {
    const totalH = hByE[e.id] || 0, noPunch = !punchIds.has(e.id)
    const ins = calcIns(e, foreignerIds.has(e.id))
    const eS = effStd(e.id, stdH, adjMap, ovr, pay)

    // 個別員工比例（新進/離職）× 全域 pf（週期模式）
    const empPfEntry = empPfMap[e.id]
    const empPf = empPfEntry?.pf
    const finalPf = (empPf !== undefined ? empPf : 1) * pf
    // 保費獨立用 insPf（不含週期 pf）— 保險是月繳，不該按週期 prorate
    const insPf = empPf !== undefined ? empPf : 1

    // 健保特殊規則（spec 第四條，僅整月結算模式）：
    //   新進：健保全月（不按比例）
    //   離職未滿月：健保 = 0
    //   離職當月最後一天：全月（insPf=1）
    const isNewHire = empPfEntry?.reason?.startsWith('新進') ?? false
    const isMidLeave = (empPfEntry?.reason?.startsWith('離職') ?? false) && insPf < 1
    const calcPropIns = (): number => {
      // 週期模式（pf<1）：簡單按 finalPf 比例計算，當作「期間累積保費」
      if (pf < 1) return ins.total * finalPf
      // 整月模式：套健保特殊規則
      if (isNewHire) return (ins.total - ins.hb) * insPf + ins.hb
      if (isMidLeave) return (ins.total - ins.hb) * insPf
      return ins.total * insPf
    }

    if (e.type === '月薪正職') {
      const hr = ftOTbase(e) / FT_DIV
      // 總部人員不計打卡時數、不計加班費（spec MD 第十一條）
      const isHQ = e.dept.includes('總部') || e.dept.includes('執行長') || e.titleLoc === '總部'
      const rawOtH = isHQ ? 0 : Math.max(0, totalH - eS)
      // 換補休：從加班時數中扣（不扣已成正常工時的部分）
      const compH = compHIdMap[e.id] || 0
      const otH = Math.max(0, rawOtH - compH)
      const otPay = (noPunch || isHQ) ? null : ftOT(otH, hr)
      // 本月不足直接扣薪（時數不足扣回，code 1000）— 已含上月不足挪過來的時數
      // 只在整月結算 (pf=1) 時扣；週期模式下不扣，避免顯示週進度造成的負加扣項
      const shortageRef = eS * finalPf
      const shortageH = (noPunch || isHQ || pf < 1) ? 0 : Math.max(0, shortageRef - totalH)
      const shortageCut = Math.round(shortageH * hr)
      let extraAmt = att.extras ? (att.extras[e.id] || 0) : 0
      let extraDetail = att.extrasDetail ? [...(att.extrasDetail[e.id] || [])] : null
      if (shortageCut > 0) {
        extraAmt -= shortageCut
        if (!extraDetail) extraDetail = []
        extraDetail.push({ code: '1000', desc: '時數不足扣回', amt: -shortageCut, note: `${shortageH.toFixed(2)}H` })
      }
      const gross = noPunch ? null : e.fixedSalary + (otPay || 0) + extraAmt
      const weekStd = eS * finalPf
      const rawWeekOtH = isHQ ? 0 : Math.max(0, totalH - weekStd)
      const weekOtH = Math.max(0, rawWeekOtH - compH)
      const weekOtPay = ftOT(weekOtH, hr)
      const pace = weekStd > 0 ? totalH / weekStd : 0
      const propSal = e.fixedSalary * finalPf
      const propIns = calcPropIns()
      const rule = ruleMap[e.id] || ''
      const attLoc = rule.includes('內場') ? '內場' : (rule ? '外場' : '')
      const loc2 = e.titleLoc || attLoc || '外場'
      return {
        ...e, totalH, noPunch, eStd: eS, hr, otH, otPay, gross, ins, rule, loc: loc2,
        extra: extraAmt, extraDetail, propSal, propIns, propFactor: finalPf,
        weekStd, weekOtH, weekOtPay, pace, ptDailyOt: 0, b66: 0, bH: 0, rAddon: 0,
      }
    } else {
      const extraAmt2 = att.extras ? (att.extras[e.id] || 0) : 0
      const rawBonus = ptBonus(e, totalH)
      // 遲到觸發：所有工讀加給歸零
      const isLatePenalty = ptZeroIds.has(e.id)
      const b66 = isLatePenalty ? 0 : rawBonus.b66
      const rAddon = isLatePenalty ? 0 : rawBonus.rAddon
      const bH = isLatePenalty ? 0 : rawBonus.bH
      const effRate = e.hourlyRate + rAddon
      let base = 0, dot = 0
      Object.values(dByE[e.id] || {}).forEach(dh => { base += dh * effRate; dot += ptOTP(dh, effRate) })
      const gross = base + dot + b66 + bH + extraAmt2
      const projMonthH = finalPf > 0 && finalPf < 1 ? totalH / finalPf : totalH
      const projRaw = ptBonus(e, projMonthH)
      const projB66 = isLatePenalty ? 0 : projRaw.b66
      const projBH = isLatePenalty ? 0 : projRaw.bH
      const propIns = calcPropIns()
      const rule2 = ruleMap[e.id] || ''
      const attLoc2 = rule2.includes('內場') ? '內場' : (rule2 ? '外場' : '')
      const loc2 = e.titleLoc || attLoc2 || '外場'
      const extraDetail2 = att.extrasDetail ? att.extrasDetail[e.id] : null
      return {
        ...e, totalH, noPunch, eStd: 0, hr: effRate, otH: 0, otPay: dot, gross, ins,
        rule: rule2, loc: loc2, propFactor: finalPf, extra: extraAmt2, extraDetail: extraDetail2,
        propSal: gross, propIns, weekStd: 0, weekOtH: 0, weekOtPay: dot, pace: 0,
        ptDailyOt: dot, b66, bH, rAddon, projBH, projB66,
      }
    }
  })

  const anom: Anomaly[] = []
  sr.filter(p => p.crossMidnight).forEach(p =>
    anom.push({ sev: 'warn', type: '跨日打卡', id: p.id, name: p.name, date: p.dateStr, detail: `${p.inTime}→${p.outTime}，已計${p.hours.toFixed(2)}H` })
  )
  payIds.forEach(id => {
    if (!punchIds.has(id)) {
      const e = payMap[id]
      if (e && e.type !== '未設定' && (!store || e.dept === store))
        anom.push({ sev: 'error', type: '無出勤紀錄', id, name: e.name, date: '–', detail: '區間無出勤' })
    }
  })
  punchIds.forEach(id => {
    if (!payMap[id]) {
      const p = sr.find(x => x.id === id)
      if (p) anom.push({ sev: 'info', type: '薪資未建檔', id, name: p.name, date: '–', detail: `有出勤(${(hByE[id] || 0).toFixed(1)}H)` })
    }
  })

  const resultIds = new Set(results.map(e => e.id))
  const filteredLocR = sl.filter(p => resultIds.has(p.id))
  return { results, anom, sr, locR: filteredLocR, isApollo: att.isApollo }
}

// ── renderStoreLoc helper: compute store distribution ─────────────────────
// ── 依 spec「分店分攤邏輯說明.md」做時間切段歸店 ──────────────────────────
// 無休息：整個班次歸下班地點
// 一段休息：上班→休息開始(在 startLoc)、休息結束→下班(在 endLoc)
// 多段休息：依序切割，每段前一個 endLoc 決定下一段歸屬
function segmentByBreaks(
  inMin: number, outMin: number,
  inLoc: string, outLoc: string,
  breaks: { startMin: number; endMin: number; startLoc: string; endLoc: string }[]
): Record<string, number> {
  // 跨日 outMin < inMin → 加 1440
  let oM = outMin
  if (oM <= inMin) oM += 1440
  const out: Record<string, number> = {}
  const add = (loc: string, mins: number) => {
    if (mins <= 0) return
    const cat = mapLocToStore(loc || '未知')
    out[cat] = (out[cat] || 0) + mins / 60
  }
  // 處理跨日休息
  const sorted = breaks.map(b => {
    let bs = b.startMin, be = b.endMin
    if (bs < inMin) bs += 1440
    if (be < bs) be += 1440
    return { startMin: bs, endMin: be, startLoc: b.startLoc || inLoc, endLoc: b.endLoc || outLoc }
  }).sort((a, b) => a.startMin - b.startMin)

  if (sorted.length === 0) {
    add(outLoc, oM - inMin)
    return out
  }
  if (sorted.length === 1) {
    const b = sorted[0]
    add(b.startLoc, b.startMin - inMin)
    add(b.endLoc, oM - b.endMin)
    return out
  }
  // 多段
  add(inLoc, sorted[0].startMin - inMin)
  for (let i = 0; i < sorted.length - 1; i++) {
    add(sorted[i].endLoc, sorted[i + 1].startMin - sorted[i].endMin)
  }
  add(sorted[sorted.length - 1].endLoc, oM - sorted[sorted.length - 1].endMin)
  return out
}

export interface StoreDistRow {
  cat: string
  totalH: number; totalCost: number
  ft: number; pt: number
  ftH: number; ptH: number
  innerH: number; outerH: number
  // 2x2 拆解
  ftInnerH: number; ftOuterH: number
  ptInnerH: number; ptOuterH: number
}

export function computeStoreDist(results: EmployeeResult[], locR: LocRecord[], brk: BreakRecord[] = []): StoreDistRow[] {
  // 過濾掉總部/執行長 — 他們不在店裡工作，分店分攤不該算入
  const isHQ = (e: { dept: string; titleLoc?: string }) =>
    e.dept.includes('總部') || e.dept.includes('執行長') || e.titleLoc === '總部'
  const filteredResults = results.filter(e => !isHQ(e))
  const hqIds = new Set(results.filter(isHQ).map(e => e.id))
  const filteredLocR = locR.filter(p => !hqIds.has(p.id))

  results = filteredResults
  locR = filteredLocR

  const empMap: Record<string, { costPerH: number; periodCost: number; totalH: number }> = {}
  results.forEach(e => {
    const totalH = e.totalH || 0; if (totalH <= 0) return
    const periodCost = e.type === '月薪正職'
      ? (e.propSal || 0) + (e.weekOtPay || 0) + (e.propIns || 0)
      : (e.propSal || 0) + (e.propIns || 0)
    empMap[e.id] = { costPerH: periodCost / totalH, periodCost, totalH }
  })

  const catH: Record<string, Record<string, number>> = {}
  const catFT: Record<string, Set<string>> = {}
  const catPT: Record<string, Set<string>> = {}
  // 2x2 拆解
  const catGrid: Record<string, { ftInner: number; ftOuter: number; ptInner: number; ptOuter: number }> = {}
  STORE_CATS.forEach(c => {
    catH[c] = {}; catFT[c] = new Set(); catPT[c] = new Set()
    catGrid[c] = { ftInner: 0, ftOuter: 0, ptInner: 0, ptOuter: 0 }
  })

  // 將休息紀錄依 (id, dateStr) 分組
  const brkByEmpDay: Record<string, BreakRecord[]> = {}
  brk.forEach(b => {
    const k = `${b.id}:${b.dateStr}`
    if (!brkByEmpDay[k]) brkByEmpDay[k] = []
    brkByEmpDay[k].push(b)
  })

  // 分店分攤的 PT/FT 分類用「職稱」（人事關係）優先於薪資欄位
  // 例如 朴勝駿 職稱「內場正職人員」但本薪=0、時薪=215，秘書視為正職
  const isFTByTitle = (emp: EmployeeResult | undefined): boolean => {
    if (!emp) return false
    if ((emp.title || '').includes('正職')) return true
    if ((emp.title || '').includes('兼職')) return false
    return emp.type === '月薪正職'
  }

  const punchedIds = new Set<string>()
  locR.forEach(p => {
    const h = p.hours || 0; if (h <= 0) return
    punchedIds.add(p.id)
    const emp = results.find(e => e.id === p.id)
    const isInner = emp?.loc === '內場'
    const isFT = isFTByTitle(emp)
    const addH = (cat: string, eid: string, hrs: number) => {
      catH[cat][eid] = (catH[cat][eid] || 0) + hrs
      const bucket = isFT
        ? (isInner ? 'ftInner' : 'ftOuter')
        : (isInner ? 'ptInner' : 'ptOuter')
      catGrid[cat][bucket] += hrs
      if (isFT) catFT[cat].add(eid); else catPT[cat].add(eid)
    }

    // 依 spec：用休息打卡時間切段歸店
    const breaks = (brkByEmpDay[`${p.id}:${p.dateStr}`] || [])
      .filter(b => b.startMin != null && b.endMin != null)
      .map(b => ({ startMin: b.startMin!, endMin: b.endMin!, startLoc: b.startLoc || '', endLoc: b.endLoc || '' }))

    if (p.inMin != null && p.outMin != null) {
      // segments 已扣除休息時間（純工作時段），直接加總
      const segs = segmentByBreaks(p.inMin, p.outMin, p.inLoc, p.outLoc, breaks)
      const segTotal = Object.values(segs).reduce((s, v) => s + v, 0)
      if (segTotal > 0) {
        Object.entries(segs).forEach(([cat, segH]) => addH(cat, p.id, segH))
      } else {
        addH(mapLocToStore(p.outLoc || p.inLoc), p.id, h)
      }
    } else {
      addH(mapLocToStore(p.outLoc || p.inLoc), p.id, h)
    }
  })
  results.forEach(e => {
    if (punchedIds.has(e.id) || e.totalH <= 0) return
    const homeCat = mapLocToStore(e.dept) || '其他'
    const isFT = isFTByTitle(e)
    const isInner = e.loc === '內場'
    catH[homeCat][e.id] = (catH[homeCat][e.id] || 0) + 1
    const bucket = isFT
      ? (isInner ? 'ftInner' : 'ftOuter')
      : (isInner ? 'ptInner' : 'ptOuter')
    catGrid[homeCat][bucket] += 1
    if (isFT) catFT[homeCat].add(e.id); else catPT[homeCat].add(e.id)
  })

  const empLocTotal: Record<string, number> = {}
  STORE_CATS.forEach(cat => Object.entries(catH[cat]).forEach(([eid, h]) => { empLocTotal[eid] = (empLocTotal[eid] || 0) + h }))

  return STORE_CATS.map(cat => {
    const empHours = catH[cat]
    let totalH = 0, totalCost = 0
    Object.entries(empHours).forEach(([eid, h]) => {
      totalH += h
      const c = empMap[eid], empTotH = empLocTotal[eid] || 0
      if (c && empTotH > 0) totalCost += c.periodCost * (h / empTotH)
    })
    const g = catGrid[cat]
    return {
      cat, totalH, totalCost: Math.round(totalCost),
      ft: catFT[cat].size, pt: catPT[cat].size,
      ftH: g.ftInner + g.ftOuter,
      ptH: g.ptInner + g.ptOuter,
      innerH: g.ftInner + g.ptInner,
      outerH: g.ftOuter + g.ptOuter,
      ftInnerH: g.ftInner, ftOuterH: g.ftOuter,
      ptInnerH: g.ptInner, ptOuterH: g.ptOuter,
    }
  }).filter(r => r.totalH > 0)
}

// ── Format helpers (for display in components) ────────────────────────────
export const fT = (n: number) => `$${Math.round(n).toLocaleString('zh-TW')}`
export const fH = (n: number) => `${Number(n).toFixed(2)}H`
export const fN = (n: number, d = 0) => Number(n).toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d })
