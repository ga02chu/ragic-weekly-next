/**
 * hrCalc.js — 料韓男餐飲 人事成本計算引擎
 * 
 * 使用方式：
 *   import { parsePay, parseAtt, parseLoc, parseAdj, calcResults, adjDeltaForMonth } from './hrCalc';
 * 
 * 需要安裝：npm install xlsx
 */

// ── 保費費率 ────────────────────────────────────────────────────────────────
const R = { lb:0.0875, voc:0.0017, rsv:0.00025, pen:0.06, hb:0.0484 };
const FT_DIV = 240;

// ── Rates ────────────────────────────────────────────────────────────────

// ── State ─────────────────────────────────────────────────────────────────
let PAY=null,ATT=null,LOC=null,ADJ=[];


// ── Utilities ─────────────────────────────────────────────────────────────
const fN=(n,d=0)=>Number(n).toLocaleString('zh-TW',{minimumFractionDigits:d,maximumFractionDigits:d});
const fH=n=>`${Number(n).toFixed(2)}H`;
const fT=n=>`$${fN(Math.round(n))}`;
const fD=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
function pd(s){const m=String(s||'').trim().match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);return m?new Date(+m[1],+m[2]-1,+m[3]):null;}
function pMin(t){const p=String(t||'').trim().split(':');if(p.length<2)return null;const h=+p[0],m=+p[1];return isNaN(h)||isNaN(m)?null:h*60+m;}
function rawH(i,o){if(i==null||o==null)return 0;let e=o;if(e<=i)e+=1440;return(e-i)/60;}
function isCross(i,o){return i!=null&&o!=null&&o<=i&&o>0;}

// ── Insurance ─────────────────────────────────────────────────────────────
function calcIns(e){
  const lb=(e.lbB||0)*R.lb,voc=(e.vocB||0)*R.voc,rsv=(e.lbB||0)*R.rsv;
  const pen=(e.penB||0)*R.pen,hb=(e.hbB||0)*R.hb;
  return{lb,voc,rsv,pen,hb,total:lb+voc+rsv+pen+hb};
}

// ── PT bonus — uses payroll dept (e.dept), never attendance dept ──────────
function ptBonus(dept,h){
  const isE=dept==='英洙家';
  let b66=0,rAddon=0;
  if(isE){if(h>=66)b66=600;}else{if(h>=66)rAddon=10;}
  // 時數加給：排班超過100H → +1,000（無120H/150H級距）
  // 連續3月>80H季獎金 +1,000 需手動加計（系統無法自動追蹤跨月資料）
  const bH=h>=100?1000:0;
  return{b66,rAddon,bH};
}
function ptOTP(h,rate){
  if(h<=8)return 0;const ot=h-8;
  return Math.min(ot,2)*rate*0.34+Math.max(0,ot-2)*rate*0.67;
}

// FT OT — includes 考績獎金 (matches Apollo payslip)
function ftOTbase(e){return e.baseSalary+e.mealAllow+e.mgmtAllow+e.perfBonus+e.annualBonus+e.skillAllow;}
function ftOT(otH,hr){
  if(otH<=0)return 0;
  return otH<=40?otH*hr*1.34:40*hr*1.34+(otH-40)*hr*1.67;
}

// ── Effective standard hours ──────────────────────────────────────────────
// Priority: manual OVR > monthly ADJ delta > defaultStd
// adjMap is pre-computed for the target month via adjDeltaForMonth()
function effStd(id,defaultStd,adjMap){
  if(OVR[id]!==undefined)return OVR[id];
  adjMap=adjMap||{};
  if(adjMap[id]!==undefined)return Math.max(0,defaultStd+(adjMap[id].delta||0));
  const emp=PAY&&PAY.find(e=>e.id===id);
  if(emp){
    const nk='__name__'+emp.name;
    if(adjMap[nk]!==undefined)return Math.max(0,defaultStd+(adjMap[nk].delta||0));
  }
  return defaultStd;
}

// ── Parse payroll (handles old format without 職稱 AND new format with 職稱) ──
function parsePay(wb){
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:''});
  let hi=rows.findIndex(r=>String(r[0]).trim()==='工號'||String(r[1]).trim()==='工號');
  if(hi<0)hi=1;
  const hdr=rows[hi].map(c=>String(c).trim());
  // Find insurance bracket columns by name (robust to column shifts)
  const fC=n=>hdr.findIndex(h=>h.includes(n));
  const lbAmtIdx=fC('勞保投保金額'), vocAmtIdx=fC('職保投保金額');
  const penAmtIdx=fC('勞退投保金額'), hbAmtIdx=fC('健保投保金額');
  const titleIdx=hdr.indexOf('職稱'); // -1 if old format without 職稱

  return rows.slice(hi+1).filter(r=>String(r[0]).trim().startsWith('N')).map(r=>{
    const bs=+r[3]||0,hr=+r[5]||0,meal=+r[4]||0,mgmt=+r[6]||0,housing=+r[7]||0;
    const perf=+r[8]||0,annual=+r[9]||0,skill=+r[10]||0;
    // 職稱 → 場別 (titleLoc)
    const title=titleIdx>=0?String(r[titleIdx]||'').trim():'';
    let titleLoc='';
    if(title.includes('內場')||title==='廚師長')titleLoc='內場';
    else if(title.includes('外場'))titleLoc='外場';
    else if(title==='兼職人員')titleLoc='兼職';
    else if(['督導','行政助理','執行長','廚師長'].some(t=>title.includes(t))&&!title.includes('內場')&&!title.includes('外場'))titleLoc='總部';
    return{id:String(r[0]).trim(),name:String(r[1]).trim(),dept:String(r[2]).trim(),
      baseSalary:bs,mealAllow:meal,hourlyRate:hr,mgmtAllow:mgmt,housingAllow:housing,
      perfBonus:perf,annualBonus:annual,skillAllow:skill,title,titleLoc,
      fixedSalary:bs+meal+mgmt+housing+perf+annual+skill,
      lbB:lbAmtIdx>=0?+r[lbAmtIdx]||0:0,
      vocB:vocAmtIdx>=0?+r[vocAmtIdx]||0:0,
      penB:penAmtIdx>=0?+r[penAmtIdx]||0:0,
      hbB:hbAmtIdx>=0?+r[hbAmtIdx]||0:0,
      type:bs>0?'月薪正職':hr>0?'時薪工讀':'未設定'};
  });
}

// ── Time parsing helpers ──────────────────────────────────────────────────
// Handles: string '16:53', Excel fraction 0.7034, Date object
function parseTimeFrac(val){
  if(val===null||val===undefined||val==='')return null;
  // Excel time fraction (0-1 = 0:00-24:00)
  if(typeof val==='number'&&val>=0&&val<1){
    const total=Math.round(val*1440); return total; // minutes since midnight
  }
  // Date object (some XLSX versions return time as Date)
  if(val instanceof Date&&!isNaN(val)){
    return val.getHours()*60+val.getMinutes();
  }
  // String 'HH:MM' or 'HH:MM:SS'
  const s=String(val).trim();
  const m=s.match(/^(\d{1,2}):(\d{2})/);
  if(m)return +m[1]*60+(+m[2]);
  return null;
}
function pMinFlex(val){return parseTimeFrac(val);}

// Parse date cell: string, Date obj, or Excel serial
function parseAttDate(val){
  if(!val&&val!==0)return{str:'',date:null};
  if(val instanceof Date&&!isNaN(val)){
    const str=`${val.getFullYear()}/${String(val.getMonth()+1).padStart(2,'0')}/${String(val.getDate()).padStart(2,'0')}`;
    return{str,date:val};
  }
  if(typeof val==='number'){
    // Excel serial date
    const d=new Date(Math.round((val-25569)*86400000));
    const str=`${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
    return{str,date:d};
  }
  const s=String(val).trim();
  return{str:s,date:pd(s)};
}

// Fuzzy column finder: finds first col whose name includes the keyword
function fuzzyCol(hdr,keyword){
  const k=keyword.replace(/\s/g,'');
  return hdr.findIndex(c=>String(c).trim().replace(/\s/g,'').includes(k));
}

// ── Parse attendance ──────────────────────────────────────────────────────
function parseAtt(wb){
  // Try each sheet — look for one with '實際工時' or '上班打卡時間'
  for(const nm of wb.SheetNames){
    const ws=wb.Sheets[nm];
    const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',cellDates:true});
    const hi=rows.findIndex(r=>r.some(c=>{const s=String(c).trim();return s==='實際工時'||s==='上班打卡時間';}));
    if(hi<0)continue;
    const hdr=rows[hi].map(c=>String(c).trim());
    const C=n=>fuzzyCol(hdr,n);
    const cu=C('單位'),ci=C('工號'),cn=C('姓名'),cd=C('日期');
    const cin=C('上班打卡時間'),cout=C('下班打卡時間'),ca=C('實際工時');
    if(ci<0)continue; // must have 工號 column
    const records=rows.slice(hi+1).filter(r=>String(r[ci]||'').trim().startsWith('N')).map(r=>{
      const iM=pMinFlex(r[cin]),oM=pMinFlex(r[cout]);
      const{str:dateStr,date}=parseAttDate(r[cd]);
      const hours=ca>=0&&r[ca]!==''&&r[ca]!==null?+r[ca]||0:rawH(iM,oM);
      return{dept:String(r[cu]||'').trim(),id:String(r[ci]).trim(),name:String(r[cn]||'').trim(),
        dateStr,date,hours,
        inTime:r[cin]!=null?String(r[cin]):'',outTime:r[cout]!=null?String(r[cout]):'',
        crossMidnight:isCross(iM,oM)};
    });
    if(records.length>0){
      // ── Parse 加扣項匯入檔 from same workbook ───────────────────────────
      const extras={},extrasDetail={};
      const EXTRA_INCLUDE=['1000','2000','5001','6000','6004','7000','8000','9000','20032','7001','6005','6001','6003'];
      const EXTRA_SKIP=['7004','3006','3007','3008'];
      const CODE_DESC={'1000':'時數不足扣回','2000':'免稅加班費','5001':'考績獎金',
        '6000':'加給','6004':'人力不足加給','8000':'扣項-其他','9000':'加項-其他',
        '20032':'不休假代金-特休','7001':'補發'};
      const adjSN=wb.SheetNames.find(n=>n.includes('加扣項'));
      if(adjSN){
        const adjR=XLSX.utils.sheet_to_json(wb.Sheets[adjSN],{header:1,defval:''});
        adjR.forEach(r=>{
          const eid=String(r[0]||'').trim();
          if(!eid.startsWith('N'))return;
          const code=String(r[2]||'').trim();
          if(EXTRA_SKIP.includes(code)||!EXTRA_INCLUDE.includes(code))return;
          let amt=parseFloat(r[3]);
          if(isNaN(amt)||amt===0)return;
          // 8000=扣項-其他: positive amount in file means DEDUCT (negate it)
          if(code==='8000')amt=-Math.abs(amt);
          const note=String(r[4]||'').trim().replace(/\n/g,' ');
          extras[eid]=(extras[eid]||0)+amt;
          if(!extrasDetail[eid])extrasDetail[eid]=[];
          extrasDetail[eid].push({code,desc:CODE_DESC[code]||code,amt,note});
        });
      }
      return{isApollo:ca>=0,records,extras,extrasDetail};
    }
  }
  // Fallback: first sheet, treat as 上下班打卡紀錄 (has 上班時間 / 下班時間)
  const ws=wb.Sheets[wb.SheetNames[0]];
  const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',cellDates:true});
  let hi=rows.findIndex(r=>r.some(c=>String(c).trim()==='單位'));if(hi<0)hi=0;
  const hdr=rows[hi].map(c=>String(c).trim());
  const C=n=>fuzzyCol(hdr,n);
  const cu=C('單位'),ci=C('工號'),cn=C('姓名'),cd=C('日期');
  const cin=C('上班時間'),cout=C('下班時間');
  return{isApollo:false,extras:{},extrasDetail:{},records:rows.slice(hi+1).filter(r=>String(r[ci]||'').trim().startsWith('N')).map(r=>{
    const iM=pMinFlex(r[cin]),oM=pMinFlex(r[cout]);
    const{str:dateStr,date}=parseAttDate(r[cd]);
    return{dept:String(r[cu]||'').trim(),id:String(r[ci]).trim(),name:String(r[cn]||'').trim(),
      dateStr,date,hours:rawH(iM,oM),
      inTime:r[cin]!=null?String(r[cin]):'',outTime:r[cout]!=null?String(r[cout]):'',
      crossMidnight:isCross(iM,oM)};
  })};
}

// ── Parse location ────────────────────────────────────────────────────────
function parseLoc(wb){
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:'',cellDates:true});
  let hi=rows.findIndex(r=>String(r[0]).trim()==='單位');if(hi<0)hi=0;
  const h=rows[hi].map(c=>String(c).trim());
  const C=n=>fuzzyCol(h,n);
  const[ci,cn,cd,cit,col,cot,cdl]=[C('工號'),C('姓名'),C('日期'),C('上班時間'),C('上班地點'),C('下班時間'),C('下班地點')];
  return rows.slice(hi+1).filter(r=>String(r[ci]||'').trim().startsWith('N')).map(r=>{
    const iM=pMinFlex(r[cit]),oM=pMinFlex(r[cot]);
    const hrs=rawH(iM,oM);
    const inL=String(r[col]||'').trim()||'未知';
    const outL=cdl>=0?String(r[cdl]||'').trim()||'未知':'';
    const cross=outL&&outL!==inL&&outL!=='未知';
    const{str:dateStr,date}=parseAttDate(r[cd]);
    return{id:String(r[ci]).trim(),name:String(r[cn]||'').trim(),
      dateStr,date,inLoc:inL,outLoc:outL,hours:hrs,cross};
  });
}

// ── Parse a date cell from Excel (handles Date obj, number, or string) ─────
function parseLeaveDate(val){
  if(!val&&val!==0)return null;
  if(val instanceof Date)return isNaN(val)?null:val;
  // Excel serial number → JS date
  if(typeof val==='number'){
    // Excel epoch is Jan 1 1900; JS epoch is Jan 1 1970
    const d=new Date(Math.round((val-25569)*86400000));
    return isNaN(d)?null:d;
  }
  return pd(String(val));
}

// ── Parse leave table → store records with dates ─────────────────────────
// Format: 姓名 | 假別 | 開始日期 | 結束日期 | 請假天數
// Delta is computed PER MONTH at render time, so leaves from different months don't bleed over
function parseAdj(wb){
  const records=[];
  const addLeave=(name,type,days,startDate,endDate)=>{
    name=name.replace(/（範例）/g,'').trim();
    if(!name||name==='姓名'||name.includes('範例'))return;
    if(name&&type&&(days!==0||type==='到職'||type==='離職'))
      records.push({name,type,days,startDate,endDate});
  };
  const sheetNames=wb.SheetNames;
  const isMulti=sheetNames.some(n=>['上個月不足','本月請假','新進人員','離職人員'].includes(n));

  if(isMulti){
    const s1=wb.Sheets['上個月不足'];
    if(s1){
      const r=XLSX.utils.sheet_to_json(s1,{header:1,defval:'',cellDates:true});
      const hi=r.findIndex(row=>row.some(c=>String(c).trim()==='姓名'));
      r.slice(Math.max(hi,0)+1).forEach(row=>{
        const name=String(row[0]||'').trim();
        const h=parseFloat(row[1]);
        if(name&&!isNaN(h)&&h>0)addLeave(name,'前月不足',h,null,null);
      });
    }
    const s2=wb.Sheets['本月請假'];
    if(s2){
      const r=XLSX.utils.sheet_to_json(s2,{header:1,defval:'',cellDates:true});
      const hi=r.findIndex(row=>row.some(c=>String(c).trim()==='假別'));
      r.slice(Math.max(hi,0)+1).forEach(row=>{
        const name=String(row[0]||'').trim();
        const type=String(row[1]||'').trim();
        const days=parseFloat(row[4]);
        if(name&&type&&!isNaN(days)&&days>0)
          addLeave(name,type,days,parseLeaveDate(row[2]),parseLeaveDate(row[3]));
      });
    }
    const s3=wb.Sheets['新進人員'];
    if(s3){
      const r=XLSX.utils.sheet_to_json(s3,{header:1,defval:'',cellDates:true});
      const hi=r.findIndex(row=>row.some(c=>String(c).trim()==='到職日期'));
      r.slice(Math.max(hi,0)+1).forEach(row=>{
        const name=String(row[0]||'').trim();
        const d=parseLeaveDate(row[1]);
        if(name&&d)addLeave(name,'到職',0,d,null);
      });
    }
    const s4=wb.Sheets['離職人員'];
    if(s4){
      const r=XLSX.utils.sheet_to_json(s4,{header:1,defval:'',cellDates:true});
      const hi=r.findIndex(row=>row.some(c=>String(c).trim()==='最後上班日'));
      r.slice(Math.max(hi,0)+1).forEach(row=>{
        const name=String(row[0]||'').trim();
        const d=parseLeaveDate(row[1]);
        if(name&&d)addLeave(name,'離職',0,d,null);
      });
    }
    const s5=wb.Sheets['其他加扣項目'];
    if(s5){
      const r=XLSX.utils.sheet_to_json(s5,{header:1,defval:'',cellDates:true});
      const hi=r.findIndex(row=>row.some(c=>String(c).trim()==='金額'));
      r.slice(Math.max(hi,0)+1).forEach(row=>{
        const name=String(row[0]||'').trim();
        const amt=parseFloat(row[2]);
        if(name&&!isNaN(amt)&&amt!==0)addLeave(name,'加扣項目',amt,null,null);
      });
    }
  } else {
    // Legacy single-sheet
    const ws=wb.Sheets[sheetNames[0]];
    const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',cellDates:true});
    let hi=rows.findIndex(r=>r.some(c=>String(c).trim()==='假別'));if(hi<0)hi=0;
    const hdr=rows[hi].map(c=>String(c).trim());
    const C=n=>hdr.indexOf(n);
    const[cn,ct,cs,ce,cd]=[C('姓名'),C('假別'),C('開始日期'),C('結束日期'),C('請假天數（或不足時數）')];
    rows.slice(hi+1).filter(r=>String(r[cn]||'').trim()).forEach(r=>{
      const name=String(r[cn]).trim();
      const type=String(r[ct]||'').trim();
      const days=parseFloat(r[cd])||0;
      addLeave(name,type,days,parseLeaveDate(r[cs]),parseLeaveDate(r[ce]));
    });
  }
  return records;
}
// Compute per-employee delta for a specific month (year+month)
// Only include leaves whose dates fall in that month (or 前月不足 which is always applied)
function adjDeltaForMonth(year,month){
  if(!ADJ||!Array.isArray(ADJ))return{};
  const nameToId={};
  if(PAY)PAY.forEach(e=>{if(e.name)nameToId[e.name.trim()]=e.id;});
  const deduct8=['特休','事假','公傷假','公假'];
  const deduct4=['病假','生理假'];
  const deltaByName={};
  ADJ.forEach(r=>{
    const{name,type,days,startDate}=r;
    // 前月不足：no date filter (user must upload per-month file)
    // Other leaves: only count if startDate is in the target month
    const isPrevDeficit=type.includes('前月不足');
    if(!isPrevDeficit){
      // Must have a valid startDate AND it must fall in the target month
      if(!startDate)return; // no date = skip (don't leak into all months)
      if(startDate.getFullYear()!==year||startDate.getMonth()!==month-1)return;
    }
    if(!deltaByName[name])deltaByName[name]=0;
    if(isPrevDeficit)deltaByName[name]+=days;
    else if(deduct8.some(t=>type.includes(t)))deltaByName[name]-=days*8;
    else if(deduct4.some(t=>type.includes(t)))deltaByName[name]-=days*4;
  });
  // Map name → {id, delta}
  const result={};
  Object.entries(deltaByName).forEach(([name,delta])=>{
    const id=nameToId[name]||('__name__'+name);
    result[id]={delta,name};
  });
  return result;
}

// ── Download template ─────────────────────────────────────────────────────
function downloadTemplate(){
  const wb=XLSX.utils.book_new();
  const ft=PAY?PAY.filter(e=>e.type==='月薪正職'):[];

  // Sheet 1: 上個月不足
  const s1=[
    ['人事調整記錄表 ─ 上個月不足'],
    ['說明：填上個月出勤不足的小時數，系統將加回本月應執勤時數'],
    [],
    ['姓名','不足時數(H)','備註'],
    ['（範例）出曜綸',11.7,'2月不足11.7H'],
    [],...ft.map(e=>[e.name,'',''])
  ];
  const ws1=XLSX.utils.aoa_to_sheet(s1);
  ws1['!cols']=[{wch:10},{wch:10},{wch:20}];
  XLSX.utils.book_append_sheet(wb,ws1,'上個月不足');

  // Sheet 2: 本月請假
  const s2=[
    ['人事調整記錄表 ─ 本月請假'],
    ['假別：特休/事假/公傷假 = 天×8H；病假/生理假 = 天×4H'],
    [],
    ['姓名','假別','開始日期','結束日期','請假天數'],
    ['（範例）賴羽宣','特休','2026/04/03','2026/04/03',1],
    ['（範例）黃廷曜','病假','2026/04/07','2026/04/09',3],
    [],...ft.map(e=>[e.name,'','','',''])
  ];
  const ws2=XLSX.utils.aoa_to_sheet(s2);
  ws2['!cols']=[{wch:10},{wch:8},{wch:12},{wch:12},{wch:8}];
  XLSX.utils.book_append_sheet(wb,ws2,'本月請假');

  // Sheet 3: 新進人員
  const s3=[
    ['人事調整記錄表 ─ 新進人員'],
    ['說明：填到職日期，薪資自動依剩餘天數比例計算（到職日起至月底）'],
    [],
    ['姓名','到職日期','備註'],
    ['（範例）王小明','2026/04/15','4/15到職，薪資×16/30'],
    []
  ];
  const ws3=XLSX.utils.aoa_to_sheet(s3);
  ws3['!cols']=[{wch:10},{wch:12},{wch:20}];
  XLSX.utils.book_append_sheet(wb,ws3,'新進人員');

  // Sheet 4: 離職人員
  const s4=[
    ['人事調整記錄表 ─ 離職人員'],
    ['說明：填最後上班日期，薪資自動依已工作天數比例計算（月初至離職日）'],
    [],
    ['姓名','最後上班日','備註'],
    ['（範例）陳小花','2026/04/20','4/20離職，薪資×20/30'],
    []
  ];
  const ws4=XLSX.utils.aoa_to_sheet(s4);
  ws4['!cols']=[{wch:10},{wch:12},{wch:20}];
  XLSX.utils.book_append_sheet(wb,ws4,'離職人員');

  // Sheet 5: 其他加扣項目
  const s5=[
    ['人事調整記錄表 ─ 其他加扣項目'],
    ['說明：正數=加計，負數=扣除'],
    [],
    ['姓名','項目說明','金額'],
    ['（範例）黃廷曜','代班費加計',500],
    ['（範例）陳顯耀','遲到扣款',-200],
    [],...ft.map(e=>[e.name,'',0])
  ];
  const ws5=XLSX.utils.aoa_to_sheet(s5);
  ws5['!cols']=[{wch:10},{wch:16},{wch:8}];
  XLSX.utils.book_append_sheet(wb,ws5,'其他加扣項目');

  const out=XLSX.write(wb,{bookType:'xlsx',type:'array'});
  const blob=new Blob([out],{type:'application/octet-stream'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download='人事調整記錄表範本.xlsx';
  document.body.appendChild(a);a.click();
  setTimeout(()=>{document.body.removeChild(a);URL.revokeObjectURL(url);},1000);
}
function calcResults(sDate,eDate,store,stdH,pf,adjMap,excludeMgmt,locFilter){excludeMgmt=excludeMgmt||false;locFilter=locFilter||'';
  const recs=ATT.records.filter(p=>p.date&&p.date>=sDate&&p.date<=eDate);
  const locR=LOC?LOC.filter(p=>p.date&&p.date>=sDate&&p.date<=eDate):[];
  const sr=store?recs.filter(p=>p.dept===store):recs;
  const sl=store?locR.filter(p=>sr.some(r=>r.id===p.id)):locR;
  const payMap=Object.fromEntries(PAY.map(p=>[p.id,p]));
  const punchIds=new Set(sr.map(p=>p.id));
  const payIds=new Set(PAY.filter(e=>e.type!=='未設定').map(p=>p.id));

  // Build rule map: 工號 → 出勤規則 from ALL ATT records (not just this period)
  // This ensures employees with no punches in this period still get correct 場別
  const ruleMap={};
  ATT.records.forEach(p=>{if(p.rule&&!ruleMap[p.id])ruleMap[p.id]=p.rule;});

  const hByE={},dByE={};
  sr.forEach(p=>{
    if(!hByE[p.id]){hByE[p.id]=0;dByE[p.id]={};}
    hByE[p.id]+=p.hours;
    dByE[p.id][p.dateStr]=(dByE[p.id][p.dateStr]||0)+p.hours;
  });

  const payF=store?PAY.filter(e=>e.dept===store||punchIds.has(e.id)):PAY;

  const results=payF.filter(e=>{
    if(e.type==='未設定')return false;
    if(excludeMgmt&&(e.dept.includes('總部')||e.dept.includes('執行長')||e.dept===''))return false;
    if(locFilter){
      const r=ruleMap[e.id]||'';
      const al=r.includes('內場')?'內場':(r?'外場':'');
      const l=e.titleLoc||al||'外場';
      if(l!==locFilter)return false;
    }
    return true;
  }).map(e=>{
    const totalH=hByE[e.id]||0,noPunch=!punchIds.has(e.id);
    const ins=calcIns(e);
    const eStd=effStd(e.id,stdH,adjMap); // final effective standard (adj > manual > default)

    if(e.type==='月薪正職'){
      const hr=ftOTbase(e)/FT_DIV;
      const otH=Math.max(0,totalH-eStd);
      const otPay=noPunch?null:ftOT(otH,hr);
      const extraAmt=ATT.extras?((ATT.extras[e.id]||0)):0;
      const gross=noPunch?null:e.fixedSalary+(otPay||0)+extraAmt;
      // Weekly estimates
      const weekStd=eStd*pf;           // proportional standard for this period
      const weekOtH=Math.max(0,totalH-weekStd);
      const weekOtPay=ftOT(weekOtH,hr);
      const pace=weekStd>0?totalH/weekStd:0; // hours ratio vs expected pace
      const propSal=e.fixedSalary*pf;
      const propIns=ins.total*pf;
      const rule=ruleMap[e.id]||'';
      const attLoc=rule.includes('內場')?'內場':(rule?'外場':'');
      const loc=e.titleLoc||attLoc||'外場'; // payroll 職稱 > ATT 出勤規則 > default
      const extraDetail=ATT.extrasDetail?ATT.extrasDetail[e.id]:null;
      return{...e,totalH,noPunch,eStd,hr,otH,otPay,gross,ins,rule,loc,extra:extraAmt,extraDetail,
             propSal,propIns,propFactor:pf,weekStd,weekOtH,weekOtPay,pace,
             ptDailyOt:0,b66:0,bH:0,rAddon:0};
    }else{
      // PT: calculate from ATT punch records
      const extraAmt2=ATT.extras?((ATT.extras[e.id]||0)):0;
      const{b66,rAddon,bH}=ptBonus(e.dept,totalH);
      const effRate=e.hourlyRate+rAddon;
      let base=0,dot=0;
      Object.values(dByE[e.id]||{}).forEach(dh=>{base+=dh*effRate;dot+=ptOTP(dh,effRate);});
      const gross=base+dot+b66+bH+extraAmt2;
      const projMonthH=pf>0&&pf<1?totalH/pf:totalH;
      const{b66:projB66,bH:projBH}=ptBonus(e.dept,projMonthH);
      const propIns=ins.total*pf;
      const pace=0; // PT doesn't have pace concept
      const rule2=ruleMap[e.id]||'';
      const attLoc2=rule2.includes('內場')?'內場':(rule2?'外場':'');
      const loc2=e.titleLoc||attLoc2||'外場'; // payroll 職稱 > ATT rule > default
      const extraDetail2=ATT.extrasDetail?ATT.extrasDetail[e.id]:null;
      return{...e,totalH,noPunch,eStd:0,hr:effRate,otH:0,otPay:dot,gross,ins,rule:rule2,loc:loc2,propFactor:pf,extra:extraAmt2,extraDetail:extraDetail2,
             propSal:gross,propIns,weekStd:0,weekOtH:0,weekOtPay:dot,pace,
             ptDailyOt:dot,b66,bH,rAddon,projBH,projB66};
    }
  });

  const anom=[];
  sr.filter(p=>p.crossMidnight).forEach(p=>
    anom.push({sev:'warn',type:'跨日打卡',id:p.id,name:p.name,date:p.dateStr,
      detail:`${p.inTime}→${p.outTime}，已計${p.hours.toFixed(2)}H`}));
  payIds.forEach(id=>{
    if(!punchIds.has(id)){const e=payMap[id];
      if(e&&e.type!=='未設定'&&(!store||e.dept===store))
        anom.push({sev:'error',type:'無出勤紀錄',id,name:e.name,date:'–',detail:'區間無出勤'});}
  });
  punchIds.forEach(id=>{
    if(!payMap[id]){const p=sr.find(x=>x.id===id);
      if(p)anom.push({sev:'info',type:'薪資未建檔',id,name:p.name,date:'–',
        detail:`有出勤(${(hByE[id]||0).toFixed(1)}H)`});}
  });
  // Filter locR to only employees in results (ensures 場別 filter syncs to location tabs)
  const resultIds=new Set(results.map(e=>e.id));
  const filteredLocR=sl.filter(p=>resultIds.has(p.id));
  return{results,anom,sr,locR:filteredLocR,isApollo:ATT.isApollo};
}

// ── File handling ─────────────────────────────────────────────────────────
function readFile(f){return new Promise((r,j)=>{const fr=new FileReader();fr.onload=e=>r(e.target.result);fr.onerror=j;fr.readAsArrayBuffer(f);});}
function markDone(pre,name){
  document.getElementById(pre+'z').classList.add('done');
  document.getElementById(pre+'ui').textContent='✅';
  document.getElementById(pre+'ul').textContent=name;
  document.getElementById(pre+'us').style.display='block';
}
function showLoad(v){document.getElementById('loading').style.display=v?'block':'none';}
function showErr(m){const b=document.getElementById('err');b.textContent=m;b.style.display='block';}
function hideErr(){document.getElementById('err').style.display='none';}

async function handleFile(f,type){
  showLoad(true);hideErr();
  try{
    const buf=await readFile(f);const wb=XLSX.read(buf,{type:'array'});
    if(type==='p'){PAY=parsePay(wb);markDone('p',f.name);}
    else if(type==='a'){
      ATT=parseAtt(wb);
      // Show diagnostic: how many records, date range, format detected
      const dates=ATT.records.filter(r=>r.date).map(r=>r.date).sort((a,b)=>a-b);
      const dMin=dates.length?`${dates[0].getFullYear()}/${dates[0].getMonth()+1}月`:'-';
      const dMax=dates.length?`${dates[dates.length-1].getFullYear()}/${dates[dates.length-1].getMonth()+1}月`:'-';
      const extCount=ATT.extras?Object.keys(ATT.extras).length:0;
      const extCnt=ATT.extras?Object.keys(ATT.extras).filter(k=>ATT.extras[k]!==0).length:0;
      const label=`${ATT.records.length}筆｜${dMin}~${dMax}｜${ATT.isApollo?'✅Apollo實際工時':'⚠️打卡計算工時'}${extCount?'｜📋加扣項'+extCount+'人':''}`; 
      markDone('a',label);
      fillStores();
    }
    else if(type==='l'){LOC=parseLoc(wb);markDone('l',f.name);}
    else if(type==='adj'){ADJ=parseAdj(wb);markDone('adj',f.name);
      document.getElementById('adjui').textContent='✅';
      const names=[...new Set(ADJ.map(r=>r.name))];
      document.getElementById('adjul').textContent=`請假記錄：${ADJ.length}筆（${names.length}人）`;}
    else if(type==='slip'){SLIP=parseSlip(wb);
      document.getElementById('slipz').classList.add('done');
      document.getElementById('slipui').textContent='✅';
      document.getElementById('slipul').textContent=`薪資明細：${Object.keys(SLIP).length}人`;
      document.getElementById('slipus').style.display='block';
      if(PAY&&ATT)renderM();}
    if(PAY&&ATT){renderW();renderM();}
  }catch(ex){showErr(type+'解析失敗：'+ex.message);}
  showLoad(false);
}
['pi','ai','li','adji','slipi'].forEach((id,i)=>{
  document.getElementById(id).addEventListener('change',e=>{
    if(e.target.files[0])handleFile(e.target.files[0],['p','a','l','adj','slip'][i]);
  });
});

function fillStores(){
  if(!ATT)return;
  const depts=[...new Set(ATT.records.map(r=>r.dept).filter(Boolean))].sort();
  ['wsf','msf'].forEach(id=>{
    const sel=document.getElementById(id),cur=sel.value;
    sel.innerHTML='<option value="">全部門市</option>';
    depts.forEach(d=>{const o=document.createElement('option');o.value=d;o.textContent=d;if(d===cur)o.selected=true;sel.appendChild(o);});
  });
}

// ── View switch ───────────────────────────────────────────────────────────
let CV='w';
function switchView(v){
  CV=v;
  document.getElementById('vw').classList.toggle('hidden',v!=='w');
  document.getElementById('vm').classList.toggle('hidden',v!=='m');
  document.getElementById('nav-w').className=v==='w'?'aw':'';
  document.getElementById('nav-m').className=v==='m'?'am':'';
}

// ── Date helpers ──────────────────────────────────────────────────────────
function setWeek(off){
  const t=new Date(),dow=t.getDay(),mon=new Date(t);
  mon.setDate(t.getDate()-(dow===0?6:dow-1)+off*7);
  const thu=new Date(mon);thu.setDate(mon.getDate()+3);
  document.getElementById('ws').value=fD(mon);document.getElementById('we').value=fD(thu);renderW();
}
function setMonth(off){
  const t=new Date(),y=t.getFullYear(),m=t.getMonth()+off;
  document.getElementById('ms').value=fD(new Date(y,m,1));document.getElementById('me').value=fD(new Date(y,m+1,0));renderM();
}
function setMD(s,e){document.getElementById('ms').value=s;document.getElementById('me').value=e;renderM();}
(()=>{setWeek(0);const t=new Date();document.getElementById('ms').value=fD(new Date(t.getFullYear(),t.getMonth(),1));document.getElementById('me').value=fD(new Date(t.getFullYear(),t.getMonth()+1,0));})();
['ws','we'].forEach(id=>document.getElementById(id).addEventListener('change',renderW));
['ms','me'].forEach(id=>document.getElementById(id).addEventListener('change',renderM));

// ── Tabs helper ───────────────────────────────────────────────────────────
function renderTabs(cid,cur,list,onClick){
  const el=document.getElementById(cid);el.innerHTML='';
  list.forEach(t=>{
    const b=document.createElement('button');
    b.className='tab-btn'+(cur===t?' on':'');b.textContent=t;b.onclick=()=>onClick(t);el.appendChild(b);
  });
}

// ── Anomaly render ────────────────────────────────────────────────────────
function renderAnom(lid,nid,cid,anom){
  const card=document.getElementById(cid);
  if(!anom||!anom.length){card.style.display='none';return;}
  card.style.display='block';document.getElementById(nid).textContent=`${anom.length}筆`;
  document.getElementById(lid).innerHTML=anom.map(a=>`
    <div class="arow ${a.sev}">
      <span class="at ${a.sev}">${a.type}</span><span class="adim">${a.id}</span>
      <span class="aname">${a.name}</span><span class="adim">${a.detail}</span>
      <span class="adim">${a.date}</span></div>`).join('');
}

// ── Location table ────────────────────────────────────────────────────────
function renderLoc(locR,tw){
  if(!LOC||!locR||!locR.length){tw.innerHTML='<div style="padding:20px;text-align:center;color:#888">請上傳打卡地點檔案</div>';return;}
  const sum={};
  locR.forEach(p=>{
    if(!sum[p.id])sum[p.id]={id:p.id,name:p.name,locs:{}};
    const l=p.inLoc||'未知';
    if(!sum[p.id].locs[l])sum[p.id].locs[l]={l,n:0,isO:l.startsWith('其他')};
    sum[p.id].locs[l].n++;
  });
  const rows=Object.values(sum).map(e=>{
    const tags=Object.values(e.locs).sort((a,b)=>b.n-a.n).map(l=>
      `<span style="background:${l.isO?'#FFF8E1':'#f0f0ee'};color:${l.isO?'#412402':'#444'};padding:2px 7px;border-radius:4px;margin:2px;display:inline-block;font-size:10px">${l.l}×${l.n}</span>`
    ).join('');
    return`<tr><td class="l" style="color:#888;font-size:10px">${e.id}</td><td class="l" style="font-weight:600">${e.name}</td><td class="l">${tags}</td></tr>`;
  }).join('');
  tw.innerHTML=`<table><thead><tr><th class="l">工號</th><th class="l">姓名</th><th class="l">打卡地點</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function setOvr(id,val){const v=parseFloat(val);if(!isNaN(v)&&v>0)OVR[id]=v;else delete OVR[id];renderW();renderM();}



// ── Map punch location name to store category ─────────────────────────────
function mapLocToStore(locName){
  if(!locName)return'其他';
  const l=locName.replace(/\s/g,'');
  if(l.includes('品牌')&&l.includes('概念'))return'品牌概念店';
  if(l.includes('仁愛'))return'品牌概念店';
  if(l.includes('台北')||l.includes('1')||l.includes('2號')||l.includes('二號')||l.includes('1&2')||l.includes('2号'))return'料韓男2號店';
  if(l.includes('3號')||l.includes('三號')||l.includes('3号'))return'料韓男3號店';
  if(l.includes('英洙'))return'英洙家';
  return'其他';
}
const STORE_CATS=['品牌概念店','料韓男2號店','料韓男3號店','英洙家','其他'];

// ── Store location summary table ───────────────────────────────────────────
function renderStoreLoc(results,locR,tw){
  if(!locR||!locR.length){
    tw.innerHTML='<div style="padding:20px;text-align:center;color:#888;font-size:13px">請上傳打卡地點檔案以顯示分店彙整</div>';
    return;
  }

  // 1. Build employee period cost map (cost per hour of period)
  // FT: period cost = propSal + weekOtPay + propIns (not full month gross!)
  // PT: period cost = propSal + propIns (propSal already includes OT)
  const empMap={};
  results.forEach(e=>{
    const totalH=e.totalH||0;
    if(totalH<=0)return;
    const periodCost=e.type==='月薪正職'
      ?(e.propSal||0)+(e.weekOtPay||0)+(e.propIns||0)
      :(e.propSal||0)+(e.propIns||0);
    empMap[e.id]={costPerH:periodCost/totalH,periodCost,totalH};
  });

  // 2. Tally hours per employee per store-category + track 內/外場
  const catH={}; // storecat → empId → hours
  const catLocH={}; // storecat → {inner:H, outer:H} for 內外場 breakdown
  STORE_CATS.forEach(c=>{catH[c]={};catLocH[c]={inner:0,outer:0};});
  const punchedIds=new Set(); // employees who have locR records
  locR.forEach(p=>{
    const h=p.hours||0;if(h<=0)return;
    punchedIds.add(p.id);
    const emp=results.find(e=>e.id===p.id);
    const isInner=emp&&emp.loc==='內場';
    const addH=(cat,eid,hrs)=>{
      catH[cat][eid]=(catH[cat][eid]||0)+hrs;
      if(isInner)catLocH[cat].inner+=hrs;else catLocH[cat].outer+=hrs;
    };
    if(p.cross){
      const c1=mapLocToStore(p.inLoc),c2=mapLocToStore(p.outLoc);
      addH(c1,p.id,h/2);addH(c2,p.id,h/2);
    }else{
      addH(mapLocToStore(p.inLoc),p.id,h);
    }
  });
  // Employees WITHOUT locR data: assign 1 token hour to their home store dept
  // This ensures their cost is included in the distribution
  results.forEach(e=>{
    if(punchedIds.has(e.id)||e.totalH<=0)return;
    const homeCat=mapLocToStore(e.dept)||'其他';
    const isInner=e.loc==='內場';
    catH[homeCat][e.id]=(catH[homeCat][e.id]||0)+1; // token 1H
    if(isInner)catLocH[homeCat].inner+=1;else catLocH[homeCat].outer+=1;
  });
  // Build per-employee total LOC hours (for proportion-based cost allocation)
  const empLocTotal={}; // empId → total LOC hours across all stores
  STORE_CATS.forEach(cat=>Object.entries(catH[cat]).forEach(([eid,h])=>{empLocTotal[eid]=(empLocTotal[eid]||0)+h;}));

  // 3. Compute cost per store-category (proportion-based to avoid LOC vs ATT hour mismatch)
  const rows=STORE_CATS.map(cat=>{
    const empHours=catH[cat];
    let totalH=0,totalCost=0,ft=new Set(),pt=new Set();
    Object.entries(empHours).forEach(([eid,h])=>{
      totalH+=h;
      const emp=results.find(e=>e.id===eid);
      if(emp){
        if(emp.type==='月薪正職')ft.add(eid);else pt.add(eid);
        const c=empMap[eid];
        const empTotH=empLocTotal[eid]||0;
        // Use proportion: this store's LOC hours / employee's total LOC hours × period cost
        if(c&&empTotH>0)totalCost+=c.periodCost*(h/empTotH);
      }
    });
    if(totalH<=0)return null;
    const lh=catLocH[cat];
    return{cat,totalH,totalCost:Math.round(totalCost),ft:ft.size,pt:pt.size,
           innerH:lh.inner,outerH:lh.outer};
  }).filter(Boolean);

  const grandH=rows.reduce((s,r)=>s+r.totalH,0);
  const grandC=rows.reduce((s,r)=>s+r.totalCost,0);

  const tableRows=rows.map(r=>`<tr>
    <td class="l" style="font-weight:600">${r.cat}</td>
    <td>${r.totalH.toFixed(1)}H</td>
    <td>${(grandH>0?r.totalH/grandH*100:0).toFixed(1)}%</td>
    <td style="color:#185FA5">${r.innerH>0?r.innerH.toFixed(1)+'H':'–'}</td>
    <td>${r.innerH>0&&r.totalH>0?(r.innerH/r.totalH*100).toFixed(0)+'%':'–'}</td>
    <td style="color:#3B6D11">${r.outerH>0?r.outerH.toFixed(1)+'H':'–'}</td>
    <td>${r.outerH>0&&r.totalH>0?(r.outerH/r.totalH*100).toFixed(0)+'%':'–'}</td>
    <td>${r.ft}人</td><td>${r.pt}人</td>
    <td style="font-weight:600;color:#185FA5">${fT(r.totalCost)}</td>
    <td>${(grandC>0?r.totalCost/grandC*100:0).toFixed(1)}%</td>
  </tr>`).join('');

  tw.innerHTML=`
    <div style="font-size:11px;color:#888;margin-bottom:8px">
      依打卡地點自動分類。無打卡地點資料的員工，依薪資表門市歸入對應分店。<b>分攤人事成本</b>合計應等於期間人事成本。
    </div>
    <table>
    <thead><tr>
      <th class="l">分店</th><th>打卡時數</th><th>時數佔比</th>
      <th style="color:#185FA5">內場時數</th><th style="color:#185FA5">內場%</th>
      <th style="color:#3B6D11">外場時數</th><th style="color:#3B6D11">外場%</th>
      <th>正職人數</th><th>工讀人數</th>
      <th>分攤人事成本</th><th>成本佔比</th>
    </tr></thead>
    <tbody>${tableRows}</tbody>
    <tfoot><tr>
      <td class="l">合計</td>
      <td>${grandH.toFixed(1)}H</td><td>100%</td>
      <td style="color:#185FA5">${rows.reduce((s,r)=>s+r.innerH,0).toFixed(1)}H</td>
      <td style="color:#185FA5">${grandH>0?(rows.reduce((s,r)=>s+r.innerH,0)/grandH*100).toFixed(0)+'%':'–'}</td>
      <td style="color:#3B6D11">${rows.reduce((s,r)=>s+r.outerH,0).toFixed(1)}H</td>
      <td style="color:#3B6D11">${grandH>0?(rows.reduce((s,r)=>s+r.outerH,0)/grandH*100).toFixed(0)+'%':'–'}</td>
      <td>–</td><td>–</td>
      <td style="font-weight:600">${fT(grandC)}</td><td>100%</td>
    </tr></tfoot></table>`;
}

// ── Store summary table ───────────────────────────────────────────────────
// isWeekly=true → use period-proportional values; false → use monthly actuals
function renderStoreSum(results,tw,isWeekly){
  const stores={};
  results.forEach(e=>{
    const dept=e.dept||'未知';
    if(!stores[dept])stores[dept]={dept,ft:0,pt:0,sal:0,ot:0,sp:0,gross:0,pen:0,lb:0,hb:0,ins:0,cost:0};
    const s=stores[dept];
    // Period-appropriate values
    const sal  = isWeekly ? (e.propSal||0)                    : (e.fixedSalary||0);
    const ot   = isWeekly ? (e.type==='月薪正職'?e.weekOtPay:(e.otPay||0)) : (e.type==='月薪正職'?(e.otPay||0):(e.ptDailyOt||0));
    const sp   = (e.b66||0)+(e.bH||0);
    const ins  = isWeekly ? (e.propIns||0)                    : (e.ins?e.ins.total:0);
    const pen  = isWeekly ? (e.ins?e.ins.pen*(e.propFactor||1):0) : (e.ins?e.ins.pen:0);
    const lb   = isWeekly ? (e.ins?e.ins.lb*(e.propFactor||1):0)  : (e.ins?e.ins.lb:0);
    const hb   = isWeekly ? (e.ins?e.ins.hb*(e.propFactor||1):0)  : (e.ins?e.ins.hb:0);
    const cost = sal + (e.type==='月薪正職'?ot:0) + ins;  // PT ot already in sal

    if(e.type==='月薪正職'){s.ft++;s.ot+=ot;}
    else{s.pt++;s.sp+=sp;}
    s.sal+=sal; s.gross+=(isWeekly?sal+(e.type==='月薪正職'?ot:0):(!e.noPunch?e.gross||0:0));
    s.pen+=pen; s.lb+=lb; s.hb+=hb; s.ins+=ins; s.cost+=cost;
  });
  const rows=Object.values(stores).sort((a,b)=>b.cost-a.cost).map(s=>`
    <tr>
      <td class="l" style="font-weight:600">${s.dept}</td>
      <td>${s.ft}人</td><td>${s.pt}人</td>
      <td>${isWeekly?'<span class="est">~':''}${fT(s.sal)}${isWeekly?'</span>':''}</td>
      <td class="ov">${s.ot>0?(isWeekly?'<span class="est">~':'')+(fT(s.ot))+(isWeekly?'</span>':''):'–'}</td>
      <td class="gv">${s.sp>0?fT(s.sp):'–'}</td>
      <td style="font-weight:600">${isWeekly?'<span class="est">~':''}${fT(s.gross)}${isWeekly?'</span>':''}</td>
      <td class="ins">${isWeekly?'<span class="est">~':''}${fT(Math.round(s.pen))}${isWeekly?'</span>':''}</td>
      <td class="ins">${isWeekly?'<span class="est">~':''}${fT(Math.round(s.lb))}${isWeekly?'</span>':''}</td>
      <td class="ins">${isWeekly?'<span class="est">~':''}${fT(Math.round(s.hb))}${isWeekly?'</span>':''}</td>
      <td style="font-weight:600;color:#185FA5">${isWeekly?'<span class="est">~':''}${fT(Math.round(s.cost))}${isWeekly?'</span>':''}</td>
    </tr>`).join('');
  const tot=Object.values(stores).reduce((a,s)=>({gross:a.gross+s.gross,ins:a.ins+s.ins,cost:a.cost+s.cost}),{gross:0,ins:0,cost:0});
  tw.innerHTML=`
    <div style="font-size:11px;color:#888;margin-bottom:8px">${isWeekly?'⚠ 橘色斜體 = 比例估算值（月薪×天數比例）':'月報完整計算'}</div>
    <table>
    <thead><tr>
      <th class="l">門市</th><th>正職</th><th>工讀</th>
      <th>${isWeekly?'期間薪資':'薪資基礎'}</th><th>加班費</th><th>特殊加給</th>
      <th>${isWeekly?'期間應發':'應發合計'}</th>
      <th class="ins">勞退</th><th class="ins">勞保</th><th class="ins">健保</th>
      <th>${isWeekly?'期間人事成本':'人事成本'}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr>
      <td class="l" style="font-weight:600">合計</td>
      <td colspan="5">–</td>
      <td>${isWeekly?'<span class="est">~':''}${fT(Math.round(tot.gross))}${isWeekly?'</span>':''}</td>
      <td colspan="3">–</td>
      <td style="font-weight:600">${isWeekly?'<span class="est">~':''}${fT(Math.round(tot.cost))}${isWeekly?'</span>':''}</td>
    </tr></tfoot></table>`;
}

// ── Exports ─────────────────────────────────────────────────────────────────
export {
  parsePay, parseAtt, parseLoc, parseAdj,
  calcResults, adjDeltaForMonth, effStd,
  ptBonus, ptOTP, ftOT, ftOTbase, calcIns,
  fT, fN, fH, pd, pMin, pMinFlex, rawH, parseAttDate,
  R, FT_DIV
};
