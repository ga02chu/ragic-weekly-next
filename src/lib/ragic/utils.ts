export const FRANCHISE_STORES = ['4號店(藝文店)']
export const BRAND_COLOR = '#3c2929'

export const DEFAULT_FIELDS: Record<string, string> = {
  date: '營業日期',
  store: '分店簡稱',
  session: '營業時間',
  revenue: '當日營業額',
  guests: '用餐人數',
  groups: '用餐組數',
  noshow: 'No Show組數',
  avgPay: '客單價',
  supervisor: '值班人員',
  complaint: '當日客訴與事件處理',
  food: '當日食材狀況反應',
  share: '當日其他事件分享',
}

export const STORE_NAME_MAP: Record<string, string> = {
  '明曜店': '2號店(明曜店)',
  '北屯店': '3號店(台中北屯店)',
  '藝文店': '4號店(藝文店)',
  '仁愛店': '品牌概念店(仁愛店)',
  '英洸家': '英洸家',
}

export function getStoreType(name: string): 'direct' | 'franchise' {
  return FRANCHISE_STORES.includes(name) ? 'franchise' : 'direct'
}

export function getStoreDisplayName(name: string): string {
  return name === '4號店(藝文店)' ? '藝文店（加盟）' : name
}

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

export function fmt(n: number): string {
  return Math.round(n).toLocaleString()
}

export function parseRagicDate(dv: string | number): string {
  const s = String(dv || '').trim()
  if (!s || s === '0') return ''
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`
  }
  const m = s.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`
  return s
}

export function toNum(v: unknown): number {
  if (typeof v === 'number') return v
  const n = parseFloat(String(v || '').replace(/,/g, ''))
  return isNaN(n) ? 0 : n
}

// 台灣國定假日 2024-2026
const TW_HOLIDAYS = new Set([
  '2024-01-01','2024-02-08','2024-02-09','2024-02-10','2024-02-11','2024-02-12','2024-02-13','2024-02-14',
  '2024-02-28','2024-04-04','2024-04-05','2024-05-01','2024-06-10','2024-09-17','2024-10-10',
  '2025-01-01','2025-01-27','2025-01-28','2025-01-29','2025-01-30','2025-01-31','2025-02-01','2025-02-02',
  '2025-02-28','2025-04-03','2025-04-04','2025-05-01','2025-05-30','2025-05-31','2025-10-06','2025-10-10',
  '2026-01-01','2026-02-16','2026-02-17','2026-02-18','2026-02-19','2026-02-20','2026-02-21','2026-02-22',
  '2026-02-28','2026-04-02','2026-04-03','2026-04-04','2026-05-01','2026-06-19','2026-09-25','2026-10-09','2026-10-10'
])

export function isHoliday(dateStr: string): boolean {
  const d = new Date(dateStr)
  const dow = d.getDay()
  return dow === 0 || dow === 6 || TW_HOLIDAYS.has(dateStr)
}
