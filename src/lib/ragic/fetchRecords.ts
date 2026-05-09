import { DEFAULT_FIELDS } from './utils'

const CACHE_TTL = 5 * 60 * 1000
let _memCache: Record<string, unknown>[] | null = null
let _memCacheKey = ''
let _memCacheAt = 0

export async function fetchAllRecords(): Promise<Record<string, unknown>[]> {
  const settings = JSON.parse(localStorage.getItem('ragic_settings') || '{}')
  const extraPaths: string[] = JSON.parse(localStorage.getItem('ragic_extra_paths') || '[]')

  const allPaths = [settings.path, ...extraPaths].filter(Boolean) as string[]
  if (!allPaths.length) return []

  const cacheKey = allPaths.join('|') + (settings.token || '')
  const now = Date.now()

  // memory cache hit
  if (_memCache && _memCacheKey === cacheKey && now - _memCacheAt < CACHE_TTL) return _memCache

  // localStorage cache hit
  try {
    const lsRaw = localStorage.getItem('ragic_cache')
    if (lsRaw) {
      const lsCache = JSON.parse(lsRaw)
      if (lsCache.key === cacheKey && now - lsCache.at < CACHE_TTL) {
        _memCache = lsCache.data; _memCacheKey = cacheKey; _memCacheAt = lsCache.at
        return _memCache!
      }
    }
  } catch { /* ignore */ }

  const all: Record<string, unknown>[] = []
  for (const path of allPaths) {
    try {
      const params = new URLSearchParams({ limit: '3000' })
      if (settings.token) params.set('token', settings.token)
      params.set('path', path)
      const res = await fetch(`/api/ragic?${params}`)
      const raw = await res.json()
      const records = Object.values(raw).filter((r): r is Record<string, unknown> =>
        typeof r === 'object' && r !== null && !Array.isArray(r)
      )
      all.push(...records)
    } catch {
      // skip failed sources
    }
  }

  _memCache = all; _memCacheKey = cacheKey; _memCacheAt = now
  try { localStorage.setItem('ragic_cache', JSON.stringify({ key: cacheKey, at: now, data: all })) } catch { /* ignore */ }
  return all
}

export function getFields(): Record<string, string> {
  return { ...DEFAULT_FIELDS, ...JSON.parse(localStorage.getItem('ragic_fields') || '{}') }
}

export function getMonthlyStdH(year: number, month: number): number {
  const saved = JSON.parse(localStorage.getItem('ragic_std_hours') || '{}')
  const key = `${year}-${String(month).padStart(2, '0')}`
  return typeof saved[key] === 'number' ? saved[key] : 173.33
}
