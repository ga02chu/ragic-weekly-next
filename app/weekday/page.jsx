'use client'
import { useState, useEffect, useRef } from 'react'
import AppLayout from '@/components/AppLayout'
import { processRecords, fmt, isHoliday, getVal, toNum, getStoreType, getStoreDisplayName, BRAND, COLORS, getSettings, fetchRange } from '@/lib/utils'

export default function WeekdayPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [storeFilter, setStoreFilter] = useState('all')
  const [sessionFilter, setSessionFilter] = useState('all')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)
  const revRef = useRef(null), avgRef = useRef(null)
  const revChart = useRef(null), avgChart = useRef(null)
  const years = Array.from({length:4},(_,i)=>now.getFullYear()-i)

  const load = async () => {
    const s = getSettings()
    setLoading(true)
    const pad = n => String(n).padStart(2,'0')
    const lastDay = new Date(year, month, 0).getDate()
    try {
      const records = await fetchRange(s.token||'', s.path||'', `${year}-${pad(month)}-01`, `${year}-${pad(month)}-${pad(lastDay)}`)
      setData({ records, year, month })
    } catch(e) { alert('載入失敗：' + e.message) }
    finally { setLoading(false) }
  }

  const processWd = (records) => {
    const wd = { rev:0, guests:0, groups:0, noshow:0, avgPays:[], days:new Set() }
    const hd = { rev:0, guests:0, groups:0, noshow:0, avgPays:[], days:new Set() }
    const wdByStore = {}, hdByStore = {}
    for (const r of records) {
      const storeName = getVal(r,'store')||'未知'
      const session = getVal(r,'session')||''
      const type = getStoreType(storeName)
      if (storeFilter==='direct' && type!=='direct') continue
      if (storeFilter==='franchise' && type!=='franchise') continue
      if (sessionFilter==='noon' && session!=='中午') continue
      if (sessionFilter==='evening' && session!=='晚上') continue
      const date = getVal(r,'date')||''
      const rev = toNum(getVal(r,'rev'))
      const guests = toNum(getVal(r,'guests'))
      const groups = toNum(getVal(r,'groups'))
      const noshow = toNum(getVal(r,'noshow'))
      const avgPay = toNum(getVal(r,'avgPay'))
      const dn = getStoreDisplayName(storeName)
      const holiday = isHoliday(date)
      const bucket = holiday ? hd : wd
      const byStore = holiday ? hdByStore : wdByStore
      bucket.rev+=rev; bucket.guests+=guests; bucket.groups+=groups; bucket.noshow+=noshow
      if (avgPay>0) bucket.avgPays.push(avgPay)
      if (date) bucket.days.add(date)
      if (!byStore[storeName]) byStore[storeName]={ rev:0, guests:0, avgPays:[], displayName:dn, type }
      byStore[storeName].rev+=rev; byStore[storeName].guests+=guests
      if (avgPay>0) byStore[storeName].avgPays.push(avgPay)
    }
    return { wd, hd, wdByStore, hdByStore }
  }

  useEffect(() => {
    if (!data) return
    const { wdByStore, hdByStore, wd, hd } = processWd(data.records)
    const allStores = Array.from(new Set([...Object.keys(wdByStore),...Object.keys(hdByStore)])).sort()
    const labels = allStores.map(s=>(wdByStore[s]||hdByStore[s]).displayName)
    const wdDays = wd.days.size||1, hdDays = hd.days.size||1
    import('chart.js').then(({Chart,CategoryScale,LinearScale,BarElement,Tooltip,Legend})=>{
      Chart.register(CategoryScale,LinearScale,BarElement,Tooltip,Legend)
      revChart.current?.destroy(); avgChart.current?.destroy()
      const opts = cb => ({ indexAxis:'y', responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'top',labels:{boxWidth:12,font:{size:11}}}}, scales:{x:{ticks:{callback:cb,font:{size:10}}},y:{ticks:{font:{size:11}}}} })
      if (revRef.current) revChart.current = new Chart(revRef.current,{type:'bar',data:{labels,datasets:[
        {label:'平日日均',data:allStores.map(s=>(wdByStore[s]?.rev||0)/wdDays),backgroundColor:BRAND,borderRadius:4},
        {label:'假日日均',data:allStores.map(s=>(hdByStore[s]?.rev||0)/hdDays),backgroundColor:'#5c7a6e',borderRadius:4},
      ]},options:opts(v=>'$'+fmt(v))})
      if (avgRef.current) avgChart.current = new Chart(avgRef.current,{type:'bar',data:{labels,datasets:[
        {label:'平日客單價',data:allStores.map(s=>{const ap=wdByStore[s]?.avgPays||[];return ap.length?ap.reduce((a,b)=>a+b,0)/ap.length:0}),backgroundColor:BRAND,borderRadius:4},
        {label:'假日客單價',data:allStores.map(s=>{const ap=hdByStore[s]?.avgPays||[];return ap.length?ap.reduce((a,b)=>a+b,0)/ap.length:0}),backgroundColor:'#5c7a6e',borderRadius:4},
      ]},options:opts(v=>'$'+fmt(v))})
    })
  }, [data, storeFilter, sessionFilter])

  const renderContent = () => {
    if (!data) return <div className="empty-state"><p className="empty-title">選擇月份後點擊「載入分析」</p></div>
    const { wd, hd, wdByStore, hdByStore } = processWd(data.records)
    const allStores = Array.from(new Set([...Object.keys(wdByStore),...Object.keys(hdByStore)])).sort()
    const wdDays=wd.days.size||1, hdDays=hd.days.size||1
    const wdAvg=wd.avgPays.length?wd.avgPays.reduce((a,b)=>a+b,0)/wd.avgPays.length:0
    const hdAvg=hd.avgPays.length?hd.avgPays.reduce((a,b)=>a+b,0)/hd.avgPays.length:0
    return (
      <>
        <div className="yoy-header">
          <span className="yoy-badge yoy-curr">平日</span>
          <span style={{color:'#9ca3af',fontSize:13}}>vs</span>
          <span className="yoy-badge" style={{background:'#5c7a6e',color:'#fff'}}>假日</span>
          <span style={{fontSize:12,color:'#9ca3af',marginLeft:8}}>{year}年{month}月・平日{wdDays}天 / 假日{hdDays}天</span>
        </div>
        <div className="metrics-grid" style={{marginBottom:20}}>
          <div className="metric-card highlight"><div className="m-label">平日日均營業額</div><div className="m-value">${fmt(wd.rev/wdDays)}</div><div className="m-sub">假日日均 ${fmt(hd.rev/hdDays)}</div></div>
          <div className="metric-card"><div className="m-label">平日日均來客</div><div className="m-value">{fmt(wd.guests/wdDays)}</div><div className="m-sub">假日日均 {fmt(hd.guests/hdDays)}</div></div>
          <div className="metric-card"><div className="m-label">平日客單價</div><div className="m-value">${fmt(wdAvg)}</div><div className="m-sub">假日客單價 ${fmt(hdAvg)}</div></div>
          <div className="metric-card"><div className="m-label">平日 No Show</div><div className="m-value">{fmt(wd.noshow)}</div><div className="m-sub">假日 No Show {fmt(hd.noshow)}</div></div>
        </div>
        <div className="charts-row" style={{marginBottom:20}}>
          <div className="chart-card"><div className="chart-title">各分店日均營業額（平日 vs 假日）</div><div style={{height:Math.max(200,allStores.length*55),position:'relative'}}><canvas ref={revRef}/></div></div>
          <div className="chart-card"><div className="chart-title">各分店客單價（平日 vs 假日）</div><div style={{height:Math.max(200,allStores.length*55),position:'relative'}}><canvas ref={avgRef}/></div></div>
        </div>
        <div className="table-card">
          <div className="table-header">各分店平假日詳細比較</div>
          <table><thead><tr>
            <th>分店</th><th>平日營業額</th><th>假日營業額</th><th>平日來客</th><th>假日來客</th>
            <th>平日客單價</th><th>假日客單價</th><th style={{width:'16%'}}>客單價差異（假日-平日）</th>
          </tr></thead><tbody>
            {allStores.map(s=>{
              const w=wdByStore[s],h=hdByStore[s]
              const dn=(w||h).displayName
              const wAp=w?.avgPays||[],hAp=h?.avgPays||[]
              const wAv=wAp.length?wAp.reduce((a,b)=>a+b,0)/wAp.length:0
              const hAv=hAp.length?hAp.reduce((a,b)=>a+b,0)/hAp.length:0
              const diff=wAv>0?(hAv-wAv):null
              const diffPct=wAv>0?((hAv-wAv)/wAv*100):null
              const badge=diff===null?<span style={{color:'#9ca3af'}}>-</span>
                :diff>0?<span className="diff-up">▲ ${fmt(Math.abs(diff))} (+{Math.abs(diffPct).toFixed(1)}%)</span>
                :diff<0?<span className="diff-down">▼ ${fmt(Math.abs(diff))} (-{Math.abs(diffPct).toFixed(1)}%)</span>
                :<span style={{color:'#9ca3af'}}>持平</span>
              return <tr key={s}>
                <td className="cell-bold">{dn}</td>
                <td>${fmt(w?.rev||0)}</td><td>${fmt(h?.rev||0)}</td>
                <td>{fmt(w?.guests||0)}</td><td>{fmt(h?.guests||0)}</td>
                <td>${fmt(wAv)}</td><td>${fmt(hAv)}</td>
                <td style={{whiteSpace:'nowrap'}}>{badge}</td>
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
        <div className="topbar-left"><h1 className="page-title">平假日分析</h1></div>
        <div className="topbar-right">
          <div className="filter-group">
            {['all','direct','franchise'].map(f=><button key={f} className={`filter-btn ${storeFilter===f?'active':''}`} onClick={()=>setStoreFilter(f)}>{f==='all'?'全部':f==='direct'?'直營':'加盟'}</button>)}
          </div>
          <div className="divider-v"/>
          <div className="filter-group">
            {['all','noon','evening'].map(s=><button key={s} className={`filter-btn ${sessionFilter===s?'active':''}`} onClick={()=>setSessionFilter(s)}>{s==='all'?'全部時段':s==='noon'?'中午':'晚上'}</button>)}
          </div>
          <div className="divider-v"/>
          <select className="form-input" style={{width:90,padding:'5px 8px',fontSize:12}} value={year} onChange={e=>setYear(+e.target.value)}>
            {years.map(y=><option key={y} value={y}>{y}年</option>)}
          </select>
          <select className="form-input" style={{width:80,padding:'5px 8px',fontSize:12}} value={month} onChange={e=>setMonth(+e.target.value)}>
            {Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{i+1}月</option>)}
          </select>
          <button className="btn-primary" disabled={loading} onClick={load}>{loading?'查詢中…':'載入分析'}</button>
        </div>
      </header>
      <div className="content-area">{renderContent()}</div>
    </AppLayout>
  )
}
