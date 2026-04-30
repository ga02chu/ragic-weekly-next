'use client'
import AppLayout from '@/components/AppLayout'
import Topbar from '@/components/Topbar'
import { ReportProvider, useReport } from '@/components/ReportContext'
import { processRecords, fmt, COLORS, BRAND } from '@/lib/utils'

function StoresContent() {
  const { records, prevRecords, storeFilter, sessionFilter, setSessionFilter } = useReport()
  const { byStore } = processRecords(records, sessionFilter, storeFilter)
  const { byStore: prevByStore } = processRecords(prevRecords, sessionFilter, storeFilter)
  const stores = Object.keys(byStore).sort((a, b) => byStore[b].rev - byStore[a].rev)
  const maxRev = stores.length ? byStore[stores[0]].rev : 1

  if (!records.length) return <div className="empty-state"><p className="empty-title">請先載入報表</p></div>

  return (
    <>
      <div className="session-bar">
        {['all','noon','evening'].map(s => (
          <button key={s} className={`session-btn ${sessionFilter === s ? 'active' : ''}`} onClick={() => setSessionFilter(s)}>
            {s === 'all' ? '全部時段' : s === 'noon' ? '中午' : '晚上'}
          </button>
        ))}
      </div>
      <div className="table-card" style={{marginBottom:20}}>
        <div className="table-header">分店營業額排行</div>
        <div style={{padding:'20px 24px'}}>
          <div className="bar-chart">
            {stores.map((s, i) => {
              const d = byStore[s]
              const pct = maxRev > 0 ? (d.rev / maxRev * 100) : 0
              return (
                <div key={s} className="bar-row">
                  <div className="bar-meta">
                    <span style={{fontWeight:500}}>{i+1}. {d.displayName}</span>
                    <span style={{color:'#6b7280'}}>${fmt(d.rev)}</span>
                  </div>
                  <div className="bar-track"><div className="bar-fill" style={{width:`${pct.toFixed(1)}%`,background:COLORS[i%COLORS.length]}} /></div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <div className="table-card">
        <div className="table-header">詳細數據比較</div>
        <table>
          <thead><tr>
            <th>分店</th><th>類型</th><th>總營業額</th><th>上期</th>
            <th>用餐人數</th><th>用餐組數</th><th>No Show</th><th>No Show率</th><th>客單價</th><th>狀態</th>
          </tr></thead>
          <tbody>
            {stores.map(s => {
              const d = byStore[s], p = prevByStore[s]
              const avg = d.avgPays.length ? d.avgPays.reduce((a,b)=>a+b,0)/d.avgPays.length : 0
              const nr = d.groups > 0 ? (d.noshow/d.groups*100) : 0
              const revChg = p?.rev > 0 ? ((d.rev-p.rev)/p.rev*100) : null
              const badge = revChg === null ? <span className="badge" style={{background:'#F3F4F6',color:'#6b7280'}}>-</span>
                : revChg >= 5 ? <span className="badge badge-good">成長</span>
                : revChg <= -5 ? <span className="badge badge-danger">衰退</span>
                : <span className="badge badge-warn">持平</span>
              return (
                <tr key={s}>
                  <td className="cell-bold">{d.displayName}</td>
                  <td><span className={`badge ${d.type==='franchise'?'badge-franchise':'badge-direct'}`}>{d.type==='franchise'?'加盟':'直營'}</span></td>
                  <td>${fmt(d.rev)}</td>
                  <td style={{color:'#9ca3af',fontSize:12}}>{p?'$'+fmt(p.rev):'-'}</td>
                  <td>{fmt(d.guests)}</td><td>{fmt(d.groups)}</td>
                  <td>{fmt(d.noshow)}</td><td>{nr.toFixed(1)}%</td>
                  <td>${fmt(avg)}</td><td>{badge}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

export default function StoresPage() {
  return (
    <ReportProvider>
      <AppLayout>
        <Topbar title="分店比較" />
        <div className="content-area"><StoresContent /></div>
      </AppLayout>
    </ReportProvider>
  )
}
