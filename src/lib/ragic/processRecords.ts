import { toNum, parseRagicDate, getStoreType, getStoreDisplayName } from './utils'

export interface StoreRecord {
  rev: number
  guests: number
  groups: number
  noshow: number
  avgPays: number[]
  records: DayRecord[]
  type: 'direct' | 'franchise'
  displayName: string
}

export interface DayRecord {
  date: string
  session: string
  supervisor: string
  complaint: string
  food: string
  share: string
}

export interface ProcessedData {
  byStore: Record<string, StoreRecord>
  byDate: Record<string, number>
}

export function processRecords(
  records: Record<string, unknown>[],
  fields: Record<string, string>,
  sessionFilter: 'all' | 'noon' | 'evening' = 'all'
): ProcessedData {
  const byStore: Record<string, StoreRecord> = {}
  const byDate: Record<string, number> = {}

  const getVal = (r: Record<string, unknown>, key: string): string => {
    const fieldName = fields[key] || key
    return String(r[fieldName] || '')
  }

  for (const r of records) {
    const storeName  = getVal(r, 'store') || '未知分店'
    const date       = parseRagicDate(getVal(r, 'date'))
    const rev        = toNum(getVal(r, 'revenue'))
    const guests     = toNum(getVal(r, 'guests'))
    const groups     = toNum(getVal(r, 'groups'))
    const noshow     = toNum(getVal(r, 'noshow'))
    const avgPay     = toNum(getVal(r, 'avgPay'))
    const session    = getVal(r, 'session') || ''
    const supervisor = getVal(r, 'supervisor') || '-'
    const complaint  = getVal(r, 'complaint') || ''
    const food       = getVal(r, 'food') || ''
    const share      = getVal(r, 'share') || ''

    if (sessionFilter === 'noon' && session !== '中午') continue
    if (sessionFilter === 'evening' && session !== '晚上') continue

    if (!byStore[storeName]) {
      byStore[storeName] = {
        rev: 0, guests: 0, groups: 0, noshow: 0,
        avgPays: [], records: [],
        type: getStoreType(storeName),
        displayName: getStoreDisplayName(storeName),
      }
    }

    byStore[storeName].rev     += rev
    byStore[storeName].guests  += guests
    byStore[storeName].groups  += groups
    byStore[storeName].noshow  += noshow
    if (avgPay > 0) byStore[storeName].avgPays.push(avgPay)
    byStore[storeName].records.push({ date, session, supervisor, complaint, food, share })
    if (date) byDate[date] = (byDate[date] || 0) + rev
  }

  return { byStore, byDate }
}

export function filterByStoreType(
  byStore: Record<string, StoreRecord>,
  filter: 'all' | 'direct' | 'franchise'
): Record<string, StoreRecord> {
  if (filter === 'all') return byStore
  return Object.fromEntries(
    Object.entries(byStore).filter(([, v]) => v.type === filter)
  )
}
