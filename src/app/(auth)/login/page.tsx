'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

type Mode = 'gate' | 'account'

function LoginForm() {
  const [mode, setMode] = useState<Mode>('gate')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get('next') || '/'

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const body = mode === 'gate' ? { password } : { email, password }
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || (mode === 'gate' ? '密碼錯誤' : '帳號或密碼錯誤'))
      setLoading(false)
      return
    }

    router.push(next)
    router.refresh()
  }

  const switchMode = (m: Mode) => {
    setMode(m)
    setError('')
    setPassword('')
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px',
    border: '1.5px solid #e5e7eb', borderRadius: 8,
    fontSize: 14, outline: 'none', boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 6,
  }
  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 600,
    background: active ? '#3c2929' : '#fff',
    color: active ? '#fff' : '#6b7280',
    border: '1.5px solid ' + (active ? '#3c2929' : '#e5e7eb'),
    cursor: 'pointer',
  })

  const canSubmit = mode === 'gate' ? !!password : !!(email && password)

  return (
    <>
      <div style={{ display: 'flex', marginBottom: 20, borderRadius: 8, overflow: 'hidden' }}>
        <button type="button" onClick={() => switchMode('gate')} style={{ ...tabStyle(mode === 'gate'), borderTopLeftRadius: 8, borderBottomLeftRadius: 8, borderRight: 'none' }}>
          通行密碼
        </button>
        <button type="button" onClick={() => switchMode('account')} style={{ ...tabStyle(mode === 'account'), borderTopRightRadius: 8, borderBottomRightRadius: 8 }}>
          帳號登入
        </button>
      </div>

      <form onSubmit={handleLogin}>
        {mode === 'account' && (
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              autoFocus
              style={inputStyle}
            />
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>{mode === 'gate' ? '通行密碼' : '密碼'}</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder={mode === 'gate' ? '請輸入通行密碼' : '••••••••'}
            required
            autoFocus={mode === 'gate'}
            style={inputStyle}
          />
        </div>

        {error && (
          <div style={{ fontSize: 13, color: '#dc2626', marginBottom: 12, textAlign: 'center' }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !canSubmit}
          style={{
            width: '100%', padding: 11,
            background: loading || !canSubmit ? '#9ca3af' : '#3c2929',
            color: '#fff', border: 'none', borderRadius: 8,
            fontSize: 14, fontWeight: 600, cursor: loading || !canSubmit ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? '驗證中...' : '進入'}
        </button>
      </form>
    </>
  )
}

export default function LoginPage() {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#3c2929',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        background: '#fff',
        borderRadius: 16,
        padding: '40px 36px',
        width: 360,
        boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="8" fill="#3c2929"/>
            <rect x="6" y="10" width="16" height="2.5" rx="1.25" fill="white"/>
            <rect x="6" y="15.5" width="10" height="2.5" rx="1.25" fill="white"/>
          </svg>
          <span style={{ fontSize: 18, fontWeight: 600, color: '#3c2929' }}>週報系統</span>
        </div>

        <div style={{ fontSize: 22, fontWeight: 600, color: '#1a1a1a', marginBottom: 6 }}>歡迎回來</div>
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 24 }}>選擇登入方式</div>

        <Suspense fallback={<div style={{ fontSize: 13, color: '#6b7280' }}>載入中...</div>}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  )
}
