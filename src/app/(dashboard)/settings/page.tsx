'use client'

import { useState, useEffect } from 'react'

const BRAND = '#3c2929'

const FIELD_LABELS: [string, string, string][] = [
  ['date', '日期欄位', '營業日期'],
  ['store', '分店欄位', '分店簡稱'],
  ['session', '時段欄位', '營業時間'],
  ['revenue', '營業額欄位', '當日營業額'],
  ['guests', '用餐人數欄位', '用餐人數'],
  ['groups', '用餐組數欄位', '用餐組數'],
  ['noshow', 'No Show 欄位', 'No Show組數'],
  ['avgPay', '客單價欄位', '客單價'],
  ['supervisor', '值班人員欄位', '值班人員'],
  ['complaint', '客訴欄位', '當日客訴與事件處理'],
  ['food', '食材狀況欄位', '當日食材狀況反應'],
  ['share', '事件分享欄位', '當日其他事件分享'],
]

const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

export default function SettingsPage() {
  const [token, setToken] = useState('')
  const [path, setPath] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [extraPaths, setExtraPaths] = useState<string[]>([])
  const [fields, setFields] = useState<Record<string, string>>({})
  const [stdHours, setStdHours] = useState<Record<string, number>>({})
  const [stdYear, setStdYear] = useState(new Date().getFullYear())
  const [saved, setSaved] = useState(false)
  const [connStatus, setConnStatus] = useState<'ok' | 'none' | 'checking'>('none')

  useEffect(() => {
    const s = JSON.parse(localStorage.getItem('ragic_settings') || '{}')
    const f = JSON.parse(localStorage.getItem('ragic_fields') || '{}')
    const ep: string[] = JSON.parse(localStorage.getItem('ragic_extra_paths') || '[]')
    const sh = JSON.parse(localStorage.getItem('ragic_std_hours') || '{}')
    setToken(s.token || '')
    setPath(s.path || '')
    setExtraPaths(ep)
    setFields(f)
    setStdHours(sh)
  }, [])

  const testConn = async () => {
    setConnStatus('checking')
    const params = new URLSearchParams({ limit: '1' })
    if (token) params.set('token', token)
    if (path) params.set('path', path)
    try {
      const r = await fetch(`/api/ragic?${params}`)
      const d = await r.json()
      setConnStatus(d.error ? 'none' : 'ok')
    } catch { setConnStatus('none') }
  }

  const save = () => {
    localStorage.setItem('ragic_settings', JSON.stringify({ token, path }))
    localStorage.setItem('ragic_extra_paths', JSON.stringify(extraPaths.filter(p => p.trim())))
    const cleaned = Object.fromEntries(Object.entries(fields).filter(([, v]) => v.trim()))
    localStorage.setItem('ragic_fields', JSON.stringify(cleaned))
    localStorage.setItem('ragic_std_hours', JSON.stringify(stdHours))
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const setStdH = (month: number, val: number) => {
    const key = `${stdYear}-${String(month).padStart(2, '0')}`
    setStdHours(prev => ({ ...prev, [key]: val }))
  }

  const getStdH = (month: number): number => {
    const key = `${stdYear}-${String(month).padStart(2, '0')}`
    return typeof stdHours[key] === 'number' ? stdHours[key] : 173.33
  }

  const statusDot = connStatus === 'ok' ? '#22c55e' : connStatus === 'checking' ? '#f59e0b' : '#d1d5db'
  const statusText = connStatus === 'ok' ? '連線成功' : connStatus === 'checking' ? '測試中...' : '尚未測試'

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1a2f4e', marginBottom: 24 }}>設定</h1>

      {/* 連線狀態 */}
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e8e6e1', padding: '12px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: statusDot, flexShrink: 0 }} />
        <span style={{ fontSize: 13, color: '#374151', flex: 1 }}>{statusText}</span>
        <button onClick={testConn} style={{ padding: '5px 14px', fontSize: 12, borderRadius: 7, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer' }}>
          測試連線
        </button>
      </div>

      {/* Ragic API 主要設定 */}
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e8e6e1', marginBottom: 16 }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0eee9', fontWeight: 600, color: '#1a2f4e', fontSize: 14 }}>
          Ragic API 設定
        </div>
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 5 }}>API Token（共用）</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type={showToken ? 'text' : 'password'} value={token} onChange={e => setToken(e.target.value)}
                placeholder="輸入 Ragic API Token"
                style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13 }} />
              <button onClick={() => setShowToken(!showToken)}
                style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', fontSize: 12, cursor: 'pointer' }}>
                {showToken ? '隱藏' : '顯示'}
              </button>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 5 }}>主要 API Path</div>
            <input type="text" value={path} onChange={e => setPath(e.target.value)}
              placeholder="例如：yohannam/ragicsales-order-management/11"
              style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, boxSizing: 'border-box' }} />
          </div>
          <div style={{ fontSize: 11, color: '#9ca3af', lineHeight: 1.5 }}>
            Token 儲存在瀏覽器 localStorage，不會傳送至伺服器。
          </div>
        </div>
      </div>

      {/* 額外 Ragic 資料來源 */}
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e8e6e1', marginBottom: 16 }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0eee9', fontWeight: 600, color: '#1a2f4e', fontSize: 14 }}>
          額外 Ragic 資料來源
        </div>
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {extraPaths.map((ep, i) => (
            <div key={i} style={{ display: 'flex', gap: 8 }}>
              <input type="text" value={ep} onChange={e => setExtraPaths(prev => prev.map((p, j) => j === i ? e.target.value : p))}
                placeholder={`額外 Path ${i + 1}`}
                style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }} />
              <button onClick={() => setExtraPaths(prev => prev.filter((_, j) => j !== i))}
                style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #fca5a5', background: '#fff', color: '#dc2626', fontSize: 12, cursor: 'pointer' }}>
                移除
              </button>
            </div>
          ))}
          <button onClick={() => setExtraPaths(prev => [...prev, ''])}
            style={{ alignSelf: 'flex-start', padding: '6px 14px', borderRadius: 8, border: `1px solid ${BRAND}`, background: '#fff', color: BRAND, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            + 新增資料來源
          </button>
          <div style={{ fontSize: 11, color: '#9ca3af' }}>
            所有來源共用同一組 API Token，載入報表時會合併所有來源的資料。
          </div>
        </div>
      </div>

      {/* 欄位對應 */}
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e8e6e1', marginBottom: 16 }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0eee9', fontWeight: 600, color: '#1a2f4e', fontSize: 14 }}>
          欄位對應（自訂 Ragic 欄位名稱）
        </div>
        <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {FIELD_LABELS.map(([key, label, placeholder]) => (
            <div key={key}>
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>{label}</div>
              <input type="text" value={fields[key] || ''} onChange={e => setFields(prev => ({ ...prev, [key]: e.target.value }))}
                placeholder={placeholder}
                style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #e5e7eb', fontSize: 12, boxSizing: 'border-box' }} />
            </div>
          ))}
        </div>
        <div style={{ padding: '0 20px 14px', fontSize: 11, color: '#9ca3af' }}>
          留空使用預設欄位名稱（括號內為預設值）。
        </div>
      </div>

      {/* 每月標準工時 */}
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e8e6e1', marginBottom: 20 }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0eee9', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontWeight: 600, color: '#1a2f4e', fontSize: 14 }}>每月標準工時</span>
          <select value={stdYear} onChange={e => setStdYear(+e.target.value)}
            style={{ padding: '4px 8px', borderRadius: 7, border: '1px solid #e5e7eb', fontSize: 12 }}>
            {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y} 年</option>)}
          </select>
        </div>
        <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {MONTHS.map((label, i) => (
            <div key={i}>
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>{label}</div>
              <input type="number" value={getStdH(i + 1)} onChange={e => setStdH(i + 1, +e.target.value)}
                step={0.01} min={0}
                style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #e5e7eb', fontSize: 12, boxSizing: 'border-box' }} />
            </div>
          ))}
        </div>
        <div style={{ padding: '0 20px 14px', fontSize: 11, color: '#9ca3af' }}>
          人事成本頁面在選擇年月後，會自動帶入此處設定的標準工時。
        </div>
      </div>

      <button onClick={save}
        style={{ padding: '10px 28px', borderRadius: 8, border: 'none', background: BRAND, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
        {saved ? '✓ 已儲存' : '儲存設定'}
      </button>
    </div>
  )
}
