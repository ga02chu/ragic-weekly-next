'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { toISO, fmt } from '@/lib/ragic/utils'
import { processRecords, filterByStoreType } from '@/lib/ragic/processRecords'
import { fetchAllRecords, getFields } from '@/lib/ragic/fetchRecords'

const BRAND = '#3c2929'

type StoreFilter = 'all' | 'direct' | 'franchise'
type SessionFilter = 'all' | 'noon' | 'evening'
type RangeKey = 'thisweek' | 'lastweek' | 'thismonth' | 'lastmonth' | 'custom'

function getRange(key: RangeKey) {
  const t = new Date(); const dow = t.getDay()
  let from: Date, to: Date
  if (key === 'thisweek') {
    from = new Date(t); from.setDate(t.getDate() - (dow === 0 ? 6 : dow - 1))
    to = new Date(from); to.setDate(from.getDate() + 6)
  } else if (key === 'lastweek') {
    from = new Date(t); from.setDate(t.getDate() - (dow === 0 ? 6 : dow - 1) - 7)
    to = new Date(from); to.setDate(from.getDate() + 6)
  } else if (key === 'thismonth') {
    from = new Date(t.getFullYear(), t.getMonth(), 1)
    to = new Date(t.getFullYear(), t.getMonth() + 1, 0)
  } else {
    from = new Date(t.getFullYear(), t.getMonth() - 1, 1)
    to = new Date(t.getFullYear(), t.getMonth(), 0)
  }
  return { from: toISO(from), to: toISO(to) }
}

const QUIET = ['無', '無客訴', '無事件分享', '無食材狀況']
const isQuiet = (s: string) => !s || QUIET.includes(s.trim())

// 簡易 hash（FNV-1a）— 用來判斷 logs 內容是否變動
function logsHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}
const aiCacheKey = (from: string, to: string, store: string, session: string) => `ai_${from}_${to}_${store}_${session}`

export default function LogsPage() {
  const initial = getRange('thismonth')
  const [dateFrom, setDateFrom] = useState(initial.from)
  const [dateTo, setDateTo] = useState(initial.to)
  const [activeRange, setActiveRange] = useState<RangeKey>('thismonth')
  const mounted = useRef(false)
  const [storeFilter, setStoreFilter] = useState<StoreFilter>('all')
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [byStore, setByStore] = useState<ReturnType<typeof processRecords>['byStore']>({})
  const [aiText, setAiText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiDone, setAiDone] = useState(false)
  const [aiCachedAt, setAiCachedAt] = useState<number | null>(null)
  const [forceReanalyze, setForceReanalyze] = useState(false)

  const applyRange = (key: RangeKey) => {
    if (key === 'custom') { setActiveRange(key); return }
    const r = getRange(key); setDateFrom(r.from); setDateTo(r.to); setActiveRange(key)
  }

  const fetchData = useCallback(async () => {
    if (!dateFrom || !dateTo) return
    setLoading(true); setError(''); setAiText(''); setAiDone(false); setAiCachedAt(null)
    try {
      const all = await fetchAllRecords()
      const fields = getFields()
      const dateField = fields.date || '營業日期'
      const inRange = all.filter(r => {
        const d = String(r[dateField] || '').replace(/\//g, '-').slice(0, 10)
        return d >= dateFrom && d <= dateTo
      })
      const processed = processRecords(inRange, fields, sessionFilter)
      setByStore(processed.byStore)
      setLoading(false)

      // AI analysis
      const stores = filterByStoreType(processed.byStore, 'direct')
      let logsText = ''
      for (const [, s] of Object.entries(stores).sort(([a], [b]) => a.localeCompare(b))) {
        const recs = [...s.records].sort((a, b) => a.date.localeCompare(b.date))
        logsText += `【${s.displayName}】\n`
        for (const r of recs) {
          const hasC = !isQuiet(r.complaint), hasF = !isQuiet(r.food), hasS = !isQuiet(r.share)
          if (!hasC && !hasF && !hasS) continue
          logsText += `${r.date.replace(/-/g, '/')} 值班：${r.supervisor}\n`
          if (hasC) logsText += `  客訴：${r.complaint}\n`
          if (hasF) logsText += `  食材：${r.food}\n`
          if (hasS) logsText += `  分享：${r.share}\n`
        }
        logsText += '\n'
      }

      if (logsText.trim()) {
        const cKey = aiCacheKey(dateFrom, dateTo, storeFilter, sessionFilter)
        const lh = logsHash(logsText)
        // 嘗試讀快取（除非按了「重新分析」）
        if (!forceReanalyze) {
          try {
            const cached = localStorage.getItem(cKey)
            if (cached) {
              const obj = JSON.parse(cached) as { text: string; logsHash: string; savedAt: number }
              if (obj.logsHash === lh && obj.text) {
                setAiText(obj.text)
                setAiDone(true)
                setAiCachedAt(obj.savedAt)
                setLoading(false)
                return
              }
            }
          } catch { /* ignore */ }
        }
        setAiLoading(true)
        try {
          const aiRes = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ logs: logsText, dateFrom, dateTo }),
          })
          const aiData = await aiRes.json()
          if (aiData.error) {
            setAiText(`AI 分析失敗：${aiData.error}`)
          } else {
            const text = aiData.text || ''
            setAiText(text)
            try {
              localStorage.setItem(cKey, JSON.stringify({ text, logsHash: lh, savedAt: Date.now() }))
            } catch { /* ignore */ }
          }
          setAiDone(true)
        } catch (e: unknown) {
          setAiText(`AI 分析暫時無法使用：${e instanceof Error ? e.message : ''}`)
          setAiDone(true)
        }
        setAiLoading(false)
        setForceReanalyze(false)
      }
    } catch (e: unknown) { setError(e instanceof Error ? e.message : '載入失敗'); setLoading(false) }
  }, [dateFrom, dateTo, sessionFilter, storeFilter, forceReanalyze])

  useEffect(() => {
    if (!mounted.current) { mounted.current = true; fetchData() }
  }, [fetchData])

  const filtered = Object.fromEntries(
    Object.entries(filterByStoreType(byStore, storeFilter))
      .filter(([, s]) => !s.displayName.includes('桃園') && !s.displayName.includes('藝文'))
  )
  const hasData = Object.keys(filtered).length > 0

  const btnStyle = (active: boolean) => ({
    padding: '5px 14px', borderRadius: 20, border: '1.5px solid',
    borderColor: active ? BRAND : '#e5e7eb', background: active ? BRAND : '#fff',
    color: active ? '#fff' : '#374151', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  } as React.CSSProperties)

  const formatAiLine = (line: string, i: number) => {
    if (['📊', '⚠️', '✅', '🎯'].some(e => line.startsWith(e)))
      return <div key={i} style={{ fontWeight: 700, fontSize: 14, marginTop: 12, marginBottom: 4, color: '#1a2f4e' }}>{line}</div>
    if (!line.trim()) return <div key={i} style={{ height: 4 }} />
    return <div key={i} style={{ fontSize: 13, color: '#374151', lineHeight: 1.7, paddingLeft: 4 }}>{line}</div>
  }

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1a2f4e', marginBottom: 12 }}>主管日誌</h1>

      {/* 篩選列 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20 }}>
        {(['all', 'direct', 'franchise'] as StoreFilter[]).map(f => (
          <button key={f} onClick={() => setStoreFilter(f)} style={btnStyle(storeFilter === f)}>
            {f === 'all' ? '全部' : f === 'direct' ? '直營' : '加盟'}
          </button>
        ))}
        <div style={{ width: 1, height: 20, background: '#e5e7eb' }} />
        {(['all', 'noon', 'evening'] as SessionFilter[]).map(s => (
          <button key={s} onClick={() => setSessionFilter(s)} style={btnStyle(sessionFilter === s)}>
            {s === 'all' ? '全部時段' : s === 'noon' ? '中午' : '晚上'}
          </button>
        ))}
        <div style={{ width: 1, height: 20, background: '#e5e7eb' }} />
        {(['thisweek', 'lastweek', 'thismonth', 'lastmonth', 'custom'] as RangeKey[]).map(r => (
          <button key={r} onClick={() => applyRange(r)} style={btnStyle(activeRange === r)}>
            {r === 'thisweek' ? '本週' : r === 'lastweek' ? '上週' : r === 'thismonth' ? '本月' : r === 'lastmonth' ? '上個月' : '自訂'}
          </button>
        ))}
        {activeRange === 'custom' && (
          <>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }} />
            <span style={{ color: '#9ca3af' }}>—</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }} />
          </>
        )}
        <button onClick={fetchData} disabled={loading} style={{ padding: '7px 20px', borderRadius: 8, border: 'none', background: loading ? '#9ca3af' : BRAND, color: '#fff', fontSize: 13, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer' }}>
          {loading ? '載入中...' : '載入報表'}
        </button>
      </div>

      {error && <div style={{ background: '#fee2e2', color: '#991b1b', padding: '10px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{error}</div>}

      {!hasData && !loading && (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>尚無資料</div>
          <div style={{ fontSize: 13 }}>選擇日期區間後點擊「載入報表」</div>
        </div>
      )}

      {hasData && (
        <>
          {/* AI 分析卡片 */}
          <div style={{ background: 'linear-gradient(135deg, #2d1f1f 0%, #4a2f2f 100%)', borderRadius: 12, padding: '20px 24px', marginBottom: 20, color: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>✦</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>AI 週報分析</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  {aiCachedAt
                    ? `已從快取載入・${dateFrom} ～ ${dateTo}・${new Date(aiCachedAt).toLocaleDateString('zh-TW')} ${new Date(aiCachedAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })} 分析`
                    : aiDone ? `剛完成分析・${dateFrom} ～ ${dateTo}` : aiLoading ? '正在分析本期各分店日誌...' : '載入後自動分析'}
                </div>
              </div>
              {aiDone && !aiLoading && (
                <button onClick={() => { setForceReanalyze(true); fetchData() }}
                  style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: 12, cursor: 'pointer' }}>
                  重新分析
                </button>
              )}
            </div>
            {aiLoading && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[100, 80, 90, 70].map((w, i) => (
                  <div key={i} style={{ height: 12, width: `${w}%`, background: 'rgba(255,255,255,0.15)', borderRadius: 4, animation: 'pulse 1.5s infinite' }} />
                ))}
              </div>
            )}
            {aiText && (
              <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 8, padding: '14px 16px' }}>
                {aiText.split('\n').map((line, i) => {
                  const isTitle = ['📊', '⚠️', '✅', '🎯'].some(e => line.startsWith(e))
                  if (!line.trim()) return <div key={i} style={{ height: 4 }} />
                  return (
                    <div key={i} style={{ fontSize: isTitle ? 14 : 13, fontWeight: isTitle ? 700 : 400, color: isTitle ? '#fff' : 'rgba(255,255,255,0.85)', lineHeight: 1.7, marginTop: isTitle ? 10 : 0 }}>
                      {line}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* 時間軸 */}
          <div style={{ fontSize: 15, fontWeight: 600, color: '#1a2f4e', marginBottom: 16 }}>各分店值班日誌</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
            {Object.entries(filtered).sort(([a], [b]) => a.localeCompare(b)).map(([, s]) => {
              const recs = [...s.records].sort((a, b) => a.date.localeCompare(b.date))
              return (
                <div key={s.displayName} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e6e1', overflow: 'hidden' }}>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0eee9', fontWeight: 700, color: '#1a2f4e', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: BRAND }} />
                    {s.displayName}
                    <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 400, marginLeft: 'auto' }}>{recs.length} 筆</span>
                  </div>
                  <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {recs.map((r, i) => {
                      const hasC = !isQuiet(r.complaint), hasF = !isQuiet(r.food), hasS = !isQuiet(r.share)
                      const hasContent = hasC || hasF || hasS
                      return (
                        <div key={i} style={{ display: 'flex', gap: 10 }}>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                            <div style={{ width: 10, height: 10, borderRadius: '50%', background: hasC ? '#ef4444' : hasF ? '#f59e0b' : hasContent ? '#3b82f6' : '#d1d5db', marginTop: 3 }} />
                            {i < recs.length - 1 && <div style={{ width: 1, flex: 1, background: '#e5e7eb', marginTop: 4 }} />}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
                              {r.date.replace(/-/g, '/')} · <span style={{ color: '#374151', fontWeight: 600 }}>{r.supervisor}</span>
                            </div>
                            {hasC && (
                              <div style={{ marginBottom: 4 }}>
                                <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 20, background: '#fee2e2', color: '#991b1b', marginRight: 6 }}>客訴</span>
                                <span style={{ fontSize: 12, color: '#374151' }}>{r.complaint}</span>
                              </div>
                            )}
                            {hasF && (
                              <div style={{ marginBottom: 4 }}>
                                <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 20, background: '#fef3c7', color: '#92400e', marginRight: 6 }}>食材</span>
                                <span style={{ fontSize: 12, color: '#374151' }}>{r.food}</span>
                              </div>
                            )}
                            {hasS && (
                              <div style={{ marginBottom: 4 }}>
                                <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 20, background: '#dbeafe', color: '#1e40af', marginRight: 6 }}>分享</span>
                                <span style={{ fontSize: 12, color: '#374151' }}>{r.share}</span>
                              </div>
                            )}
                            {!hasContent && <div style={{ fontSize: 12, color: '#d1d5db', fontStyle: 'italic' }}>無特殊事項</div>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
