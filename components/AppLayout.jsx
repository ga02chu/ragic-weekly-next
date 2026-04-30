'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

const NAV = [
  { href: '/dashboard', label: '總覽', icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><rect x="9" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><rect x="1" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><rect x="9" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/></svg> },
  { href: '/stores', label: '分店比較', icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 6l6-4 6 4v8H2V6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M6 14V9h4v5" stroke="currentColor" strokeWidth="1.5"/></svg> },
  { href: '/logs', label: '主管日誌', icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M5 6h6M5 9h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> },
  { href: '/yoy', label: '年度比較', icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1 12L5 7l3 3 3-4 3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> },
  { href: '/weekday', label: '平假日分析', icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M1 6h14M5 2v4M11 2v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> },
  { href: '/hr', label: '人事成本', icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="6" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.5"/><path d="M1 13c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M11 7l1.5 1.5L15 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> },
  { href: '/settings', label: '設定', icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> },
]

export default function AppLayout({ children }) {
  const pathname = usePathname()
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem('ragic_settings') || '{}')
      setConnected(!!(s.token || true)) // server env vars handle it
      fetch('/api/config').then(r => r.json()).then(d => {
        setConnected(d.hasToken && d.hasPath)
      }).catch(() => {
        setConnected(!!(s.token && s.path))
      })
    } catch {}
  }, [])

  return (
    <div style={{ display: 'flex' }}>
      <aside className="sidebar">
        <div className="sidebar-logo">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="8" fill="rgba(255,255,255,0.2)"/>
            <rect x="6" y="10" width="16" height="2.5" rx="1.25" fill="white"/>
            <rect x="6" y="15.5" width="10" height="2.5" rx="1.25" fill="white"/>
          </svg>
          <span className="logo-text">週報系統</span>
        </div>
        <nav className="sidebar-nav">
          {NAV.map(n => (
            <Link key={n.href} href={n.href} className={`nav-item ${pathname === n.href ? 'active' : ''}`}>
              {n.icon}{n.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="conn-status">
            <span className={`dot ${connected ? 'dot-green' : 'dot-gray'}`}></span>
            <span>{connected ? '系統已連線' : '尚未連線'}</span>
          </div>
        </div>
      </aside>
      <div className="main-wrap">{children}</div>
    </div>
  )
}
