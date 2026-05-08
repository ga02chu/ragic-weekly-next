export interface RagicRecord {
  [key: string]: string | number
}

export interface StoreData {
  name: string
  type: 'direct' | 'franchise'
  revenue: number
  guests: number
  groups: number
  noshow: number
  avgPay: number
  days: number
}

export interface DashboardState {
  dateFrom: string
  dateTo: string
  storeFilter: 'all' | 'direct' | 'franchise'
  sessionFilter: 'all' | 'noon' | 'evening'
  activeRange: string
}

export interface Settings {
  token: string
  path: string
  server: string
}

export interface Fields {
  date: string
  store: string
  revenue: string
  guests: string
  groups: string
  noshow: string
  avgPay: string
  supervisor: string
  complaint: string
  share: string
}
