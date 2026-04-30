// ── Shared utilities ──

export const BRAND = '#3c2929'
export const BRAND_LIGHT = '#f5efef'
export const COLORS = [BRAND, '#5c7a6e', '#8B6914', '#1e4d8c', '#6b4c8a', '#1a6b4a', '#7a3a1e', '#2d5a6b']
export const FRANCHISE_STORES = ['4號店(藝文店)']

export const STORE_NAME_MAP = {
  '明曜店': '2號店(明曜店)',
  '北屯店': '3號店(台中北屯店)',
  '台中北屯店': '3號店(台中北屯店)',
  '藝文店': '4號店(藝文店)',
  '仁愛店': '品牌概念店(仁愛店)',
  '英洸家': '英洸家',
}

export const DEFAULT_FIELDS = {
  date: '營業日期', store: '分店簡稱', session: '營業時間',
  rev: '當日營業額', guests: '用餐人數', groups: '用餐組數',
  noshow: 'No Show 組數', avgPay: '客單價', supervisor: '值班人員',
  complaint: '當日客訴與事件處理', food: '當日食材狀況反應', share: '當日其他事件分享',
}

export const TW_HOLIDAYS = new Set([
  '2024-01-01','2024-02-08','2024-02-09','2024-02-10','2024-02-11','2024-02-12','2024-02-13','2024-02-14',
  '2024-02-28','2024-04-04','2024-04-05','2024-05-01','2024-06-10','2024-09-17','2024-10-10',
  '2025-01-01','2025-01-27','2025-01-28','2025-01-29','2025-01-30','2025-01-31','2025-02-03','2025-02-04',
  '2025-02-28','2025-04-03','2025-04-04','2025-05-01','2025-05-30','2025-06-10','2025-10-06','2025-10-10',
  '2026-01-01','2026-02-16','2026-02-17','2026-02-18','2026-02-19','2026-02-20','2026-02-23','2026-02-24',
  '2026-02-28','2026-04-03','2026-04-04','2026-05-01','2026-06-19','2026-09-25','2026-10-09','2026-10-10',
])

export function isHoliday(dateStr) {
  if (!dateStr) return false
  const d = new Date(String(dateStr).replace(/\//g, '-'))
  const dow = d.getDay()
  const iso = String(dateStr).replace(/\//g, '-').slice(0, 10)
  return dow === 0 || dow === 6 || TW_HOLIDAYS.has(iso)
}

export function getStoreType(name) { return FRANCHISE_STORES.includes(name) ? 'franchise' : 'direct' }
export function getStoreDisplayName(name) { return name === '4號店(藝文店)' ? '藝文店（加盟）' : name }

export function fmt(n) { return Math.round(n).toLocaleString() }
export function fmtD(s) { return s ? String(s).replace(/-/g, '/') : '-' }

export function toLocalISO(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function getRange(key) {
  const t = new Date()
  const dow = t.getDay()
  let from, to
  if (key === 'thisweek') {
    from = new Date(t); from.setDate(t.getDate() - (dow === 0 ? 6 : dow - 1))
    to = new Date(from); to.setDate(from.getDate() + 6)
  } else if (key === 'lastweek') {
    from = new Date(t); from.setDate(t.getDate() - (dow === 0 ? 6 : dow - 1) - 7)
    to = new Date(from); to.setDate(from.getDate() + 6)
  } else if (key === 'thismonth') {
    from = new Date(t.getFullYear(), t.getMonth(), 1)
    to = new Date(t.getFullYear(), t.getMonth() + 1, 0)
  } else if (key === 'lastmonth') {
    from = new Date(t.getFullYear(), t.getMonth() - 1, 1)
    to = new Date(t.getFullYear(), t.getMonth(), 0)
  }
  return { from: toLocalISO(from), to: toLocalISO(to) }
}

export function getPrevRange(dateFrom, dateTo) {
  const from = new Date(dateFrom)
  const to = new Date(dateTo)
  const diff = to - from
  const prevTo = new Date(from - 86400000)
  const prevFrom = new Date(prevTo - diff)
  return { from: toLocalISO(prevFrom), to: toLocalISO(prevTo) }
}

export function parseRagicDate(dv) {
  if (!dv) return null
  const s = String(dv).trim()
  let d = new Date(s.replace(/\//g, '-'))
  if (!isNaN(d)) return d
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdy) return new Date(`${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`)
  return null
}

export function getVal(r, key, customFields = {}) {
  const fields = { ...DEFAULT_FIELDS, ...customFields }
  const field = fields[key] || key
  const aliases = {
    date: [field, '營業日期', '日期', 'Date'],
    store: [field, '分店簡稱', '分店'],
    session: [field, '營業時間'],
    rev: [field, '當日營業額', '營業額'],
    guests: [field, '用餐人數', '來客數'],
    groups: [field, '用餐組數', '訂單數'],
    noshow: [field, 'No Show 組數', 'No Show組數', 'No Show'],
    avgPay: [field, '客單價'],
    supervisor: [field, '值班人員', '值班主管'],
    complaint: [field, '當日客訴與事件處理', '客訴'],
    food: [field, '當日食材狀況反應'],
    share: [field, '當日其他事件分享'],
  }
  const list = aliases[key] || [field]
  for (const k of list) { if (r[k] !== undefined && r[k] !== '') return r[k] }
  return null
}

export function toNum(v) {
  if (v === null || v === undefined) return 0
  return parseFloat(String(v).replace(/[$,\s]/g, '')) || 0
}

export function processRecords(records, sessionFilter = 'all', storeFilter = 'all') {
  const byStore = {}, byDate = {}
  for (const r of records) {
    const storeName = getVal(r, 'store') || '未知分店'
    const session = getVal(r, 'session') || ''
    if (sessionFilter === 'noon' && session !== '中午') continue
    if (sessionFilter === 'evening' && session !== '晚上') continue
    const type = getStoreType(storeName)
    if (storeFilter === 'direct' && type !== 'direct') continue
    if (storeFilter === 'franchise' && type !== 'franchise') continue

    const date = getVal(r, 'date') || ''
    const rev = toNum(getVal(r, 'rev'))
    const guests = toNum(getVal(r, 'guests'))
    const groups = toNum(getVal(r, 'groups'))
    const noshow = toNum(getVal(r, 'noshow'))
    const avgPay = toNum(getVal(r, 'avgPay'))
    const supervisor = getVal(r, 'supervisor') || '-'
    const complaint = getVal(r, 'complaint') || ''
    const food = getVal(r, 'food') || ''
    const share = getVal(r, 'share') || ''

    if (!byStore[storeName]) byStore[storeName] = {
      rev: 0, guests: 0, groups: 0, noshow: 0, avgPays: [], records: [],
      type, displayName: getStoreDisplayName(storeName),
    }
    byStore[storeName].rev += rev
    byStore[storeName].guests += guests
    byStore[storeName].groups += groups
    byStore[storeName].noshow += noshow
    if (avgPay > 0) byStore[storeName].avgPays.push(avgPay)
    byStore[storeName].records.push({ date, session, supervisor, complaint, food, share })
    if (date) byDate[date] = (byDate[date] || 0) + rev
  }
  return { byStore, byDate }
}

export function diffBadge(curr, prev) {
  if (!prev || prev === 0) return null
  const pct = ((curr - prev) / prev * 100).toFixed(1)
  const up = curr >= prev
  return { pct: Math.abs(pct), up }
}

export async function fetchRange(token, path, dateFrom, dateTo) {
  const params = new URLSearchParams({ limit: 3000 })
  if (path) params.set('path', path)
  if (token) params.set('token', token)
  const res = await fetch(`/api/ragic?${params}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const raw = await res.json()
  if (raw.status === 'ERROR') throw new Error(raw.msg)

  const from = new Date(dateFrom); from.setHours(0, 0, 0, 0)
  const to = new Date(dateTo); to.setHours(23, 59, 59, 999)
  const allValues = Object.values(raw).filter(r => typeof r === 'object' && r && !Array.isArray(r))
  return allValues.filter(r => {
    const dateFields = ['營業日期', '日期', 'Date']
    let dv = null
    for (const f of dateFields) { if (r[f] !== undefined && r[f] !== '') { dv = r[f]; break } }
    if (!dv) return false
    const dt = parseRagicDate(dv)
    if (!dt || isNaN(dt)) return false
    return dt >= from && dt <= to
  })
}

export function getSettings() {
  try { return JSON.parse(localStorage.getItem('ragic_settings') || '{}') } catch { return {} }
}
export function saveSettings(s) {
  localStorage.setItem('ragic_settings', JSON.stringify(s))
}
export function getCustomFields() {
  try { return JSON.parse(localStorage.getItem('ragic_fields') || '{}') } catch { return {} }
}
