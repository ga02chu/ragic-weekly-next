import { useState, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import {
  parsePay, parseAtt, parseLoc, parseAdj,
  calcResults, adjDeltaForMonth,
  fT, fN, fH
} from '../lib/hrCalc';

// ── Helpers ────────────────────────────────────────────────────────────────
const readWorkbook = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
      resolve(wb);
    } catch (err) { reject(err); }
  };
  reader.onerror = reject;
  reader.readAsArrayBuffer(file);
});

const getMonthRange = (year, month) => ({
  start: new Date(year, month - 1, 1),
  end: new Date(year, month, 0),
  days: new Date(year, month, 0).getDate(),
});

const today = new Date();
const DEFAULT_YEAR = today.getFullYear();
const DEFAULT_MONTH = today.getMonth() + 1;

// ── Upload Zone Component ──────────────────────────────────────────────────
function UploadZone({ icon, label, sublabel, onFile, loaded, filename }) {
  const ref = useRef();
  const [drag, setDrag] = useState(false);

  const handleFile = async (file) => {
    if (!file) return;
    try {
      const wb = await readWorkbook(file);
      onFile(wb, file.name);
    } catch (e) {
      alert(`讀取失敗：${file.name}\n${e.message}`);
    }
  };

  return (
    <div
      onClick={() => ref.current.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]); }}
      style={{
        border: `2px dashed ${loaded ? '#10b981' : drag ? '#6366f1' : '#e2e8f0'}`,
        borderRadius: 12, padding: '16px 12px', cursor: 'pointer', textAlign: 'center',
        background: loaded ? '#f0fdf4' : drag ? '#eef2ff' : '#fafafa',
        transition: 'all 0.2s', minWidth: 140,
      }}
    >
      <input ref={ref} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
        onChange={(e) => handleFile(e.target.files[0])} />
      <div style={{ fontSize: 24, marginBottom: 4 }}>{loaded ? '✅' : icon}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{label}</div>
      <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>
        {loaded ? filename : sublabel}
      </div>
    </div>
  );
}

// ── Metric Card ────────────────────────────────────────────────────────────
function MetricCard({ label, value, color = '#374151', prefix = '' }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 12, padding: '16px 20px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.08)', flex: 1, minWidth: 140,
    }}>
      <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{prefix}{value}</div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function WeeklyReport({ onResultsReady }) {
  // File state
  const [PAY, setPAY] = useState(null);
  const [ATT, setATT] = useState(null);
  const [LOC, setLOC] = useState(null);
  const [ADJ, setADJ] = useState([]);
  const [payName, setPayName] = useState('');
  const [attName, setAttName] = useState('');
  const [locName, setLocName] = useState('');
  const [adjName, setAdjName] = useState('');

  // Period state
  const [year, setYear] = useState(DEFAULT_YEAR);
  const [month, setMonth] = useState(DEFAULT_MONTH);
  const [startDay, setStartDay] = useState(1);
  const [endDay, setEndDay] = useState(new Date(DEFAULT_YEAR, DEFAULT_MONTH, 0).getDate());

  // Results
  const [results, setResults] = useState(null);
  const [tab, setTab] = useState('全部');
  const [locFilter, setLocFilter] = useState('');
  const [storeFilter, setStoreFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const monthRange = getMonthRange(year, month);

  // ── Calculate ────────────────────────────────────────────────────────────
  const calculate = useCallback(async () => {
    if (!PAY || !ATT) { setError('請先上傳薪資保險資料和出勤記錄'); return; }
    setLoading(true); setError('');
    try {
      const sDate = new Date(year, month - 1, startDay);
      const eDate = new Date(year, month - 1, endDay);
      eDate.setHours(23, 59, 59);
      const mDays = monthRange.days;
      const totalDays = Math.floor((eDate - sDate) / 86400000) + 1;
      const pf = totalDays / mDays;
      const adjMap = adjDeltaForMonth(ADJ, year, month);
      const res = calcResults(sDate, eDate, storeFilter || null, 168, pf, adjMap, false, locFilter);
      setResults({ ...res, pf, mDays, totalDays, sDate, eDate });
      if (onResultsReady) onResultsReady(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [PAY, ATT, year, month, startDay, endDay, storeFilter, locFilter, ADJ, onResultsReady]);

  // ── Summary metrics ──────────────────────────────────────────────────────
  const metrics = results ? (() => {
    const all = results.results;
    const pf = results.pf;
    const propSal = all.reduce((s, r) => s + (r.propSal || 0), 0);
    const propIns = all.reduce((s, r) => s + (r.propIns || 0), 0);
    const ftOT = all.filter(r => r.type === '月薪正職').reduce((s, r) => s + (r.weekOtPay || 0), 0);
    const ptOT = all.filter(r => r.type !== '月薪正職').reduce((s, r) => s + (r.otPay || 0), 0);
    const estOT = ftOT + ptOT;
    const totalCost = propSal + propIns + ftOT;
    const ftCount = all.filter(r => r.type === '月薪正職').length;
    const ptCount = all.filter(r => r.type === '時薪工讀').length;
    return { propSal, propIns, estOT, totalCost, ftCount, ptCount, pf };
  })() : null;

  // ── Table data ───────────────────────────────────────────────────────────
  const tableData = results ? results.results.filter(e => {
    if (tab === '月薪正職') return e.type === '月薪正職';
    if (tab === '時薪工讀') return e.type === '時薪工讀';
    return true;
  }) : [];

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'Noto Sans TC', sans-serif", padding: 24, maxWidth: 1400, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', margin: 0 }}>人事成本週報</h1>
        <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>上傳資料後自動計算期間人事成本</p>
      </div>

      {/* Upload Row */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <UploadZone icon="💼" label="薪資保險資料" sublabel="必填" loaded={!!PAY} filename={payName}
          onFile={(wb, name) => { setPAY(parsePay(wb)); setPayName(name); }} />
        <UploadZone icon="🕐" label="Apollo 出勤記錄" sublabel="必填" loaded={!!ATT} filename={attName}
          onFile={(wb, name) => { setATT(parseAtt(wb)); setAttName(name); }} />
        <UploadZone icon="📍" label="打卡地點紀錄" sublabel="選填" loaded={!!LOC} filename={locName}
          onFile={(wb, name) => { setLOC(parseLoc(wb)); setLocName(name); }} />
        <UploadZone icon="📋" label="人事調整記錄" sublabel="選填" loaded={ADJ.length > 0} filename={adjName}
          onFile={(wb, name) => { setADJ(parseAdj(wb)); setAdjName(name); }} />
      </div>

      {/* Period Controls */}
      <div style={{
        background: '#fff', borderRadius: 12, padding: '16px 20px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 20,
        display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap'
      }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 12, color: '#6b7280' }}>年月</label>
          <select value={year} onChange={e => setYear(+e.target.value)}
            style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '4px 8px', fontSize: 13 }}>
            {[2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={month} onChange={e => { setMonth(+e.target.value); setEndDay(new Date(year, +e.target.value, 0).getDate()); }}
            style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '4px 8px', fontSize: 13 }}>
            {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}月</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 12, color: '#6b7280' }}>期間</label>
          <input type="number" min={1} max={monthRange.days} value={startDay}
            onChange={e => setStartDay(+e.target.value)}
            style={{ width: 50, border: '1px solid #e5e7eb', borderRadius: 6, padding: '4px 6px', fontSize: 13, textAlign: 'center' }} />
          <span style={{ color: '#9ca3af' }}>—</span>
          <input type="number" min={1} max={monthRange.days} value={endDay}
            onChange={e => setEndDay(+e.target.value)}
            style={{ width: 50, border: '1px solid #e5e7eb', borderRadius: 6, padding: '4px 6px', fontSize: 13, textAlign: 'center' }} />
          <span style={{ fontSize: 12, color: '#9ca3af' }}>日</span>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {[[1, monthRange.days, '整月'],
            [1, 7, '第1週'], [8, 14, '第2週'], [15, 21, '第3週'], [22, monthRange.days, '第4週']
          ].map(([s, e, lbl]) => (
            <button key={lbl} onClick={() => { setStartDay(s); setEndDay(e); }}
              style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                border: startDay === s && endDay === e ? '1px solid #6366f1' : '1px solid #e5e7eb',
                background: startDay === s && endDay === e ? '#eef2ff' : '#fff',
                color: startDay === s && endDay === e ? '#6366f1' : '#374151',
              }}>{lbl}</button>
          ))}
        </div>

        <button onClick={calculate} disabled={!PAY || !ATT || loading}
          style={{
            padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            border: 'none', cursor: PAY && ATT ? 'pointer' : 'not-allowed',
            background: PAY && ATT ? '#6366f1' : '#e5e7eb',
            color: PAY && ATT ? '#fff' : '#9ca3af',
          }}>
          {loading ? '計算中...' : '🔢 計算'}
        </button>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: 13, color: '#dc2626' }}>
          ❌ {error}
        </div>
      )}

      {/* Metrics */}
      {metrics && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <MetricCard label={`期間薪資（${Math.round(metrics.pf * 100)}%）`} value={fT(Math.round(metrics.propSal))} color="#f59e0b" />
          <MetricCard label="期間加班費" value={fT(Math.round(metrics.estOT))} color="#f97316" />
          <MetricCard label="期間保費" value={fT(Math.round(metrics.propIns))} color="#10b981" />
          <MetricCard label="期間人事成本" value={fT(Math.round(metrics.totalCost))} color="#6366f1" />
          <MetricCard label="正職人數" value={metrics.ftCount} color="#374151" prefix="" />
          <MetricCard label="工讀人數" value={metrics.ptCount} color="#374151" prefix="" />
        </div>
      )}

      {/* Table */}
      {results && (
        <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #f3f4f6', padding: '0 16px' }}>
            {['全部', '月薪正職', '時薪工讀'].map(t => (
              <button key={t} onClick={() => setTab(t)}
                style={{
                  padding: '12px 16px', fontSize: 13, fontWeight: tab === t ? 600 : 400,
                  border: 'none', borderBottom: tab === t ? '2px solid #6366f1' : '2px solid transparent',
                  background: 'none', cursor: 'pointer',
                  color: tab === t ? '#6366f1' : '#6b7280',
                }}>
                {t}
              </button>
            ))}
          </div>

          {/* Table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '1px solid #f3f4f6' }}>
                  {['工號', '姓名', '門市', '類型', '工時', '期間薪資', '加班費', '加扣項', '期間保費', '期間成本'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: h === '工號' || h === '姓名' || h === '門市' ? 'left' : 'right', fontWeight: 600, color: '#374151', fontSize: 11, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableData.map((e, i) => {
                  const isFT = e.type === '月薪正職';
                  const sal = isFT ? Math.round(e.propSal) : Math.round(e.gross || 0);
                  const ot = isFT ? Math.round(e.weekOtPay || 0) : Math.round(e.ptDailyOt || 0);
                  const ins = Math.round(e.propIns || 0);
                  const cost = sal + (isFT ? ot : 0) + ins;
                  const hasRec = !isFT && (e.totalH || 0) > 0;

                  return (
                    <tr key={e.id} style={{ borderBottom: '1px solid #f9fafb', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                      <td style={{ padding: '8px 12px', color: '#9ca3af', fontSize: 11 }}>{e.id}</td>
                      <td style={{ padding: '8px 12px', fontWeight: 600, color: '#111827' }}>{e.name}</td>
                      <td style={{ padding: '8px 12px', color: '#6b7280', fontSize: 11 }}>{e.dept}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={{
                          padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 600,
                          background: isFT ? '#dbeafe' : '#d1fae5',
                          color: isFT ? '#1d4ed8' : '#065f46',
                        }}>{e.type}</span>
                        {e.loc && <span style={{ fontSize: 9, color: '#9ca3af', marginLeft: 4 }}>{e.loc}</span>}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', color: '#6b7280' }}>
                        {!isFT && !hasRec ? <span style={{ color: '#d1d5db' }}>無記錄</span> : fH(e.totalH || 0)}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', color: '#f59e0b', fontWeight: 600 }}>
                        {e.noPunch && isFT ? <span style={{ color: '#d1d5db' }}>–</span> : (!isFT && !hasRec ? <span style={{ color: '#d1d5db' }}>無記錄</span> : fT(sal))}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', color: ot > 0 ? '#f97316' : '#d1d5db' }}>
                        {ot > 0 ? fT(ot) : '–'}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11 }}>
                        {e.extra && e.extra !== 0 ? (
                          <span style={{ color: e.extra > 0 ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                            {e.extra > 0 ? '+' : ''}{fT(e.extra)}
                          </span>
                        ) : <span style={{ color: '#d1d5db' }}>–</span>}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', color: '#10b981' }}>{fT(ins)}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: '#6366f1' }}>
                        {e.noPunch && isFT ? <span style={{ color: '#d1d5db' }}>–</span> : fT(cost)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {tableData.length > 0 && (
                <tfoot>
                  <tr style={{ background: '#f9fafb', borderTop: '2px solid #e5e7eb', fontWeight: 700 }}>
                    <td colSpan={5} style={{ padding: '10px 12px', fontSize: 12, color: '#6b7280' }}>合計 {tableData.length} 人</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: '#f59e0b' }}>
                      {fT(tableData.reduce((s, e) => s + (e.noPunch && e.type === '月薪正職' ? 0 : Math.round(e.type === '月薪正職' ? e.propSal : (e.gross || 0))), 0))}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: '#f97316' }}>
                      {fT(tableData.reduce((s, e) => s + (e.type === '月薪正職' ? Math.round(e.weekOtPay || 0) : Math.round(e.ptDailyOt || 0)), 0))}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: '#6b7280' }}>
                      {fT(tableData.reduce((s, e) => s + (e.extra || 0), 0))}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: '#10b981' }}>
                      {fT(tableData.reduce((s, e) => s + Math.round(e.propIns || 0), 0))}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: '#6366f1' }}>
                      {fT(tableData.reduce((s, e) => {
                        if (e.noPunch && e.type === '月薪正職') return s;
                        const sal = e.type === '月薪正職' ? Math.round(e.propSal) : Math.round(e.gross || 0);
                        const ot = e.type === '月薪正職' ? Math.round(e.weekOtPay || 0) : 0;
                        return s + sal + ot + Math.round(e.propIns || 0);
                      }, 0))}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
