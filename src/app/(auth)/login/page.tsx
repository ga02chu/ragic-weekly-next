'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function LoginForm() {
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

    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || '密碼錯誤，請再試一次')
      setLoading(false)
      return
    }

    router.push(next)
    router.refresh()
  }

  return (
    <form onSubmit={handleLogin}>
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
          通行密碼
        </label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="請輸入密碼"
          required
          autoFocus
          style={{
            width: '100%', padding: '10px 12px',
            border: '1.5px solid #e5e7eb', borderRadius: 8,
            fontSize: 14, outline: 'none', boxSizing: 'border-box',
          }}
        />
      </div>

      {error && (
        <div style={{ fontSize: 13, color: '#dc2626', marginBottom: 12, textAlign: 'center' }}>
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !password}
        style={{
          width: '100%', padding: 11,
          background: loading || !password ? '#9ca3af' : '#3c2929',
          color: '#fff', border: 'none', borderRadius: 8,
          fontSize: 14, fontWeight: 600, cursor: loading || !password ? 'not-allowed' : 'pointer',
        }}
      >
        {loading ? '驗證中...' : '進入'}
      </button>
    </form>
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
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 28 }}>請輸入通行密碼</div>

        <Suspense fallback={<div style={{ fontSize: 13, color: '#6b7280' }}>載入中...</div>}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  )
}
