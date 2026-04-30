'use client'
import { useState, useEffect } from 'react'
import AppLayout from '@/components/AppLayout'
import { getSettings, saveSettings, getCustomFields, DEFAULT_FIELDS } from '@/lib/utils'

export default function SettingsPage() {
  const [token, setToken] = useState('')
  const [path, setPath] = useState('')
  const [server, setServer] = useState('ap7')
  const [showToken, setShowToken] = useState(false)
  const [saved, setSaved] = useState('')
  const [fields, setFields] = useState({})

  useEffect(() => {
    const s = getSettings()
    setToken(s.token || '')
    setPath(s.path || '')
    setServer(s.server || 'ap7')
    setFields(getCustomFields())
  }, [])

  const save = () => {
    saveSettings({ token, path, server })
    setSaved('✓ 已儲存')
    setTimeout(() => setSaved(''), 2500)
  }

  const FIELD_KEYS = ['date','store','rev','guests','groups','noshow','avgPay','supervisor','complaint','share']
  const FIELD_LABELS = { date:'營業日期', store:'分店名稱', rev:'當日營業額', guests:'用餐人數', groups:'用餐組數', noshow:'No Show', avgPay:'客單價', supervisor:'值班人員', complaint:'客訴', share:'其他事件' }

  return (
    <AppLayout>
      <header className="topbar">
        <div className="topbar-left"><h1 className="page-title">設定</h1></div>
      </header>
      <div className="content-area">
        <div className="settings-card">
          <h2 className="settings-title">API 設定</h2>
          <p className="settings-desc">設定 Ragic 連線資訊，資料只儲存在你的瀏覽器中。</p>
          <div className="form-group">
            <label>Ragic API Token</label>
            <div style={{position:'relative'}}>
              <input type={showToken ? 'text' : 'password'} className="form-input mono" value={token} onChange={e => setToken(e.target.value)} placeholder="貼上 Base64 API Token..." />
              <button onClick={() => setShowToken(!showToken)} style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',fontSize:11,color:'#6b7280',cursor:'pointer'}}>{showToken ? '隱藏' : '顯示'}</button>
            </div>
          </div>
          <div className="form-group">
            <label>Ragic 表單路徑</label>
            <input type="text" className="form-input" value={path} onChange={e => setPath(e.target.value)} placeholder="yourcompany/formname/1" />
            <p className="field-hint">例：yohannam/ragicsales-order-management/11</p>
          </div>
          <div className="form-group">
            <label>Ragic API 伺服器</label>
            <select className="form-input" value={server} onChange={e => setServer(e.target.value)}>
              <option value="ap7">ap7.ragic.com（預設）</option>
              <option value="ap12">ap12.ragic.com</option>
              <option value="www">www.ragic.com</option>
            </select>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:12,marginTop:16}}>
            <button className="btn-primary" onClick={save}>儲存設定</button>
            {saved && <span style={{fontSize:12,color:'#1D9E75'}}>{saved}</span>}
          </div>
        </div>

        <div className="settings-card">
          <h2 className="settings-title">欄位對應</h2>
          <p className="settings-desc">設定 Ragic 表單欄位名稱（依照你的表單調整）</p>
          <div className="fields-grid">
            {FIELD_KEYS.map(k => (
              <div key={k} className="form-group">
                <label>{FIELD_LABELS[k]}</label>
                <input type="text" className="form-input" value={fields[k] || ''} placeholder={DEFAULT_FIELDS[k]}
                  onChange={e => setFields(f => ({...f, [k]: e.target.value}))} />
              </div>
            ))}
          </div>
          <div style={{marginTop:16}}>
            <button className="btn-primary" onClick={() => {
              localStorage.setItem('ragic_fields', JSON.stringify(fields))
              setSaved('✓ 已儲存')
              setTimeout(() => setSaved(''), 2500)
            }}>儲存欄位設定</button>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
