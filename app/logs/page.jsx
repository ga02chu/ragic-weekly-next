'use client'
import { useEffect, useState } from 'react'
import AppLayout from '@/components/AppLayout'
import Topbar from '@/components/Topbar'
import { ReportProvider, useReport } from '@/components/ReportContext'
import { processRecords, fmtD, FRANCHISE_STORES } from '@/lib/utils'

function LogsContent() {
  const { records, storeFilter, sessionFilter, setSessionFilter, dateFrom, dateTo } = useReport()
  const [aiText, setAiText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  const { byStore } = processRecords(records, sessionFilter, storeFilter)
  const directStores = Object.entries(byStore).filter(([,v]) => v.type === 'direct').sort(([a],[b]) => a.localeCompare(b))

  useEffect(() => {
    if (!records.length || !directStores.length) return
    setAiLoading(true)
    setAiText('')

    let logsText = ''
    for (const [, d] of directStores) {
      logsText += `【${d.displayName}】\n`
      for (const r of d.records.sort((a,b) => a.date.localeCompare(b.date))) {
        const hasC = r.complaint && !['無','無客訴'].includes(r.complaint.trim())
        const hasF = r.food && r.food.trim() !== '無'
        const hasS = r.share && !['無','無事件分享'].includes(r.share.trim())
        if (!hasC && !hasF && !hasS) continue
        logsText += `${fmtD(r.date)} 值班：${r.supervisor}\n`
        if (hasC) logsText += `  客訴：${r.complaint}\n`
        if (hasF) logsText += `  食材：${r.food}\n`
        if (hasS) logsText += `  分享：${r.share}\n`
      }
      logsText += '\n'
    }

    fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logs: logsText, dateFrom, dateTo })
    }).then(r => r.json()).then(d => {
      setAiText(d.text || '')
    }).catch(() => setAiText('分析失敗')).finally(() => setAiLoading(false))
  }, [records, storeFilter, sessionFilter])

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

      <div className="ai-card">
        <div className="ai-header">
          <div className="ai-icon">✦</div>
          <div>
            <div className="ai-title">AI 週報分析</div>
            <div className="ai-sub">{aiLoading ? '正在分析...' : aiText ? `已完成分析・${dateFrom} ～ ${dateTo}` : '載入資料後自動分析'}</div>
          </div>
        </div>
        <div className="ai-body">
          {aiLoading && <div style={{display:'flex',flexDirection:'column',gap:8}}>{[100,80,90,70].map((w,i) => <div key={i} className="skeleton" style={{height:14,width:`${w}%`}} />)}</div>}
          {!aiLoading && aiText && aiText.split('\n').map((line, i) => {
            if (['📊','⚠️','✅','🎯'].some(e => line.startsWith(e))) return <div key={i} className="ai-section-title">{line}</div>
            if (!line.trim()) return <div key={i} style={{height:6}} />
            return <div key={i} className="ai-line">{line}</div>
          })}
        </div>
      </div>

      <div style={{fontSize:13,fontWeight:600,color:'#374151',marginBottom:16}}>各分店值班日誌</div>
      <div className="tl-grid">
        {directStores.map(([s, d]) => {
          const recs = d.records.sort((a,b) => a.date.localeCompare(b.date))
          return (
            <div key={s} className="tl-store-block">
              <div className="tl-store-name">{d.displayName}</div>
              <div className="tl-track">
                {recs.map((r, i) => {
                  const hasC = r.complaint && !['無','無客訴'].includes(r.complaint.trim())
                  const hasF = r.food && r.food.trim() !== '無'
                  const hasS = r.share && !['無','無事件分享'].includes(r.share.trim())
                  const dotClass = hasC ? 'tl-dot-complaint' : hasF ? 'tl-dot-food' : hasC||hasF||hasS ? 'tl-dot-share' : ''
                  return (
                    <div key={i} className={`tl-item ${!hasC&&!hasF&&!hasS?'tl-quiet':''}`}>
                      <div className={`tl-dot ${dotClass}`} />
                      <div className="tl-body">
                        <div className="tl-meta">{fmtD(r.date)} <span className="tl-sup">{r.supervisor}</span></div>
                        {hasC && <div className="tl-row"><span className="log-tag log-tag-c">客訴</span>{r.complaint}</div>}
                        {hasF && <div className="tl-row"><span className="log-tag log-tag-f">食材</span>{r.food}</div>}
                        {hasS && <div className="tl-row"><span className="log-tag log-tag-s">分享</span>{r.share}</div>}
                        {!hasC&&!hasF&&!hasS && <div className="tl-quiet-text">無特殊事項</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

export default function LogsPage() {
  return (
    <ReportProvider>
      <AppLayout>
        <Topbar title="主管日誌" />
        <div className="content-area"><LogsContent /></div>
      </AppLayout>
    </ReportProvider>
  )
}
