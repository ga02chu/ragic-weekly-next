'use client'
import { useEffect, useState } from 'react'
import AppLayout from '@/components/AppLayout'

export default function HRPage() {
  const [Component, setComponent] = useState(null)

  useEffect(() => {
    import('@/components/WeeklyReport').then(mod => {
      setComponent(() => mod.default)
    })
  }, [])

  return (
    <AppLayout>
      <header className="topbar">
        <div className="topbar-left">
          <h1 className="page-title">人事成本</h1>
        </div>
      </header>
      <div className="content-area">
        {Component ? <Component /> : <div className="empty-state"><p className="empty-title">載入中...</p></div>}
      </div>
    </AppLayout>
  )
}
