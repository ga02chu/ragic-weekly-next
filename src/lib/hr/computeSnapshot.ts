// 人事成本計算核心（純函式，無 React / 無 localStorage）。
// HR 頁的「開始計算」按鈕、與「上傳後自動計算」共用同一份，確保數字零漂移。
import {
  buildBreakMap, adjDeltaForMonth, adjExtrasForMonth, empPfForMonth, calcResults,
  computeStoreDist, holidayPayForMonth, compHoursIdMap, latePenaltyForMonth,
  birthdayBonusForMonth, foreignerIdsFromNames, mergeExtras, adjTargetMonth,
  type HREmployee, type AttResult, type LocRecord, type BreakRecord,
  type ParsedAdjustments, type CalcResult,
} from './calc'

export interface ComputeHrArgs {
  pay: HREmployee[]
  att: AttResult
  loc: LocRecord[]
  adj: ParsedAdjustments
  brk: BreakRecord[]
  year: number
  month: number
  viewMode: 'week' | 'month'
  dateFrom?: string
  dateTo?: string
  stdH: number
  storeFilter?: string
  excludeMgmt?: boolean
  locFilter?: string
}

export interface ComputeHrOutput {
  result: CalcResult
  dist: ReturnType<typeof computeStoreDist>
}

// 與原本 hr/page.tsx 的 compute() 計算段落完全一致（只是抽出來共用）。
export function computeHr(args: ComputeHrArgs): ComputeHrOutput {
  const {
    pay, att, loc, adj, brk, year, month, viewMode, stdH,
    storeFilter = '', excludeMgmt = false, locFilter = '',
  } = args
  const dateFrom = args.dateFrom || ''
  const dateTo = args.dateTo || ''

  const monthStart = new Date(year, month - 1, 1)
  const monthEnd = new Date(year, month, 0)
  const totalDays = monthEnd.getDate()
  let sDate: Date, eDate: Date, pf: number

  if (viewMode === 'month') {
    sDate = monthStart; eDate = monthEnd; pf = 1
  } else {
    const today = new Date()
    // 用「本地時間」解析日期字串：new Date('2026-06-08') 會被當 UTC 半夜（台灣 +8 即
    // 早上 8 點），導致該日打卡被擋在期間外、每週第一天被漏算。補 T00:00:00 / T23:59:59。
    let s = dateFrom ? new Date(dateFrom + 'T00:00:00') : monthStart
    let e = dateTo ? new Date(dateTo + 'T23:59:59') : (today < monthEnd ? today : monthEnd)
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

  const breakMap = buildBreakMap(brk)
  const lateRes = adjMonthMatches
    ? latePenaltyForMonth(adj.lates, pay)
    : { extras: { extras: {}, details: {} }, ptZeroIds: new Set<string>() }
  const holidaysInMonth = adjMonthMatches
    ? adj.holidays.filter(h => h.date && h.date.getFullYear() === year && h.date.getMonth() + 1 === month)
    : []
  const merged = mergeExtras(
    { extras: att.extras || {}, details: att.extrasDetail || {} },
    adjMonthMatches
      ? (adjExtrasForMonth(adj.records, pay) as { extras: Record<string, number>; details: Record<string, { code: string; desc: string; amt: number; note: string }[]> })
      : { extras: {}, details: {} },
    holidayPayForMonth(holidaysInMonth, pay, att, breakMap),
    lateRes.extras,
    birthdayBonusForMonth(year, month, pay),
  )
  const mergedAtt: AttResult = { ...att, extras: merged.extras, extrasDetail: merged.details }

  const empPfMap = empPfForMonth(year, month, adj.records, pay)
  const foreignerIds = foreignerIdsFromNames(adj.foreigners, pay)
  const compHIdM = adjMonthMatches ? compHoursIdMap(adj.compHours, pay) : {}

  const result = calcResults(
    sDate, eDate, storeFilter, stdH, pf, adjMap, excludeMgmt, locFilter,
    pay, mergedAtt, loc, {}, breakMap, empPfMap, foreignerIds, lateRes.ptZeroIds, compHIdM,
  )
  const dist = computeStoreDist(result.results, result.locR, brk)
  return { result, dist }
}

// 從一批已 rehydrate 的資料推出「資料實際涵蓋的月份與日期區間」，給自動計算用。
export function detectPeriod(att: AttResult): { year: number; month: number; from: string; to: string } | null {
  const ds = att.records.map(r => r.dateStr).filter(Boolean).map(s => s.replace(/\//g, '-').slice(0, 10)).sort()
  if (ds.length === 0) return null
  const from = ds[0], to = ds[ds.length - 1]
  // 用最後一天決定計算月份（資料通常落在同一個月）
  const [y, m] = to.split('-').map(Number)
  return { year: y, month: m, from, to }
}
