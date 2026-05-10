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

  // 一次貼上 12 個月：支援逗號、tab、換行、空白分隔
  const [pasteText, setPasteText] = useState('')
  const applyPaste = () => {
    const nums = pasteText.split(/[\s,，\t\n]+/).map(s => s.trim()).filter(Boolean).map(Number).filter(n => !isNaN(n))
    if (nums.length < 12) {
      alert(`只解析到 ${nums.length} 個數字，需要 12 個（每月一個）`)
      return
    }
    const next = { ...stdHours }
    for (let i = 0; i < 12; i++) {
      next[`${stdYear}-${String(i + 1).padStart(2, '0')}`] = nums[i]
    }
    setStdHours(next)
    setPasteText('')
  }
  const clearYear = () => {
    if (!confirm(`確定要清空 ${stdYear} 年所有月份的標準工時嗎？`)) return
    const next = { ...stdHours }
    for (let i = 1; i <= 12; i++) delete next[`${stdYear}-${String(i).padStart(2, '0')}`]
    setStdHours(next)
  }
  const copyFromPrevYear = () => {
    const next = { ...stdHours }
    let copied = 0
    for (let i = 1; i <= 12; i++) {
      const prev = stdHours[`${stdYear - 1}-${String(i).padStart(2, '0')}`]
      if (typeof prev === 'number') {
        next[`${stdYear}-${String(i).padStart(2, '0')}`] = prev
        copied++
      }
    }
    if (copied === 0) {
      alert(`${stdYear - 1} 年沒有任何資料可以複製`)
      return
    }
    setStdHours(next)
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
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0eee9', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, color: '#1a2f4e', fontSize: 14 }}>每月標準工時</span>
          <select value={stdYear} onChange={e => setStdYear(+e.target.value)}
            style={{ padding: '4px 8px', borderRadius: 7, border: '1px solid #e5e7eb', fontSize: 12 }}>
            {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y} 年</option>)}
          </select>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button onClick={copyFromPrevYear} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', fontSize: 11, cursor: 'pointer', color: '#374151' }}>
              從 {stdYear - 1} 年複製
            </button>
            <button onClick={clearYear} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #fca5a5', background: '#fff', fontSize: 11, cursor: 'pointer', color: '#dc2626' }}>
              清空本年
            </button>
          </div>
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
        <div style={{ padding: '0 20px 14px', borderTop: '1px solid #f5f3ee', marginTop: 4 }}>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 12, marginBottom: 6, fontWeight: 600 }}>快速貼上 12 個月（從 Excel/勞動部公告複製）</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="text" value={pasteText} onChange={e => setPasteText(e.target.value)}
              placeholder="例：176 160 168 160 168 168 184 168 176 176 168 168"
              style={{ flex: 1, padding: '7px 10px', borderRadius: 7, border: '1px solid #e5e7eb', fontSize: 12 }} />
            <button onClick={applyPaste} disabled={!pasteText.trim()}
              style={{ padding: '7px 14px', borderRadius: 7, border: 'none', background: pasteText.trim() ? BRAND : '#d1d5db', color: '#fff', fontSize: 12, fontWeight: 600, cursor: pasteText.trim() ? 'pointer' : 'not-allowed' }}>
              套用
            </button>
          </div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>
            數字之間用空白、逗號、tab 或換行分隔皆可。套用後別忘了按下方「儲存設定」。
          </div>
        </div>
      </div>

      <button onClick={save}
        style={{ padding: '10px 28px', borderRadius: 8, border: 'none', background: BRAND, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
        {saved ? '✓ 已儲存' : '儲存設定'}
      </button>
    </div>
  )
}
