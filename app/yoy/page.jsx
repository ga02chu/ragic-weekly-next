'use client'
import { useState, useEffect, useRef } from 'react'
import AppLayout from '@/components/AppLayout'
import { processRecords, fmt, diffBadge, COLORS, BRAND, getSettings, fetchRange } from '@/lib/utils'

export default function YoyPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [storeFilter, setStoreFilter] = useState('all')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)
  const barRef = useRef(null), avgRef = useRef(null)
  const barChart = useRef(null), avgChart = useRef(null)

  const years = Array.from({length:4}, (_,i) => now.getFullYear() - i)

  const load = async () => {
    const s = getSettings()
    setLoading(true)
    const pad = n => String(n).padStart(2,'0')
    const lastDay = new Date(year, month, 0).getDate()
    const prevLastDay = new Date(year-1, month, 0).getDate()
    try {
      const [curr, prev] = await Promise.all([
        fetchRange(s.token||'', s.path||'', `${year}-${pad(month)}-01`, `${year}-${pad(month)}-${pad(lastDay)}`),
        fetchRange(s.token||'', s.path||'', `${year-1}-${pad(month)}-01`, `${year-1}-${pad(month)}-${pad(prevLastDay)}`),
      ])
      setData({ curr, prev })
    } catch(e) { alert('載入失敗：' + e.message) }
    finally { setLoading(false) }
  }

  const filterStore = (byStore) => {
    if (storeFilter === 'all') return byStore
    return Object.fromEntries(Object.entries(byStore).filter(([,v]) => v.type === (storeFilter === 'direct' ? 'direct' : 'franchise')))
  }

  useEffect(() => {
    if (!data) return
    const { byStore: curr } = processRecords(data.curr)
    const { byStore: prev } = processRecords(data.prev)
    const fc = filterStore(curr), fp = filterStore(prev)
    const stores = Array.from(new Set([...Object.keys(fc), ...Object.keys(fp)])).sort()
    const labels = stores.map(s => (fc[s]||fp[s]).displayName)

    import('chart.js').then(({ Chart, CategoryScale, LinearScale, BarElement, Tooltip, Legend }) => {
      Chart.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)
      barChart.current?.destroy()
      avgChart.current?.destroy()
      const opts = (cb) => ({ indexAxis:'y', responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'top', labels:{ boxWidth:12, font:{size:11} } } }, scales:{ x:{ ticks:{ callback:cb, font:{size:10} } }, y:{ ticks:{ font:{size:11} } } } })
      if (barRef.current) barChart.current = new Chart(barRef.current, { type:'bar', data:{ labels, datasets:[
        { label:`${year}年`, data:stores.map(s=>fc[s]?.rev||0), backgroundColor:BRAND, borderRadius:4 },
        { label:`${year-1}年`, data:stores.map(s=>fp[s]?.rev||0), backgroundColor:'#d4b8b8', borderRadius:4 },
      ]}, options:opts(v=>'$'+fmt(v)) })
      if (avgRef.current) avgChart.current = new Chart(avgRef.current, { type:'bar', data:{ labels, datasets:[
        { label:`${year}年客單價`, data:stores.map(s=>{ const ap=fc[s]?.avgPays||[]; return ap.length?ap.reduce((a,b)=>a+b,0)/ap.length:0 }), backgroundColor:BRAND, borderRadius:4 },
        { label:`${year-1}年客單價`, data:stores.map(s=>{ const ap=fp[s]?.avgPays||[]; return ap.length?ap.reduce((a,b)=>a+b,0)/ap.length:0 }), backgroundColor:'#d4b8b8', borderRadius:4 },
      ]}, options:opts(v=>'$'+fmt(v)) })
    })
  }, [data, storeFilter])

  const renderTable = () => {
    if (!data) return null
    const { byStore: curr } = processRecords(data.curr)
    const { byStore: prev } = processRecords(data.prev)
    const fc = filterStore(curr), fp = filterStore(prev)
    const stores = Array.from(new Set([...Object.keys(fc), ...Object.keys(fp)])).sort()
    const cTotRev = Object.values(fc).reduce((s,v)=>s+v.rev,0)
    const pTotRev = Object.values(fp).reduce((s,v)=>s+v.rev,0)
    const cTotG = Object.values(fc).reduce((s,v)=>s+v.guests,0)
    const pTotG = Object.values(fp).reduce((s,v)=>s+v.guests,0)
    const cAllAp = Object.values(fc).flatMap(v=>v.avgPays)
    const pAllAp = Object.values(fp).flatMap(v=>v.avgPays)
    const cAvg = cAllAp.length ? cAllAp.reduce((a,b)=>a+b,0)/cAllAp.length : 0
    const pAvg = pAllAp.length ? pAllAp.reduce((a,b)=>a+b,0)/pAllAp.length : 0
    const DB = ({curr,prev}) => { const d=diffBadge(curr,prev); return d ? <span className={d.up?'diff-up':'diff-down'}>{d.up?'▲':'▼'} {d.pct}%</span> : null }
    return (
      <>
        <div className="metrics-grid" style={{marginBottom:20}}>
          <div className="metric-card highlight"><div className="m-label">月總營業額</div><div className="m-value">${fmt(cTotRev)} <DB curr={cTotRev} prev={pTotRev}/></div><div className="m-sub">去年同期 ${fmt(pTotRev)}</div></div>
          <div className="metric-card"><div className="m-label">總用餐人數</div><div className="m-value">{fmt(cTotG)} <DB curr={cTotG} prev={pTotG}/></div><div className="m-sub">去年同期 {fmt(pTotG)}</div></div>
          <div className="metric-card"><div className="m-label">平均客單價</div><div className="m-value">${fmt(cAvg)} <DB curr={cAvg} prev={pAvg}/></div><div className="m-sub">去年同期 ${fmt(pAvg)}</div></div>
        </div>
        <div className="table-card">
          <div className="table-header">各分店同期詳細比較</div>
          <table><thead><tr>
            <th>分店</th><th>類型</th><th>{year}年營業額</th><th>{year-1}年營業額</th><th>漲跌</th>
            <th>{year}年來客</th><th>{year-1}年來客</th><th>{year}年客單價</th><th>狀態</th>
          </tr></thead><tbody>
            {stores.map(s => {
              const c=fc[s], p=fp[s]
              const dn=(c||p).displayName, type=(c||p).type
              const cR=c?.rev||0, pR=p?.rev||0, cG=c?.guests||0, pG=p?.guests||0
              const cAp=c?.avgPays||[], cAv=cAp.length?cAp.reduce((a,b)=>a+b,0)/cAp.length:0
              const revChg = pR>0?((cR-pR)/pR*100):null
              const badge = revChg===null ? <span className="badge" style={{background:'#F3F4F6',color:'#6b7280'}}>-</span>
                : revChg>=5 ? <span className="badge badge-good">成長</span>
                : revChg<=-5 ? <span className="badge badge-danger">衰退</span>
                : <span className="badge badge-warn">持平</span>
              return <tr key={s}>
                <td className="cell-bold">{dn}</td>
                <td><span className={`badge ${type==='franchise'?'badge-franchise':'badge-direct'}`}>{type==='franchise'?'加盟':'直營'}</span></td>
                <td>${fmt(cR)}</td><td style={{color:'#9ca3af'}}>${fmt(pR)}</td>
                <td>{revChg!==null?<><span className={revChg>=0?'diff-up':'diff-down'}>{revChg>=0?'▲':'▼'}{Math.abs(revChg).toFixed(1)}%</span></>:'-'}</td>
                <td>{fmt(cG)}</td><td style={{color:'#9ca3af'}}>{fmt(pG)}</td>
                <td>${fmt(cAv)}</td><td>{badge}</td>
              </tr>
            })}
          </tbody></table>
        </div>
      </>
    )
  }

  return (
    <AppLayout>
      <header className="topbar">
        <div className="topbar-left"><h1 className="page-title">年度比較</h1></div>
        <div className="topbar-right">
          <div className="filter-group">
            {['all','direct','franchise'].map(f => <button key={f} className={`filter-btn ${storeFilter===f?'active':''}`} onClick={()=>setStoreFilter(f)}>{f==='all'?'全部':f==='direct'?'直營':'加盟'}</button>)}
          </div>
          <div className="divider-v"/>
          <span style={{fontSize:12,color:'#6b7280'}}>比較月份</span>
          <select className="form-input" style={{width:90,padding:'5px 8px',fontSize:12}} value={year} onChange={e=>setYear(+e.target.value)}>
            {years.map(y => <option key={y} value={y}>{y}年</option>)}
          </select>
          <select className="form-input" style={{width:80,padding:'5px 8px',fontSize:12}} value={month} onChange={e=>setMonth(+e.target.value)}>
            {Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{i+1}月</option>)}
          </select>
          <button className="btn-primary" disabled={loading} onClick={load}>{loading?'查詢中…':'載入比較'}</button>
        </div>
      </header>
      <div className="content-area">
        {!data ? <div className="empty-state"><p className="empty-title">選擇月份後點擊「載入比較」</p></div> : (
          <>
            <div className="yoy-header">
              <span className="yoy-badge yoy-curr">{year}年{month}月</span>
              <span style={{color:'#9ca3af',fontSize:13}}>vs</span>
              <span className="yoy-badge yoy-prev">{year-1}年{month}月</span>
            </div>
            {renderTable()}
            <div className="charts-row">
              <div className="chart-card"><div className="chart-title">各分店營業額對比</div><div style={{height:Math.max(200,Object.keys(processRecords(data.curr).byStore).length*55),position:'relative'}}><canvas ref={barRef}/></div></div>
              <div className="chart-card"><div className="chart-title">各分店客單價對比</div><div style={{height:Math.max(200,Object.keys(processRecords(data.curr).byStore).length*55),position:'relative'}}><canvas ref={avgRef}/></div></div>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  )
}
