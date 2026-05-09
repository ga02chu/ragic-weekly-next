import * as XLSX from 'xlsx'

// ── 保費費率（雇主負擔）────────────────────────────────────────────────────
export const R = { lb: 0.0875, voc: 0.00195, rsv: 0.00025, pen: 0.06, hb: 0.0484 }
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
}

export interface AdjRecord {
  name: string; type: string; days: number
  startDate: Date | null; endDate: Date | null
}

export interface BreakRecord {
  id: string; name: string; dateStr: string; mins: number
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
function calcIns(e: HREmployee): Insurance {
  const lb = (e.lbB || 0) * R.lb
  const voc = (e.vocB || 0) * R.voc
  const rsv = (e.lbB || 0) * R.rsv
  const pen = (e.penB || 0) * R.pen
  const hb = (e.hbB || 0) * R.hb
  return { lb, voc, rsv, pen, hb, total: lb + voc + rsv + pen + hb }
}

// ── PT bonus ───────────────────────────────────────────────────────────────
function ptBonus(dept: string, h: number): { b66: number; rAddon: number; bH: number } {
  const isE = dept === '英洙家'
  let b66 = 0, rAddon = 0
  if (isE) { if (h >= 66) b66 = 600 } else { if (h >= 66) rAddon = 10 }
  const bH = h >= 100 ? 1000 : 0
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
    }
  })
}

// ── parseAtt ───────────────────────────────────────────────────────────────
export function parseAtt(wb: XLSX.WorkBook): AttResult {
  const EXTRA_INCLUDE = ['1000', '2000', '5001', '6000', '6004', '7000', '8000', '9000', '20032', '7001', '6005', '6001', '6003']
  const EXTRA_SKIP = ['7004', '3006', '3007', '3008']
  const CODE_DESC: Record<string, string> = {
    '1000': '時數不足扣回', '2000': '免稅加班費', '5001': '考績獎金',
    '6000': '加給', '6004': '人力不足加給', '8000': '扣項-其他', '9000': '加項-其他',
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
      return { id: String(row[ci]).trim(), name: String(row[cn] || '').trim(), dateStr, date, inLoc: inL, outLoc: outL, hours: hrs, cross }
    })
}

// ── parseAdj ───────────────────────────────────────────────────────────────
export function parseAdj(wb: XLSX.WorkBook): AdjRecord[] {
  const records: AdjRecord[] = []
  const addLeave = (name: string, type: string, days: number, startDate: Date | null, endDate: Date | null) => {
    name = name.replace(/（範例）/g, '').trim()
    if (!name || name === '姓名' || name.includes('範例')) return
    if (name && type && (days !== 0 || type === '到職' || type === '離職'))
      records.push({ name, type, days, startDate, endDate })
  }

  const isMulti = wb.SheetNames.some(n => ['上個月不足', '本月請假', '新進人員', '離職人員'].includes(n))
  if (isMulti) {
    const s1 = wb.Sheets['上個月不足']
    if (s1) {
      const r = XLSX.utils.sheet_to_json(s1, { header: 1, defval: '' }) as string[][]
      const hi = r.findIndex(row => row.some(c => String(c).trim() === '姓名'))
      r.slice(Math.max(hi, 0) + 1).forEach(row => {
        const name = String(row[0] || '').trim()
        const h = parseFloat(row[1])
        if (name && !isNaN(h) && h > 0) addLeave(name, '前月不足', h, null, null)
      })
    }
    const s2 = wb.Sheets['本月請假']
    if (s2) {
      const r = XLSX.utils.sheet_to_json(s2, { header: 1, defval: '' }) as unknown[][]
      const hi = r.findIndex(row => (row as string[]).some(c => String(c).trim() === '假別'))
      r.slice(Math.max(hi, 0) + 1).forEach(row => {
        const rr = row as unknown[]
        const name = String(rr[0] || '').trim()
        const type = String(rr[1] || '').trim()
        const days = parseFloat(String(rr[4] || ''))
        if (name && type && !isNaN(days) && days > 0)
          addLeave(name, type, days, parseLeaveDate(rr[2]), parseLeaveDate(rr[3]))
      })
    }
    const s3 = wb.Sheets['新進人員']
    if (s3) {
      const r = XLSX.utils.sheet_to_json(s3, { header: 1, defval: '' }) as unknown[][]
      const hi = r.findIndex(row => (row as string[]).some(c => String(c).trim() === '到職日期'))
      r.slice(Math.max(hi, 0) + 1).forEach(row => {
        const rr = row as unknown[]
        const name = String(rr[0] || '').trim()
        const d = parseLeaveDate(rr[1])
        if (name && d) addLeave(name, '到職', 0, d, null)
      })
    }
    const s4 = wb.Sheets['離職人員']
    if (s4) {
      const r = XLSX.utils.sheet_to_json(s4, { header: 1, defval: '' }) as unknown[][]
      const hi = r.findIndex(row => (row as string[]).some(c => String(c).trim() === '最後上班日'))
      r.slice(Math.max(hi, 0) + 1).forEach(row => {
        const rr = row as unknown[]
        const name = String(rr[0] || '').trim()
        const d = parseLeaveDate(rr[1])
        if (name && d) addLeave(name, '離職', 0, d, null)
      })
    }
    const s5 = wb.Sheets['其他加扣項目']
    if (s5) {
      const r = XLSX.utils.sheet_to_json(s5, { header: 1, defval: '' }) as unknown[][]
      const hi = r.findIndex(row => (row as string[]).some(c => String(c).trim() === '金額'))
      r.slice(Math.max(hi, 0) + 1).forEach(row => {
        const rr = row as unknown[]
        const name = String(rr[0] || '').trim()
        const amt = parseFloat(String(rr[2] || ''))
        if (name && !isNaN(amt) && amt !== 0) addLeave(name, '加扣項目', amt, null, null)
      })
    }
  } else {
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][]
    let hi = rows.findIndex(r => (r as string[]).some(c => String(c).trim() === '假別'))
    if (hi < 0) hi = 0
    const hdr = (rows[hi] as string[]).map(c => String(c).trim())
    const C = (n: string) => hdr.indexOf(n)
    const [cn, ct, cs, ce, cd] = [C('姓名'), C('假別'), C('開始日期'), C('結束日期'), C('請假天數（或不足時數）')]
    rows.slice(hi + 1).filter(r => String((r as string[])[cn] || '').trim()).forEach(r => {
      const rr = r as unknown[]
      const name = String(rr[cn]).trim()
      const type = String(rr[ct] || '').trim()
      const days = parseFloat(String(rr[cd] || '')) || 0
      addLeave(name, type, days, parseLeaveDate(rr[cs]), parseLeaveDate(rr[ce]))
    })
  }
  return records
}

// ── parseBreak ─────────────────────────────────────────────────────────────
export function parseBreak(wb: XLSX.WorkBook): BreakRecord[] {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }) as unknown[][]
  let hi = rows.findIndex(r => String((r as string[])[0]).trim() === '單位')
  if (hi < 0) hi = 0
  const h = (rows[hi] as string[]).map(c => String(c).trim())
  const C = (n: string) => fuzzyCol(h, n)
  const ci = C('工號'), cn = C('姓名'), cd = C('日期'), cbs = C('休息開始時間'), cbe = C('休息結束時間')
  return rows.slice(hi + 1)
    .filter(r => String((r as string[])[ci] || '').trim().startsWith('N'))
    .map(r => {
      const row = r as unknown[]
      const id = String(row[ci]).trim()
      const name = String(row[cn] || '').trim()
      const { str: dateStr } = parseAttDate(row[cd])
      const sMin = parseTimeFrac(row[cbs]) ?? pMin(String(row[cbs] || '').trim()) ?? 0
      const eMin = parseTimeFrac(row[cbe]) ?? pMin(String(row[cbe] || '').trim()) ?? 0
      let mins = eMin - sMin
      if (mins <= 0 && sMin > 0) mins += 1440
      return { id, name, dateStr, mins: Math.max(0, mins) }
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

// ── adjExtrasForMonth ───────────────────────────────────────────────────────
// 把調整表的「其他加扣項目」轉成 {empId: 金額/明細} 以便併入 gross_pay
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
    extras[id] = (extras[id] || 0) + r.days  // adj 表 加扣項目 用 days 欄存金額
    if (!details[id]) details[id] = []
    details[id].push({ code: 'adj', desc: '調整表加扣項', amt: r.days, note: '' })
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

// ── adjDeltaForMonth ────────────────────────────────────────────────────────
export function adjDeltaForMonth(
  year: number, month: number,
  adj: AdjRecord[], pay: HREmployee[]
): Record<string, { delta: number; name: string }> {
  const nameToId: Record<string, string> = {}
  pay.forEach(e => { if (e.name) nameToId[e.name.trim()] = e.id })
  const deduct8 = ['特休', '事假', '公傷假', '公假']
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
  empPfMap: Record<string, { pf: number; reason: string }> = {}
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
    const ins = calcIns(e)
    const eS = effStd(e.id, stdH, adjMap, ovr, pay)

    // 個別員工比例（新進/離職）× 全域 pf（週期模式）
    const empPf = empPfMap[e.id]?.pf
    const finalPf = (empPf !== undefined ? empPf : 1) * pf

    if (e.type === '月薪正職') {
      const hr = ftOTbase(e) / FT_DIV
      const otH = Math.max(0, totalH - eS)
      const otPay = noPunch ? null : ftOT(otH, hr)
      const extraAmt = att.extras ? (att.extras[e.id] || 0) : 0
      const gross = noPunch ? null : e.fixedSalary + (otPay || 0) + extraAmt
      const weekStd = eS * finalPf
      const weekOtH = Math.max(0, totalH - weekStd)
      const weekOtPay = ftOT(weekOtH, hr)
      const pace = weekStd > 0 ? totalH / weekStd : 0
      const propSal = e.fixedSalary * finalPf
      const propIns = ins.total * finalPf
      const rule = ruleMap[e.id] || ''
      const attLoc = rule.includes('內場') ? '內場' : (rule ? '外場' : '')
      const loc2 = e.titleLoc || attLoc || '外場'
      const extraDetail = att.extrasDetail ? att.extrasDetail[e.id] : null
      return {
        ...e, totalH, noPunch, eStd: eS, hr, otH, otPay, gross, ins, rule, loc: loc2,
        extra: extraAmt, extraDetail, propSal, propIns, propFactor: finalPf,
        weekStd, weekOtH, weekOtPay, pace, ptDailyOt: 0, b66: 0, bH: 0, rAddon: 0,
      }
    } else {
      const extraAmt2 = att.extras ? (att.extras[e.id] || 0) : 0
      const { b66, rAddon, bH } = ptBonus(e.dept, totalH)
      const effRate = e.hourlyRate + rAddon
      let base = 0, dot = 0
      Object.values(dByE[e.id] || {}).forEach(dh => { base += dh * effRate; dot += ptOTP(dh, effRate) })
      const gross = base + dot + b66 + bH + extraAmt2
      const projMonthH = finalPf > 0 && finalPf < 1 ? totalH / finalPf : totalH
      const { b66: projB66, bH: projBH } = ptBonus(e.dept, projMonthH)
      const propIns = ins.total * finalPf
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
export function computeStoreDist(
  results: EmployeeResult[],
  locR: LocRecord[]
): { cat: string; totalH: number; totalCost: number; ft: number; pt: number; innerH: number; outerH: number }[] {
  const empMap: Record<string, { costPerH: number; periodCost: number; totalH: number }> = {}
  results.forEach(e => {
    const totalH = e.totalH || 0; if (totalH <= 0) return
    const periodCost = e.type === '月薪正職'
      ? (e.propSal || 0) + (e.weekOtPay || 0) + (e.propIns || 0)
      : (e.propSal || 0) + (e.propIns || 0)
    empMap[e.id] = { costPerH: periodCost / totalH, periodCost, totalH }
  })

  const catH: Record<string, Record<string, number>> = {}
  const catLocH: Record<string, { inner: number; outer: number }> = {}
  const catFT: Record<string, Set<string>> = {}
  const catPT: Record<string, Set<string>> = {}
  STORE_CATS.forEach(c => { catH[c] = {}; catLocH[c] = { inner: 0, outer: 0 }; catFT[c] = new Set(); catPT[c] = new Set() })

  const punchedIds = new Set<string>()
  locR.forEach(p => {
    const h = p.hours || 0; if (h <= 0) return
    punchedIds.add(p.id)
    const emp = results.find(e => e.id === p.id)
    const isInner = emp?.loc === '內場'
    const addH = (cat: string, eid: string, hrs: number) => {
      catH[cat][eid] = (catH[cat][eid] || 0) + hrs
      if (isInner) catLocH[cat].inner += hrs; else catLocH[cat].outer += hrs
      if (emp?.type === '月薪正職') catFT[cat].add(eid); else catPT[cat].add(eid)
    }
    if (p.cross) {
      const c1 = mapLocToStore(p.inLoc), c2 = mapLocToStore(p.outLoc)
      addH(c1, p.id, h / 2); addH(c2, p.id, h / 2)
    } else {
      addH(mapLocToStore(p.inLoc), p.id, h)
    }
  })
  results.forEach(e => {
    if (punchedIds.has(e.id) || e.totalH <= 0) return
    const homeCat = mapLocToStore(e.dept) || '其他'
    catH[homeCat][e.id] = (catH[homeCat][e.id] || 0) + 1
    if (e.loc === '內場') catLocH[homeCat].inner += 1; else catLocH[homeCat].outer += 1
    if (e.type === '月薪正職') catFT[homeCat].add(e.id); else catPT[homeCat].add(e.id)
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
    return {
      cat, totalH, totalCost: Math.round(totalCost),
      ft: catFT[cat].size, pt: catPT[cat].size,
      innerH: catLocH[cat].inner, outerH: catLocH[cat].outer,
    }
  }).filter(r => r.totalH > 0)
}

// ── Format helpers (for display in components) ────────────────────────────
export const fT = (n: number) => `$${Math.round(n).toLocaleString('zh-TW')}`
export const fH = (n: number) => `${Number(n).toFixed(2)}H`
export const fN = (n: number, d = 0) => Number(n).toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d })
