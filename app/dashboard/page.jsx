'use client'
import { useEffect, useRef } from 'react'
import AppLayout from '@/components/AppLayout'
import Topbar from '@/components/Topbar'
import { ReportProvider, useReport } from '@/components/ReportContext'
import { processRecords, fmt, diffBadge, COLORS, BRAND, BRAND_LIGHT, STORE_NAME_MAP } from '@/lib/utils'

function DashboardContent() {
  const { records, prevRecords, storeFilter, sessionFilter, setSessionFilter, dateFrom } = useReport()
  const trendRef = useRef(null)
  const donutRef = useRef(null)
  const trendChart = useRef(null)
  const donutChart = useRef(null)

  const { byStore, byDate } = processRecords(records, sessionFilter, storeFilter)
  const { byStore: prevByStore } = processRecords(prevRecords, sessionFilter, storeFilter)
  const stores = Object.keys(byStore).sort()

  const totalRev = stores.reduce((s, k) => s + byStore[k].rev, 0)
  const totalGuests = stores.reduce((s, k) => s + byStore[k].guests, 0)
  const totalGroups = stores.reduce((s, k) => s + byStore[k].groups, 0)
  const totalNoshow = stores.reduce((s, k) => s + byStore[k].noshow, 0)
  const prevStores = Object.keys(prevByStore)
  const prevRev = prevStores.reduce((s, k) => s + prevByStore[k].rev, 0)
  const prevGuests = prevStores.reduce((s, k) => s + prevByStore[k].guests, 0)
  const prevNoshow = prevStores.reduce((s, k) => s + prevByStore[k].noshow, 0)
  const dates = Object.keys(byDate).sort()
  const avgRevPerDay = dates.length > 0 ? totalRev / dates.length : 0
  const noshowPct = totalGroups > 0 ? ((totalNoshow / totalGroups) * 100).toFixed(1) : '0.0'

  const DiffBadge = ({ curr, prev }) => {
    const d = diffBadge(curr, prev)
    if (!d) return null
    return <span className={d.up ? 'diff-up' : 'diff-down'}>{d.up ? '▲' : '▼'} {d.pct}%</span>
  }

  useEffect(() => {
    if (typeof window === 'undefined' || !records.length) return
    import('chart.js').then(({ Chart, CategoryScale, LinearScale, PointElement, LineElement, ArcElement, Filler, Tooltip, Legend }) => {
      Chart.register(CategoryScale, LinearScale, PointElement, LineElement, ArcElement, Filler, Tooltip, Legend)
      if (trendChart.current) trendChart.current.destroy()
      if (donutChart.current) donutChart.current.destroy()
      if (trendRef.current) {
        trendChart.current = new Chart(trendRef.current, {
          type: 'line',
          data: {
            labels: dates.map(d => d.slice(5)),
            datasets: [{ label: '當日總營業額', data: dates.map(d => byDate[d]), borderColor: BRAND, backgroundColor: BRAND_LIGHT, borderWidth: 2, tension: 0.35, fill: true, pointBackgroundColor: BRAND, pointRadius: 4 }]
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: v => '$' + fmt(v), font: { size: 11 } } }, x: { grid: { display: false }, ticks: { autoSkip: true, maxRotation: 0 } } } }
        })
      }
      if (donutRef.current && stores.length) {
        donutChart.current = new Chart(donutRef.current, {
          type: 'doughnut',
          data: { labels: stores.map(s => byStore[s].displayName), datasets: [{ data: stores.map(s => byStore[s].rev), backgroundColor: COLORS.slice(0, stores.length), borderWidth: 0 }] },
          options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'right', labels: { font: { size: 11 }, boxWidth: 11 } } } }
        })
      }
    })
    return () => {
      trendChart.current?.destroy()
      donutChart.current?.destroy()
    }
  }, [records, storeFilter, sessionFilter])

  // Achievement from Google Sheets
  const [targets, setTargets] = React.useState({})
  useEffect(() => {
    if (!dateFrom) return
    const month = parseInt(dateFrom.slice(5, 7))
    if (!month) return
    fetch(`/api/sheets?month=${month}`).then(r => r.json()).then(d => {
      if (d.targets) setTargets(d.targets)
    }).catch(() => {})
  }, [dateFrom])

  if (!records.length) return (
    <div className="empty-state">
      <p className="empty-title">尚無資料</p>
      <p className="empty-sub">選擇日期區間後點擊「載入報表」</p>
    </div>
  )

  return (
    <>
      {/* Session filter */}
      <div className="session-bar">
        {['all','noon','evening'].map(s => (
          <button key={s} className={`session-btn ${sessionFilter === s ? 'active' : ''}`}
            onClick={() => setSessionFilter(s)}>
            {s === 'all' ? '全部時段' : s === 'noon' ? '中午' : '晚上'}
          </button>
        ))}
      </div>

      {/* KPI Cards */}
      <div className="metrics-grid">
        <div className="metric-card highlight">
          <div className="m-label">期間總營業額</div>
          <div className="m-value">${fmt(totalRev)} <DiffBadge curr={totalRev} prev={prevRev} /></div>
          <div className="m-sub">日均 ${fmt(avgRevPerDay)}</div>
        </div>
        <div className="metric-card">
          <div className="m-label">總用餐人數</div>
          <div className="m-value">{fmt(totalGuests)} <DiffBadge curr={totalGuests} prev={prevGuests} /></div>
          <div className="m-sub">共 {fmt(totalGroups)} 組</div>
        </div>
        <div className="metric-card">
          <div className="m-label">No Show 組數</div>
          <div className="m-value">{fmt(totalNoshow)} <DiffBadge curr={totalNoshow} prev={prevNoshow} /></div>
          <div className="m-sub">占訂單 {noshowPct}%</div>
        </div>
        <div className="metric-card">
          <div className="m-label">查詢分店數</div>
          <div className="m-value">{stores.length}</div>
          <div className="m-sub">共 {records.length} 筆資料</div>
        </div>
      </div>

      {/* Achievement Cards */}
      {Object.keys(targets).length > 0 && (
        <AchievementSection targets={targets} byStore={byStore} dateFrom={dateFrom} />
      )}

      {/* Charts */}
      <div className="charts-row">
        <div className="chart-card">
          <div className="chart-title">每日營業額趨勢</div>
          <div style={{ height: 220, position: 'relative' }}><canvas ref={trendRef} /></div>
        </div>
        <div className="chart-card">
          <div className="chart-title">各分店佔比</div>
          <div style={{ height: 220, position: 'relative' }}><canvas ref={donutRef} /></div>
        </div>
      </div>

      {/* Overview Table */}
      <div className="table-card">
        <div className="table-header">各分店概覽</div>
        <table>
          <thead><tr>
            <th>分店</th><th>類型</th><th>營業額</th><th>用餐人數</th>
            <th>用餐組數</th><th>No Show</th><th>客單價</th><th>環比狀態</th>
          </tr></thead>
          <tbody>
            {stores.map(s => {
              const d = byStore[s]
              const p = prevByStore[s]
              const avg = d.avgPays.length ? d.avgPays.reduce((a, b) => a + b, 0) / d.avgPays.length : 0
              const revChg = p?.rev > 0 ? ((d.rev - p.rev) / p.rev * 100) : null
              const statusBadge = revChg === null ? <span className="badge" style={{background:'#F3F4F6',color:'#6b7280'}}>-</span>
                : revChg >= 5 ? <span className="badge badge-good">↑ 成長</span>
                : revChg <= -5 ? <span className="badge badge-danger">↓ 衰退</span>
                : <span className="badge badge-warn">→ 持平</span>
              return (
                <tr key={s}>
                  <td className="cell-bold">{d.displayName}</td>
                  <td><span className={`badge ${d.type === 'franchise' ? 'badge-franchise' : 'badge-direct'}`}>{d.type === 'franchise' ? '加盟' : '直營'}</span></td>
                  <td>${fmt(d.rev)} {p && <span className={diffBadge(d.rev,p.rev)?.up ? 'diff-up' : 'diff-down'} style={{fontSize:11}}>{diffBadge(d.rev,p.rev)?.up?'▲':'▼'}{diffBadge(d.rev,p.rev)?.pct}%</span>}</td>
                  <td>{fmt(d.guests)}</td><td>{fmt(d.groups)}</td>
                  <td>{fmt(d.noshow)} 組</td><td>${fmt(avg)}</td>
                  <td>{statusBadge}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

function AchievementSection({ targets, byStore, dateFrom }) {
  const today = new Date()
  const month = parseInt((dateFrom || '').slice(5, 7))
  const totalDays = new Date(today.getFullYear(), month, 0).getDate()
  const isCurrentMonth = today.getFullYear() === new Date(dateFrom).getFullYear() && today.getMonth() === new Date(dateFrom).getMonth()
  const effectiveElapsed = isCurrentMonth ? today.getDate() : totalDays

  return (
    <div className="achievement-grid" style={{marginBottom:20}}>
      {Object.entries(targets).map(([sheetName, target]) => {
        const storeEntry = Object.entries(byStore).find(([k, v]) =>
          k === (STORE_NAME_MAP[sheetName] || sheetName) ||
          v.displayName.includes(sheetName) || k.includes(sheetName)
        )
        const actual = storeEntry ? storeEntry[1].rev : 0
        const pct = target > 0 ? (actual / target * 100) : 0
        const projected = effectiveElapsed > 0 ? Math.round(actual / effectiveElapsed * totalDays) : 0
        const projPct = target > 0 ? (projected / target * 100) : 0
        const barColor = pct >= 100 ? '#1D9E75' : pct >= 80 ? '#EF9F27' : BRAND
        const pctColor = pct >= 100 ? '#0F6E56' : pct >= 80 ? '#BA7517' : '#A32D2D'
        return (
          <div key={sheetName} className="ach-card">
            <div className="ach-store">{sheetName}</div>
            <div className="ach-row"><span className="ach-label">實際營業額</span><span className="ach-val">${fmt(actual)}</span></div>
            <div className="ach-row"><span className="ach-label">月目標</span><span className="ach-val" style={{color:'#9ca3af'}}>${fmt(target)}</span></div>
            <div className="ach-row"><span className="ach-label">預估月底</span><span className="ach-val" style={{color:projPct>=100?'#0F6E56':'#BA7517'}}>${fmt(projected)}</span></div>
            <div className="ach-bar-wrap">
              <div className="ach-bar-track"><div className="ach-bar-fill" style={{width:`${Math.min(pct,100).toFixed(1)}%`,background:barColor}} /></div>
              <span className="ach-pct" style={{color:pctColor}}>{pct.toFixed(1)}%</span>
            </div>
            <div className="ach-sub">{actual < target ? `▼ 差距 $${fmt(target-actual)}` : `▲ 超標 $${fmt(actual-target)}`}・預估達成 {projPct.toFixed(1)}%</div>
          </div>
        )
      })}
    </div>
  )
}

import React from 'react'

export default function DashboardPage() {
  return (
    <ReportProvider>
      <AppLayout>
        <Topbar title="總覽" />
        <div className="content-area">
          <DashboardContent />
        </div>
      </AppLayout>
    </ReportProvider>
  )
}
