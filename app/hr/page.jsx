'use client'
import AppLayout from '@/components/AppLayout'
import dynamic from 'next/dynamic'

const WeeklyReport = dynamic(() => import('@/components/WeeklyReport'), { ssr: false })

export default function HRPage() {
  return (
    <AppLayout>
      <header className="topbar">
        <div className="topbar-left">
          <h1 className="page-title">人事成本</h1>
        </div>
      </header>
      <div className="content-area">
        <WeeklyReport />
      </div>
    </AppLayout>
  )
}
