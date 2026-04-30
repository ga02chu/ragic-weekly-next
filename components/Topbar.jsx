'use client'
import { useReport } from './ReportContext'

const QUICK_RANGES = [
  { key: 'thisweek', label: '本週' },
  { key: 'lastweek', label: '上週' },
  { key: 'thismonth', label: '本月' },
  { key: 'lastmonth', label: '上個月' },
  { key: 'custom', label: '自訂' },
]

export default function Topbar({ title, rightExtra }) {
  const { dateFrom, dateTo, setDateFrom, setDateTo, activeRange, applyRange, storeFilter, setStoreFilter, loading, loadData } = useReport()

  return (
    <header className="topbar">
      <div className="topbar-left">
        <h1 className="page-title">{title}</h1>
        {dateFrom && dateTo && (
          <span className="date-label">{dateFrom} ～ {dateTo}</span>
        )}
      </div>
      <div className="topbar-right">
        {/* Store filter */}
        <div className="filter-group">
          {['all','direct','franchise'].map(f => (
            <button key={f} className={`filter-btn ${storeFilter === f ? 'active' : ''}`}
              onClick={() => setStoreFilter(f)}>
              {f === 'all' ? '全部' : f === 'direct' ? '直營' : '加盟'}
            </button>
          ))}
        </div>
        <div className="divider-v" />
        {/* Quick range */}
        <div className="filter-group">
          {QUICK_RANGES.map(r => (
            <button key={r.key} className={`quick-btn ${activeRange === r.key ? 'active' : ''}`}
              onClick={() => applyRange(r.key)}>
              {r.label}
            </button>
          ))}
        </div>
        {/* Custom date inputs */}
        {activeRange === 'custom' && (
          <div className="date-inputs">
            <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); applyRange('custom') }} />
            <span>—</span>
            <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); applyRange('custom') }} />
          </div>
        )}
        {rightExtra}
        <button className="btn-primary" disabled={loading} onClick={() => loadData(dateFrom, dateTo)}>
          {loading ? '查詢中…' : '載入報表'}
        </button>
      </div>
    </header>
  )
}
