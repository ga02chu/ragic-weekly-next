import { DEFAULT_FIELDS } from './utils'

const CACHE_TTL = 5 * 60 * 1000
let _memCache: Record<string, unknown>[] | null = null
let _memCacheKey = ''
let _memCacheAt = 0

function readSettings() {
  if (typeof window === 'undefined') return { token: '', path: '', extraPaths: [] as string[] }
  try {
    const settings = JSON.parse(localStorage.getItem('ragic_settings') || '{}')
    const extraPaths: string[] = JSON.parse(localStorage.getItem('ragic_extra_paths') || '[]')
    return {
      token: typeof settings.token === 'string' ? settings.token : '',
      path: typeof settings.path === 'string' ? settings.path : '',
      extraPaths: Array.isArray(extraPaths) ? extraPaths.filter(Boolean) : [],
    }
  } catch {
    return { token: '', path: '', extraPaths: [] as string[] }
  }
}

export async function fetchAllRecords(opts?: { force?: boolean }): Promise<Record<string, unknown>[]> {
  const force = opts?.force === true
  const { token, path, extraPaths } = readSettings()
  const localPaths = [path, ...extraPaths].filter(Boolean)

  const cacheKey = localPaths.length ? localPaths.join('|') + token : '__env__'
  const now = Date.now()

  if (!force) {
    if (_memCache && _memCacheKey === cacheKey && now - _memCacheAt < CACHE_TTL) return _memCache

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
  } else {
    // 強制刷新：清掉本機快取
    _memCache = null; _memCacheKey = ''; _memCacheAt = 0
    try { localStorage.removeItem('ragic_cache') } catch { /* ignore */ }
  }

  const all: Record<string, unknown>[] = []

  const pickRecords = (raw: unknown) =>
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? Object.values(raw as Record<string, unknown>).filter(
          (r): r is Record<string, unknown> => typeof r === 'object' && r !== null && !Array.isArray(r)
        )
      : []

  const bust = force ? `&_=${Date.now()}` : ''
  const init: RequestInit = force ? { cache: 'no-store' } : {}
  if (localPaths.length) {
    for (const p of localPaths) {
      try {
        const params = new URLSearchParams({ limit: '3000', path: p })
        if (token) params.set('token', token)
        const res = await fetch(`/api/ragic?${params}${bust}`, init)
        if (!res.ok) continue
        const raw = await res.json()
        all.push(...pickRecords(raw))
      } catch { /* skip */ }
    }
  } else {
    try {
      const res = await fetch(`/api/ragic?limit=3000${bust}`, init)
      if (res.ok) {
        const raw = await res.json()
        all.push(...pickRecords(raw))
      }
    } catch { /* fall through */ }
  }

  // 空結果不寫快取，避免暫時故障被鎖死 5 分鐘
  if (all.length === 0) {
    _memCache = null; _memCacheKey = ''; _memCacheAt = 0
    try { localStorage.removeItem('ragic_cache') } catch { /* ignore */ }
    return all
  }

  _memCache = all; _memCacheKey = cacheKey; _memCacheAt = now
  try { localStorage.setItem('ragic_cache', JSON.stringify({ key: cacheKey, at: now, data: all })) } catch { /* ignore */ }
  return all
}

export function getFields(): Record<string, string> {
  if (typeof window === 'undefined') return { ...DEFAULT_FIELDS }
  return { ...DEFAULT_FIELDS, ...JSON.parse(localStorage.getItem('ragic_fields') || '{}') }
}

export function getMonthlyStdH(year: number, month: number): number {
  if (typeof window === 'undefined') return 173.33
  const saved = JSON.parse(localStorage.getItem('ragic_std_hours') || '{}')
  const key = `${year}-${String(month).padStart(2, '0')}`
  return typeof saved[key] === 'number' ? saved[key] : 173.33
}
