'use strict';

const $ = (s) => document.querySelector(s);
let rows = [];
let analyzed = [];
let sourceMeta = {name:'none', updated:null, warnings:[]};

const FIELD_ALIASES = {
  ticker:['ticker','symbol'],
  price:['price','last','lastprice','close'],
  changePct:['change','changepct','changepercent','perfday','percentchange'],
  volume:['volume','vol'],
  avgVolume:['avgvolume','averagevolume','avgvol','avgvolume3m','averagevol'],
  float:['float','sharesfloat','sharessfloat','floatshares'],
  pmChange:['premarketchange','premktchange','pmchange','premarketpercent'],
  pmVolume:['premarketvolume','premktvolume','pmvolume'],
  ahChange:['afterhourschange','postmarketchange','ahchange','postmarketpercent'],
  ahVolume:['afterhoursvolume','postmarketvolume','ahvolume'],
  prevClose:['prevclose','previousclose','priorclose','closeprev','previousdayclose'],
  prevVolume:['prevvolume','previousvolume','priorvolume','previousdayvolume'],
  prevHigh:['prevhigh','previoushigh','priorhigh'],
  prevLow:['prevlow','previouslow','priorlow'],
  high:['high','dayhigh'],
  low:['low','daylow'],
  open:['open','dayopen'],
  catalystAgeHours:['catalystagehours','newsagehours'],
  spreadPct:['spreadpct','spreadpercent','spread'],
  sharia:['sharia','shariastatus']
};

function keyify(v){ return String(v||'').toLowerCase().replace(/[^a-z0-9]/g,''); }
function rawPick(obj, aliases){
  if(!obj || typeof obj !== 'object') return null;
  const map = new Map(Object.keys(obj).map(k => [keyify(k), obj[k]]));
  for(const a of aliases) if(map.has(a)) return map.get(a);
  return null;
}
function num(v){
  if(v === null || v === undefined || v === '') return null;
  if(typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if(!s || /^(n\/a|na|null|undefined|—|-)$/i.test(s)) return null;
  const neg = /^\(.*\)$/.test(s);
  s = s.replace(/[()$,%\s]/g,'');
  const m = s.match(/^(-?[\d.]+)([KMBT])?$/i);
  if(!m) return null;
  const mult={K:1e3,M:1e6,B:1e9,T:1e12};
  let out = Number(m[1]) * (mult[(m[2]||'').toUpperCase()] || 1);
  if(neg) out = -Math.abs(out);
  return Number.isFinite(out) ? out : null;
}
function clamp(v,a=0,b=100){ return Math.max(a,Math.min(b,v)); }
function fmt(v,d=2){ return Number.isFinite(v) ? v.toFixed(d) : '—'; }
function fmtPct(v,d=1){ return Number.isFinite(v) ? `${v>=0?'+':''}${v.toFixed(d)}%` : '—'; }
function fmtVol(v){
  if(!Number.isFinite(v)) return '—';
  if(v>=1e9) return (v/1e9).toFixed(2)+'B';
  if(v>=1e6) return (v/1e6).toFixed(2)+'M';
  if(v>=1e3) return (v/1e3).toFixed(1)+'K';
  return String(Math.round(v));
}
function esc(s){ return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

function recordsFromPayload(payload){
  if(Array.isArray(payload)) return payload;
  if(!payload || typeof payload !== 'object') return [];
  for(const k of ['data','results','stocks','rows','items','records','screener']) if(Array.isArray(payload[k])) return payload[k];
  const vals = Object.values(payload);
  const objectVals = vals.filter(v => v && typeof v === 'object' && !Array.isArray(v));
  if(objectVals.length && objectVals.every(v => rawPick(v, FIELD_ALIASES.ticker))) return objectVals;
  return [];
}

function normalizeRecord(o){
  const ticker = String(rawPick(o,FIELD_ALIASES.ticker)||'').trim().toUpperCase();
  if(!ticker) return null;
  const out={ticker, raw:o};
  for(const [k,a] of Object.entries(FIELD_ALIASES)){
    if(k==='ticker') continue;
    const v=rawPick(o,a);
    out[k]=k==='sharia' ? (v?String(v).toUpperCase():'UNVERIFIED') : num(v);
  }
  if(!['VERIFIED','UNVERIFIED','EXCLUDED'].includes(out.sharia)) out.sharia='UNVERIFIED';
  if(out.prevClose===null && Number.isFinite(out.price) && Number.isFinite(out.changePct) && out.changePct>-99.9){
    out.prevClose = out.price/(1+out.changePct/100);
    out.prevCloseDerived = true;
  }
  return out;
}

function applyHistoricalContext(baseRows, snapshotPayload){
  const recs = recordsFromPayload(snapshotPayload);
  if(!recs.length) return baseRows;
  const groups = new Map();
  for(const r of recs){
    const t=String(rawPick(r,FIELD_ALIASES.ticker)||'').toUpperCase();
    if(!t) continue;
    const ts = Date.parse(r.timestamp||r.updatedAt||r.asOf||r.date||r.datetime||'');
    if(!groups.has(t)) groups.set(t,[]);
    groups.get(t).push({r,ts:Number.isFinite(ts)?ts:0});
  }
  for(const x of baseRows){
    const g=(groups.get(x.ticker)||[]).sort((a,b)=>b.ts-a.ts);
    if(g.length<2) continue;
    const prev=g[1].r;
    const prevPrice=num(rawPick(prev,FIELD_ALIASES.price));
    const prevVol=num(rawPick(prev,FIELD_ALIASES.volume));
    if(x.prevClose===null && prevPrice!==null){x.prevClose=prevPrice; x.prevCloseDerived=true;}
    if(x.prevVolume===null && prevVol!==null){x.prevVolume=prevVol; x.prevVolumeDerived=true;}
  }
  return baseRows;
}

function duplicateFieldAudit(data){
  const fields=['price','changePct','volume','avgVolume','float','pmChange','pmVolume','ahChange','ahVolume','prevClose','prevVolume','spreadPct','catalystAgeHours'];
  const suspect=[];
  for(const f of fields){
    const vals=data.map(x=>x[f]).filter(Number.isFinite);
    if(vals.length<10) continue;
    const counts=new Map();
    for(const v of vals){
      const k=Math.abs(v)>=1000 ? String(Math.round(v)) : Number(v).toFixed(4);
      counts.set(k,(counts.get(k)||0)+1);
    }
    const max=Math.max(...counts.values());
    if(max/vals.length>=0.8 && counts.size<=3) suspect.push(f);
  }
  for(const f of suspect) for(const x of data) x[f]=null;
  return suspect;
}

function weighted(parts){
  let w=0,s=0,n=0;
  for(const [v,weight] of parts){
    if(Number.isFinite(v)){s+=v*weight; w+=weight; n++;}
  }
  return {value:w?s/w:null,count:n};
}

function analyze(x){
  const reasons=[], missing=[];
  const rvol = Number.isFinite(x.volume) && Number.isFinite(x.avgVolume) && x.avgVolume>0 ? x.volume/x.avgVolume : null;
  const prevVolRatio = Number.isFinite(x.volume) && Number.isFinite(x.prevVolume) && x.prevVolume>0 ? x.volume/x.prevVolume : null;
  const turnover = Number.isFinite(x.volume) && Number.isFinite(x.float) && x.float>0 ? x.volume/x.float : null;
  const prevRangePct = Number.isFinite(x.prevHigh)&&Number.isFinite(x.prevLow)&&Number.isFinite(x.prevClose)&&x.prevClose>0 ? (x.prevHigh-x.prevLow)/x.prevClose*100 : null;
  const gapPct = Number.isFinite(x.price)&&Number.isFinite(x.prevClose)&&x.prevClose>0 ? (x.price-x.prevClose)/x.prevClose*100 : x.changePct;
  const extVals=[x.pmChange,x.ahChange].filter(Number.isFinite);
  const extended=extVals.length?Math.max(...extVals.map(Math.abs)):null;

  const liquidity = Number.isFinite(rvol) ? clamp(Math.log2(1+rvol)*17) : Number.isFinite(prevVolRatio) ? clamp(Math.log2(1+prevVolRatio)*15) : null;
  const turnoverScore = Number.isFinite(turnover) ? clamp(Math.log2(1+turnover)*24) : null;
  const extScore = Number.isFinite(extended) ? clamp(extended*1.15) : null;
  const spreadQuality = Number.isFinite(x.spreadPct) ? clamp(100-x.spreadPct*18) : null;
  const catalyst = Number.isFinite(x.catalystAgeHours) ? (x.catalystAgeHours<=24?88:x.catalystAgeHours<=72?55:25) : null;
  const priorSetup = Number.isFinite(prevRangePct) ? clamp(prevRangePct*5) : null;

  const earlyW=weighted([[liquidity,.30],[turnoverScore,.22],[extScore,.20],[spreadQuality,.10],[catalyst,.10],[priorSetup,.08]]);
  let early=earlyW.value;
  const changeSignal=Number.isFinite(x.changePct)?clamp(Math.max(0,x.changePct)*1.25):null;
  const ignitionW=weighted([[early,.55],[changeSignal,.25],[liquidity,.20]]);
  let ignition=ignitionW.value;
  const ahPos=Number.isFinite(x.ahChange)?clamp(Math.max(0,x.ahChange)*1.2):null;
  const continuationW=weighted([[ahPos,.35],[liquidity,.25],[spreadQuality,.15],[priorSetup,.10],[catalyst,.15]]);
  let continuation=continuationW.value;
  const exhaustionW=weighted([
    [Number.isFinite(x.changePct)?clamp(Math.max(0,x.changePct-35)*1.2):null,.45],
    [Number.isFinite(turnover)?clamp(turnover*18):null,.20],
    [Number.isFinite(x.ahChange)?clamp(Math.max(0,-x.ahChange)*3):null,.20],
    [Number.isFinite(rvol)&&rvol>12?70:null,.15]
  ]);
  let exhaustion=exhaustionW.value;

  const dynamicInputs=[rvol,turnover,extended,x.changePct,x.prevClose,x.prevVolume].filter(Number.isFinite).length;
  const qualityFields=['price','volume','changePct','avgVolume','float','prevClose','prevVolume','pmChange','ahChange'];
  const present=qualityFields.filter(k=>Number.isFinite(x[k])).length;
  const quality=Math.round(present/qualityFields.length*100);

  if(Number.isFinite(x.changePct)&&x.changePct>80&&Number.isFinite(early)) early=clamp(early-18);
  if(Number.isFinite(x.ahChange)&&x.ahChange<0&&Number.isFinite(x.changePct)&&x.changePct>50){
    if(Number.isFinite(continuation)) continuation=clamp(continuation-25);
    if(Number.isFinite(exhaustion)) exhaustion=clamp(exhaustion+18);
  }

  const scoreW=weighted([[early,.50],[continuation,.22],[ignition,.20],[Number.isFinite(exhaustion)?100-exhaustion:null,.08]]);
  let score=scoreW.value;
  let valid = dynamicInputs>=3 && present>=4 && scoreW.count>=3;
  if(x.sharia==='EXCLUDED'){ valid=false; score=null; reasons.push('مستبعد شرعيًا'); }

  if(Number.isFinite(rvol)&&rvol>=2) reasons.push(`RVOL ${rvol.toFixed(1)}×`);
  if(Number.isFinite(prevVolRatio)&&prevVolRatio>=2) reasons.push(`الحجم/أمس ${prevVolRatio.toFixed(1)}×`);
  if(Number.isFinite(turnover)&&turnover>=.5) reasons.push(`دوران الفلوت ${turnover.toFixed(1)}×`);
  if(Number.isFinite(x.pmChange)&&Math.abs(x.pmChange)>=8) reasons.push(`PM ${fmtPct(x.pmChange)}`);
  if(Number.isFinite(x.ahChange)&&Math.abs(x.ahChange)>=8) reasons.push(`AH ${fmtPct(x.ahChange)}`);
  if(Number.isFinite(gapPct)&&Math.abs(gapPct)>=8) reasons.push(`مقابل إغلاق أمس ${fmtPct(gapPct)}`);
  if(x.prevCloseDerived) reasons.push('إغلاق أمس مشتق');
  if(!valid) reasons.unshift('بيانات غير كافية للتقييم');

  for(const k of qualityFields) if(!Number.isFinite(x[k])) missing.push(k);

  let stage='DATA_INSUFFICIENT';
  if(valid){
    if(Number.isFinite(exhaustion)&&exhaustion>76) stage='EXHAUSTION';
    else if(Number.isFinite(x.changePct)&&x.changePct>35) stage='LATE';
    else if(Number.isFinite(ignition)&&ignition>62) stage='IGNITION';
    else stage='DISCOVERY';
  }

  return {...x,rvol,prevVolRatio,turnover,prevRangePct,gapPct,early,ignition,continuation,exhaustion,score,stage,valid,quality,reasons,missing};
}

function integritySummary(data,suspect){
  const valid=data.filter(x=>x.valid).length;
  const prev=data.filter(x=>Number.isFinite(x.prevClose)||Number.isFinite(x.prevVolume)).length;
  const items=[
    `<div class="log-item">${esc(sourceMeta.name)} · ${data.length} سهم · ${new Date().toLocaleString('ar-SA')}</div>`,
    `<div class="log-item">${valid} سهم صالح للتقييم · ${prev} سهم لديه سياق جلسة سابقة</div>`
  ];
  if(suspect.length) items.push(`<div class="log-item warn">تم تعطيل حقول مكررة/مشبوهة: ${suspect.map(esc).join('، ')}</div>`);
  if(!valid) items.push('<div class="log-item warn">DATA FAILURE: لا توجد بيانات كافية لإصدار تقييم موثوق. لن تُعرض فرص وهمية.</div>');
  return items.join('');
}

function render(){
  analyzed=rows.map(analyze);
  const q=($('#search')?.value||'').trim().toUpperCase();
  const sf=$('#stageFilter')?.value||'all';
  const sh=$('#shariaFilter')?.value||'all';
  const out=analyzed.filter(x=>(!q||x.ticker.includes(q))&&(sf==='all'||x.stage===sf)&&(sh==='all'||x.sharia===sh))
    .sort((a,b)=>(b.valid-a.valid)||((b.score??-1)-(a.score??-1)));

  $('#scannerBody').innerHTML=out.map(x=>`
    <tr data-ticker="${esc(x.ticker)}">
      <td class="ticker">${esc(x.ticker)}</td>
      <td>${Number.isFinite(x.price)?'$'+fmt(x.price,x.price<1?3:2):'—'}</td>
      <td class="${(x.changePct??0)>=0?'pos':'neg'}">${fmtPct(x.changePct)}</td>
      <td class="score">${x.valid?fmt(x.score,0):'—'}</td>
      <td><span class="pill">${esc(x.stage)}</span></td>
      <td>${Number.isFinite(x.prevClose)?'$'+fmt(x.prevClose,x.prevClose<1?3:2):'—'}</td>
      <td>${fmtVol(x.prevVolume)}</td>
      <td>${Number.isFinite(x.rvol)?x.rvol.toFixed(1)+'×':'—'}</td>
      <td>${Number.isFinite(x.turnover)?x.turnover.toFixed(2)+'×':'—'}</td>
      <td>${x.quality}%</td>
      <td><span class="pill">${esc(x.sharia)}</span></td>
    </tr>`).join('') || '<tr><td colspan="11">لا توجد نتائج مطابقة.</td></tr>';

  const valid=analyzed.filter(x=>x.valid);
  const early=valid.filter(x=>x.stage==='DISCOVERY'||x.stage==='IGNITION').length;
  const hot=valid.filter(x=>x.score>=60).length;
  $('#summaryCards').innerHTML=`
    <div class="metric"><small>Universe</small><strong>${rows.length}</strong></div>
    <div class="metric"><small>Valid data</small><strong>${valid.length}</strong></div>
    <div class="metric"><small>Early candidates</small><strong>${early}</strong></div>
    <div class="metric"><small>TAG ≥ 60</small><strong>${hot}</strong></div>`;

  const top=valid.sort((a,b)=>b.score-a.score)[0];
  $('#topOpportunity').innerHTML=top?`
    <div class="result-top"><div class="top-ticker">${esc(top.ticker)}</div><div class="top-score">${fmt(top.score,0)}</div></div>
    <div class="top-meta">${fmtPct(top.changePct)} · جودة البيانات ${top.quality}%</div>
    <div class="top-reasons">${top.reasons.map(esc).join(' · ')||'لا توجد إشارة نوعية واضحة'}</div>
    <div class="top-reasons">إغلاق أمس ${Number.isFinite(top.prevClose)?'$'+fmt(top.prevClose,2):'—'} · حجم أمس ${fmtVol(top.prevVolume)} · RVOL ${Number.isFinite(top.rvol)?top.rvol.toFixed(1)+'×':'—'}</div>`
    :'<div class="log-item warn">لا توجد فرصة صالحة لأن جودة البيانات الحالية لا تكفي للتقييم.</div>';

  const avgMetric=k=>{
    const a=valid.map(x=>x[k]).filter(Number.isFinite);
    return a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
  };
  $('#radar').innerHTML=['early','ignition','continuation','exhaustion'].map(k=>{
    const v=avgMetric(k); return `<div class="gauge"><strong>${Number.isFinite(v)?v.toFixed(0):'—'}</strong><small>${k}</small></div>`;
  }).join('');
  const stages=['DISCOVERY','IGNITION','LATE','EXHAUSTION','DATA_INSUFFICIENT'];
  $('#stageChart').innerHTML=stages.map(k=>`<div class="stage-row"><span>${k}</span><b>${analyzed.filter(x=>x.stage===k).length}</b></div>`).join('');
}

function showAnalysis(ticker){
  const x=analyzed.find(r=>r.ticker===ticker);
  if(!x) return;
  $('#analysisResult').classList.remove('empty');
  $('#analysisResult').innerHTML=`
    <div class="result-top"><div class="ticker">${esc(x.ticker)}</div><div class="big-score">${x.valid?fmt(x.score,0):'—'}</div></div>
    <p><strong>حالة البيانات:</strong> ${x.valid?'صالحة للتقييم':'غير كافية — لا يوجد تقييم'}</p>
    <p><strong>الجلسة السابقة:</strong> إغلاق ${Number.isFinite(x.prevClose)?'$'+fmt(x.prevClose,3):'—'} · حجم ${fmtVol(x.prevVolume)} · أعلى ${fmt(x.prevHigh,3)} · أدنى ${fmt(x.prevLow,3)}</p>
    <p><strong>الحالية:</strong> السعر ${Number.isFinite(x.price)?'$'+fmt(x.price,3):'—'} · التغير ${fmtPct(x.changePct)} · الحجم ${fmtVol(x.volume)} · RVOL ${Number.isFinite(x.rvol)?x.rvol.toFixed(2)+'×':'—'}</p>
    <p><strong>قبل/بعد:</strong> PM ${fmtPct(x.pmChange)} · PM Vol ${fmtVol(x.pmVolume)} · AH ${fmtPct(x.ahChange)} · AH Vol ${fmtVol(x.ahVolume)}</p>
    <p>${x.reasons.map(esc).join(' · ')}</p>
    <small>جودة البيانات ${x.quality}% · الحقول الناقصة: ${x.missing.map(esc).join('، ')||'لا يوجد'}</small>`;
}

async function fetchJSON(path){
  const r=await fetch(`${path}?v=${Date.now()}`,{cache:'no-store'});
  if(!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

async function loadData(){
  const status=$('#finvizStatus');
  status.textContent='جاري جلب البيانات والتحقق من سلامتها…';
  try{
    const primary=await fetchJSON('./data/finviz.json');
    let base=recordsFromPayload(primary).map(normalizeRecord).filter(Boolean);
    if(!base.length) throw new Error('finviz.json لا يحتوي سجلات أسهم قابلة للقراءة');

    try{
      const hist=await fetchJSON('./data/snapshots.json');
      base=applyHistoricalContext(base,hist);
    }catch(e){ sourceMeta.warnings.push('تعذر تحميل snapshots'); }

    const suspect=duplicateFieldAudit(base);
    rows=base;
    sourceMeta={name:'GitHub market dataset',updated:new Date(),warnings:sourceMeta.warnings};
    $('#dataBadge').textContent='● البيانات: تم التحقق';
    $('#dataBadge').classList.add('connected');
    status.className='connector-status ok';
    status.textContent=`تم تحميل ${rows.length} سهم. القيم المفقودة لا تتحول إلى صفر، والحقول المتكررة بشكل غير طبيعي تُعزل تلقائيًا.`;
    render();
    $('#integrityLog').innerHTML=integritySummary(analyzed,suspect);
    const dl=$('#analysisTickerList');
    if(dl) dl.innerHTML=rows.slice(0,3000).map(x=>`<option value="${esc(x.ticker)}"></option>`).join('');
  }catch(e){
    rows=[]; analyzed=[];
    $('#dataBadge').textContent='● DATA FAILURE';
    status.className='connector-status err';
    status.textContent='فشل تحميل بيانات موثوقة: '+e.message;
    $('#integrityLog').innerHTML='<div class="log-item warn">DATA FAILURE — تم إيقاف التقييم بدل عرض أرقام افتراضية.</div>';
    render();
  }
}

function exportCSV(){
  const h=['ticker','price','changePct','prevClose','volume','prevVolume','rvol','turnover','quality','score','stage'];
  const lines=[h.join(',')];
  for(const x of analyzed) lines.push(h.map(k=>x[k]??'').join(','));
  const blob=new Blob([lines.join('\n')],{type:'text/csv'});
  const u=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=u;a.download='TAG500-results.csv';a.click();URL.revokeObjectURL(u);
}

document.addEventListener('DOMContentLoaded',()=>{
  ['search','stageFilter','shariaFilter'].forEach(id=>$('#'+id)?.addEventListener('input',render));
  $('#connectFinviz')?.addEventListener('click',loadData);
  $('#exportBtn')?.addEventListener('click',exportCSV);
  $('#analyzerForm')?.addEventListener('submit',e=>{
    e.preventDefault();
    const t=($('#analysisTicker')?.value||'').trim().toUpperCase();
    showAnalysis(t);
  });
  $('#refreshSelectedTicker')?.addEventListener('click',async()=>{
    await loadData();
    const t=($('#analysisTicker')?.value||'').trim().toUpperCase();
    if(t) showAnalysis(t);
  });
  $('#scannerBody')?.addEventListener('click',e=>{
    const tr=e.target.closest('tr[data-ticker]');
    if(tr){ $('#analysisTicker').value=tr.dataset.ticker; showAnalysis(tr.dataset.ticker); $('#analysis')?.scrollIntoView({behavior:'smooth'}); }
  });
  loadData();
});
