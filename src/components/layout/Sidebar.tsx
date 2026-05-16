'use client'

import { usePathname, useRouter } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/', label: '總覽', icon: '▦' },
  { href: '/stores', label: '分店比較', icon: '🏪' },
  { href: '/logs', label: '主管日誌', icon: '📋' },
  { href: '/yoy', label: '年度比較', icon: '📈' },
  { href: '/weekday', label: '平假日分析', icon: '📅' },
  { href: '/hr', label: '人事成本', icon: '👥' },
  { href: '/food-cost', label: '食材成本', icon: '🥩' },
  { href: '/settings', label: '設定', icon: '⚙️' },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()

  const handleLogout = async () => {
    await fetch('/api/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  return (
    <aside style={{
      width: 200,
      background: '#3c2929',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      height: '100vh',
    }}>
      {/* Logo */}
      <div style={{
        padding: '20px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        borderBottom: '1px solid rgba(255,255,255,0.1)',
      }}>
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <rect width="28" height="28" rx="8" fill="rgba(255,255,255,0.2)"/>
          <rect x="6" y="10" width="16" height="2.5" rx="1.25" fill="white"/>
          <rect x="6" y="15.5" width="10" height="2.5" rx="1.25" fill="white"/>
        </svg>
        <span style={{ color: '#fff', fontWeight: 600, fontSize: 15 }}>週報系統</span>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '12px 8px', overflowY: 'auto' }}>
        {NAV_ITEMS.map(item => {
          const isActive = item.href === '/'
            ? pathname === '/'
            : pathname.startsWith(item.href)
          return (
            <button
              key={item.href}
              onClick={() => router.push(item.href)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 12px',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: isActive ? 600 : 400,
                background: isActive ? 'rgba(255,255,255,0.15)' : 'transparent',
                color: isActive ? '#fff' : 'rgba(255,255,255,0.7)',
                marginBottom: 2,
                textAlign: 'left',
              }}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>

      {/* Footer */}
      <div style={{
        padding: '12px 8px',
        borderTop: '1px solid rgba(255,255,255,0.1)',
      }}>
        <button
          onClick={handleLogout}
          style={{
            width: '100%',
            padding: '8px 12px',
            background: 'rgba(255,255,255,0.1)',
            color: 'rgba(255,255,255,0.7)',
            border: 'none',
            borderRadius: 8,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          登出
        </button>
      </div>
    </aside>
  )
}
