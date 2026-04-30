'use client'
import { createContext, useContext, useState, useCallback } from 'react'
import { getRange, fetchRange, getPrevRange, getSettings } from '@/lib/utils'

const ReportContext = createContext(null)

export function ReportProvider({ children }) {
  const [records, setRecords] = useState([])
  const [prevRecords, setPrevRecords] = useState([])
  const [dateFrom, setDateFrom] = useState(() => getRange('thisweek').from)
  const [dateTo, setDateTo] = useState(() => getRange('thisweek').to)
  const [activeRange, setActiveRange] = useState('thisweek')
  const [storeFilter, setStoreFilter] = useState('all')
  const [sessionFilter, setSessionFilter] = useState('all')
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState('')

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const applyRange = useCallback((key) => {
    setActiveRange(key)
    if (key !== 'custom') {
      const r = getRange(key)
      setDateFrom(r.from)
      setDateTo(r.to)
    }
  }, [])

  const loadData = useCallback(async (from, to) => {
    const s = getSettings()
    const token = s.token || ''
    const path = s.path || ''
    setLoading(true)
    try {
      const prev = getPrevRange(from, to)
      const [curr, prevData] = await Promise.all([
        fetchRange(token, path, from, to),
        fetchRange(token, path, prev.from, prev.to),
      ])
      setRecords(curr)
      setPrevRecords(prevData)
      showToast(`已載入 ${curr.length} 筆資料`)
    } catch (e) {
      showToast('載入失敗：' + e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  return (
    <ReportContext.Provider value={{
      records, prevRecords, dateFrom, dateTo,
      setDateFrom, setDateTo, activeRange, applyRange,
      storeFilter, setStoreFilter,
      sessionFilter, setSessionFilter,
      loading, loadData, toast,
    }}>
      {children}
      {toast && (
        <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
      )}
    </ReportContext.Provider>
  )
}

export function useReport() {
  return useContext(ReportContext)
}
