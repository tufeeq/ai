'use strict';
const BUILD='TAGX-0.2';
const URLS={
  movers:'https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/finviz.json',
  discovery:'https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/discovery.json',
  snapshots:'https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/snapshots.json',
  enrichment:'https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/enrichment.json'
};
let state={rows:[],meta:{},history:new Map(),enrichment:new Map(),loadedAt:0,error:null};
const $=s=>document.querySelector(s);
const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:a));
const key=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const num=v=>{if(v===null||v===undefined||v==='')return null;if(typeof v==='number')return Number.isFinite(v)?v:null;let s=String(v).replace(/[,$%\s]/g,'').trim();const m=s.match(/^(-?[\d.]+)([KMBT])?$/i);if(!m)return null;const mult={K:1e3,M:1e6,B:1e9,T:1e12};const out=Number(m[1])*(mult[(m[2]||'').toUpperCase()]||1);return Number.isFinite(out)?out:null};
const fmt=(v,d=2)=>Number.isFinite(v)?v.toFixed(d):'—';
const pct=(v,d=1)=>Number.isFinite(v)?`${v>=0?'+':''}${v.toFixed(d)}%`:'—';
const vol=v=>!Number.isFinite(v)?'—':v>=1e9?(v/1e9).toFixed(2)+'B':v>=1e6?(v/1e6).toFixed(2)+'M':v>=1e3?(v/1e3).toFixed(1)+'K':String(Math.round(v));
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[m]));
function pick(o,names){if(!o||typeof o!=='object')return null;const m=new Map(Object.keys(o).map(k=>[key(k),o[k]]));for(const name of names)if(m.has(name))return m.get(name);return null}
const A={ticker:['ticker','symbol'],price:['price','last','lastprice','close'],change:['change','changepct','changepercent','perfday','percentchange'],volume:['volume','vol'],avg:['avgvolume','averagevolume','avgvol'],float:['float','sharesfloat','floatshares'],spread:['spreadpct','spreadpercent','spread'],company:['company','name','companyname'],sector:['sector'],industry:['industry'],sharia:['sharia','shariastatus']};
function records(p){if(Array.isArray(p))return p;if(!p||typeof p!=='object')return[];for(const k of ['rows','data','results','stocks','items','records','topMovers'])if(Array.isArray(p[k]))return p[k];return[]}
function normalize(o,source='movers'){
  const ticker=String(pick(o,A.ticker)||'').trim().toUpperCase(); if(!ticker)return null;
  const firstTs=o._firstObservedTimestampUTC||o._firstObservedTimestampET||null;
  const firstChange=num(o._firstObservedChange);
  const firstVolume=num(o._firstObservedVolume);
  return {ticker,price:num(pick(o,A.price)),change:num(pick(o,A.change)),volume:num(pick(o,A.volume)),avgVolume:num(pick(o,A.avg)),float:num(pick(o,A.float)),spread:num(pick(o,A.spread)),company:String(pick(o,A.company)||''),sector:String(pick(o,A.sector)||''),industry:String(pick(o,A.industry)||''),sharia:String(pick(o,A.sharia)||'UNVERIFIED').toUpperCase(),firstTs,firstChange,firstVolume,source,raw:o};
}
function mergeFeeds(moversPayload,discoveryPayload){
  const map=new Map();
  for(const raw of records(discoveryPayload)){const x=normalize(raw,'discovery');if(x)map.set(x.ticker,x)}
  for(const raw of records(moversPayload)){
    const m=normalize(raw,'movers'); if(!m)continue; const d=map.get(m.ticker);
    if(d){map.set(m.ticker,{...d,...m,source:'both',firstTs:d.firstTs||m.firstTs,firstChange:Number.isFinite(d.firstChange)?d.firstChange:m.firstChange,firstVolume:Number.isFinite(d.firstVolume)?d.firstVolume:m.firstVolume,company:m.company||d.company,sector:m.sector||d.sector,industry:m.industry||d.industry});}
    else map.set(m.ticker,m);
  }
  return [...map.values()];
}
function metaFrom(m,d){const ts=d?.snapshotTimestampUTC||d?.updatedAt||m?.snapshotTimestampUTC||m?.updatedAt||null;return{updated:ts,session:d?.session||m?.session||null,bucket:m?.sessionBucket||d?.sessionBucket||null,moverCount:records(m).length,discoveryCount:records(d).length,independent:Number(m?.independentSourceCount||0),trainingEligible:Boolean(m?.trainingEligible),reconciliation:m?.finalSnapshotReconciliation||'INTRAPERIOD'};}
async function getJson(url){const r=await fetch(url+'?v='+Date.now(),{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}
function walkSnapshots(p,out=[]){if(!p)return out;if(Array.isArray(p)){for(const v of p)walkSnapshots(v,out);return out}if(typeof p!=='object')return out;const rs=records(p);if(rs.length)out.push({ts:p.updatedAt||p.snapshotTimestampUTC||p.timestampUTC||p.timestamp||null,bucket:p.sessionBucket||p.bucket||p.session||null,rows:rs});for(const [k,v] of Object.entries(p)){if(['data','rows','results','stocks','items','records','topMovers'].includes(k))continue;if(v&&typeof v==='object')walkSnapshots(v,out)}return out}
function buildHistory(p){const map=new Map();for(const s of walkSnapshots(p)){const ts=Date.parse(s.ts||'');if(!Number.isFinite(ts))continue;for(const raw of s.rows){const x=normalize(raw);if(!x)continue;if(!map.has(x.ticker))map.set(x.ticker,[]);map.get(x.ticker).push({ts,bucket:s.bucket,change:x.change,volume:x.volume,price:x.price})}}for(const a of map.values())a.sort((a,b)=>a.ts-b.ts);return map}
function buildEnrichment(p){const map=new Map();const arr=Array.isArray(p)?p:records(p);for(const o of arr){const t=String(o.ticker||o.symbol||pick(o,A.ticker)||'').toUpperCase();if(!t)continue;const news=o.news||o.articles||o.googleNews||[];let latest=null;if(Array.isArray(news))for(const a of news){const ts=Date.parse(a.publishedAt||a.pubDate||a.timestamp||'');if(Number.isFinite(ts)&&(!latest||ts>latest.ts))latest={ts,title:a.title||'',source:a.source||a.publisher||''}}map.set(t,{latest,raw:o})}return map}
function temporal(x){
  const hist=(state.history.get(x.ticker)||[]).filter(p=>Number.isFinite(p.change));
  const firstTs=Date.parse(x.firstTs||''); const synthetic=[];
  if(Number.isFinite(firstTs)&&Number.isFinite(x.firstChange))synthetic.push({ts:firstTs,change:x.firstChange,volume:x.firstVolume});
  const all=[...synthetic,...hist].sort((a,b)=>a.ts-b.ts).filter((p,i,a)=>i===0||p.ts!==a[i-1].ts);
  if(!all.length)return{origin:Number.isFinite(x.firstChange)?x.firstChange:x.change,firstTs:Number.isFinite(firstTs)?firstTs:null,slope:null,velocity10:null,retention:null,volumeVelocity:null,volumeGrowth:null,points:0};
  const first=all[0],last=all[all.length-1],origin=Number.isFinite(x.firstChange)?x.firstChange:first.change;
  const currentChange=Number.isFinite(x.change)?x.change:last.change; const peak=Math.max(...all.map(p=>p.change).filter(Number.isFinite),Number.isFinite(currentChange)?currentChange:-Infinity);
  const dtMin=Math.max(((Date.now())-first.ts)/60000,1); const pathHours=Math.max((last.ts-first.ts)/36e5,1/60);
  const slope=all.length>=2?(last.change-first.change)/pathHours:null; const velocity10=Number.isFinite(origin)&&Number.isFinite(currentChange)?(currentChange-origin)/(dtMin/10):null;
  const retention=peak>0&&Number.isFinite(currentChange)?clamp(currentChange/peak*100):null;
  const volumeVelocity=Number.isFinite(x.volume)&&Number.isFinite(x.firstVolume)?Math.max(0,(x.volume-x.firstVolume)/dtMin):null;
  const volumeGrowth=Number.isFinite(x.volume)&&Number.isFinite(x.firstVolume)&&x.firstVolume>0?x.volume/x.firstVolume:null;
  return{origin,firstTs:first.ts,slope,velocity10,retention,volumeVelocity,volumeGrowth,points:all.length};
}
function compliance(x){const text=(x.sector+' '+x.industry+' '+x.company).toLowerCase();if(/insurance|bank|gambl|casino|tobacco|alcohol|credit services|mortgage|broker-dealer|investment fund|closed-end fund|etf/.test(text))return{status:'EXCLUDED',reason:'نشاط/أداة مستبعدة'};if(x.sharia==='VERIFIED')return{status:'VERIFIED',reason:'متحقق'};if(x.sharia==='EXCLUDED')return{status:'EXCLUDED',reason:'مستبعد'};return{status:'UNVERIFIED',reason:'يحتاج تحقق'}}
function catalyst(x){const e=state.enrichment.get(x.ticker);if(!e||!e.latest)return{status:'UNKNOWN',label:'لا يوجد محفز موثق حديث',ageH:null};const ageH=(Date.now()-e.latest.ts)/36e5;return{status:ageH<=24?'FRESH':'STALE',label:e.latest.title||'خبر',ageH,source:e.latest.source}}
function analyze(x){
  const t=temporal(x), c=compliance(x), cat=catalyst(x);
  const rvol=Number.isFinite(x.volume)&&Number.isFinite(x.avgVolume)&&x.avgVolume>0?x.volume/x.avgVolume:null;
  const turnover=Number.isFinite(x.volume)&&Number.isFinite(x.float)&&x.float>0?x.volume/x.float:null;
  const move=Number.isFinite(x.change)?x.change:0, origin=Number.isFinite(t.origin)?t.origin:move;
  const originScore=origin<5?100:origin<10?88:origin<20?62:origin<35?22:0;
  const volumeGrowthScore=Number.isFinite(t.volumeGrowth)?clamp((Math.log2(Math.max(1,t.volumeGrowth))*22)):25;
  const volumeVelocityScore=Number.isFinite(t.volumeVelocity)?clamp(Math.log10(1+t.volumeVelocity)*24):20;
  const velocityScore=Number.isFinite(t.velocity10)?clamp(50+t.velocity10*7):35;
  const rvolScore=Number.isFinite(rvol)?clamp(Math.log2(1+rvol)*20):30;
  const floatScore=Number.isFinite(turnover)?clamp(Math.log2(1+turnover)*30):25;
  const persistenceScore=Number.isFinite(t.slope)?clamp(50+t.slope*2):40;
  const retentionScore=Number.isFinite(t.retention)?t.retention:45;
  const spreadScore=Number.isFinite(x.spread)?clamp(100-x.spread*16):55;
  const latePenalty=move>=50?45:move>=35?32:move>=20?18:0;
  let regime=clamp(.24*originScore+.14*volumeGrowthScore+.10*volumeVelocityScore+.16*velocityScore+.12*rvolScore+.10*floatScore+.07*persistenceScore+.04*retentionScore+.03*spreadScore-latePenalty);
  let ignition=clamp(.45*regime+.22*velocityScore+.14*rvolScore+.10*floatScore+.09*retentionScore);
  let risk=20; if(c.status==='UNVERIFIED')risk+=25; if(c.status==='EXCLUDED')risk=100; if(cat.status==='UNKNOWN')risk+=10; if(move>=25)risk+=18; if(Number.isFinite(x.spread)&&x.spread>3)risk+=15; if(Number.isFinite(t.retention)&&t.retention<55)risk+=15; risk=clamp(risk);
  let stage='DISCOVERY'; if(move>=50||(Number.isFinite(t.retention)&&t.retention<40))stage='EXHAUSTION'; else if(move>=25)stage='LATE'; else if(ignition>=78&&move<20)stage='IGNITION'; else if(regime>=70&&move<15)stage='PRE_IGNITION'; else if(regime>=58&&move<12)stage='WAKE_UP';
  const evidence=[t.firstTs,t.volumeGrowth,t.volumeVelocity,t.velocity10,rvol,turnover,x.price,x.volume].filter(v=>Number.isFinite(v)).length/8*100;
  let action=stage==='IGNITION'?'دخول مشروط':stage==='PRE_IGNITION'?'راقب للتأكيد':stage==='WAKE_UP'?'مراقبة نشطة':stage==='LATE'?'لا تطارد':stage==='EXHAUSTION'?'تجنب':'رادار';
  const execution=c.status==='VERIFIED'&&risk<65&&['WAKE_UP','PRE_IGNITION','IGNITION'].includes(stage)&&evidence>=50?'ACTIONABLE':'RESEARCH';
  const why=[]; if(Number.isFinite(origin))why.push(`أول ظهور ${pct(origin)}`); if(Number.isFinite(t.volumeGrowth)&&t.volumeGrowth>=1.5)why.push(`الحجم منذ الرصد ${fmt(t.volumeGrowth,1)}×`); if(Number.isFinite(t.volumeVelocity))why.push(`${vol(t.volumeVelocity)}/دقيقة`); if(Number.isFinite(t.velocity10)&&t.velocity10>.5)why.push(`السعر +${fmt(t.velocity10,1)} نقطة/10د`); if(Number.isFinite(rvol)&&rvol>=1.5)why.push(`RVOL ${fmt(rvol,1)}×`); if(Number.isFinite(turnover)&&turnover>=.15)why.push(`Float ${fmt(turnover,2)}×`); if(cat.status==='FRESH')why.push('محفز حديث');
  const blockers=[]; if(c.status!=='VERIFIED')blockers.push(c.reason); if(evidence<50)blockers.push('أدلة غير مكتملة'); if(stage==='LATE'||stage==='EXHAUSTION')blockers.push('الحركة أصبحت متأخرة'); if(state.meta.reconciliation!=='RECONCILED')blockers.push('النتيجة النهائية غير مصالحة');
  return{...x,...t,c,cat,rvol,turnover,regime,ignition,risk,evidence,stage,action,execution,why,blockers};
}
const stageAr=s=>({DISCOVERY:'Discovery',WAKE_UP:'Wake-Up',PRE_IGNITION:'Pre-Ignition',IGNITION:'Ignition',LATE:'Late',EXHAUSTION:'Exhaustion'})[s]||s;
function badge(t,cls=''){return`<span class="badge ${cls}">${esc(t)}</span>`}
function renderStatus(){const age=state.meta.updated?Math.max(0,(Date.now()-Date.parse(state.meta.updated))/60000):null;$('#statusbar').innerHTML=[badge(BUILD),badge(state.meta.session||state.meta.bucket||'SESSION ?'),badge(age===null?'وقت المصدر غير معروف':`عمر ${fmt(age,0)} د`,age!==null&&age<20?'good':'warn'),badge(`Proactive ${state.meta.discoveryCount||0}`,'good'),badge(`Movers ${state.meta.moverCount||0}`),badge(state.meta.trainingEligible?'Training Eligible':'Intraperiod / Research','warn')].join('')}
function card(x){return`<div class="stock" data-t="${x.ticker}"><div class="row"><span class="ticker">${esc(x.ticker)}</span><span class="score">${fmt(x.regime,0)}</span></div><div class="row"><span class="${x.change>=0?'pos':'neg'}">${pct(x.change)}</span><span>${stageAr(x.stage)}</span></div><div class="chips">${x.why.slice(0,3).map(v=>`<span class="chip">${esc(v)}</span>`).join('')}<span class="chip">Risk ${fmt(x.risk,0)}</span></div></div>`}
function render(){
 const analyzed=state.rows.map(analyze); state.analyzed=analyzed; const q=($('#search')?.value||'').toUpperCase().trim(),sf=$('#stageFilter')?.value||'all',ef=$('#executionFilter')?.value||'all';
 const filtered=analyzed.filter(x=>(!q||x.ticker.includes(q))&&(sf==='all'||x.stage===sf)&&(ef==='all'||x.execution===ef)).sort((a,b)=>b.regime-a.regime);
 const early=filtered.filter(x=>['WAKE_UP','PRE_IGNITION','IGNITION'].includes(x.stage)&&x.change<20).slice(0,8); const forming=filtered.filter(x=>x.stage==='DISCOVERY').slice(0,8); const late=filtered.filter(x=>['LATE','EXHAUSTION'].includes(x.stage)).sort((a,b)=>b.change-a.change).slice(0,8);
 $('#earlyLane').innerHTML=early.map(card).join('')||'<div class="empty">لا توجد إشارة Early مكتملة؛ راجع حالات الرادار أدناه.</div>'; $('#formingLane').innerHTML=forming.map(card).join('')||'<div class="empty">لا توجد حالات رادار.</div>'; $('#lateLane').innerHTML=late.map(card).join('')||'<div class="empty">لا توجد حالات متأخرة بارزة.</div>';
 $('#kEarly').textContent=analyzed.filter(x=>['WAKE_UP','PRE_IGNITION','IGNITION'].includes(x.stage)&&x.change<20).length; $('#kForming').textContent=analyzed.filter(x=>x.stage==='DISCOVERY').length; $('#kLate').textContent=analyzed.filter(x=>['LATE','EXHAUSTION'].includes(x.stage)).length; const withOrigin=analyzed.filter(x=>Number.isFinite(x.origin)); $('#kOrigin').textContent=analyzed.length?Math.round(withOrigin.length/analyzed.length*100)+'%':'—';
 const best=early.sort((a,b)=>(b.execution==='ACTIONABLE')-(a.execution==='ACTIONABLE')||b.regime-a.regime)[0]; $('#bestDecision').innerHTML=best?`<div class="muted">أفضل حالة مبكرة — ليست أعلى Gainer</div><div class="ticker">${best.ticker}</div><div class="row"><span class="${best.change>=0?'pos':'neg'}">${pct(best.change)}</span><span>Regime ${fmt(best.regime,0)} · Ignition ${fmt(best.ignition,0)}</span></div><span class="action">${esc(best.action)}</span><div class="why">${esc(best.why.slice(0,4).join(' · '))}</div>`:'<h2>لا توجد توصية تنفيذية مكتملة الآن</h2><div class="why">TAGX ما زالت تعرض Wake-Up/Research بدل إخفاء السوق؛ التنفيذ يتطلب تحققًا شرعيًا وأدلة كافية.</div>';
 $('#decisionHealth').innerHTML=[`<div class="signal">كون استباقي: ${state.meta.discoveryCount||0} سهم مقابل ${state.meta.moverCount||0} في feed التفاعلي</div>`,`<div class="signal">Origin coverage: ${withOrigin.length}/${analyzed.length}</div>`,`<div class="signal">Sharia VERIFIED: ${analyzed.filter(x=>x.c.status==='VERIFIED').length} · UNVERIFIED: ${analyzed.filter(x=>x.c.status==='UNVERIFIED').length}</div>`,`<div class="signal">Final truth: ${state.meta.trainingEligible?'مؤهل':'محجوب — intraperiod'}</div>`].join('');
 $('#scannerBody').innerHTML=filtered.map(x=>`<tr data-t="${x.ticker}"><td class="ticker">${x.ticker}</td><td>${Number.isFinite(x.price)?'$'+fmt(x.price,x.price<1?3:2):'—'}</td><td class="${x.change>=0?'pos':'neg'}">${pct(x.change)}</td><td>${pct(x.origin)}</td><td>${stageAr(x.stage)}</td><td class="score">${fmt(x.regime,0)}</td><td>${fmt(x.ignition,0)}</td><td>${fmt(x.risk,0)}</td><td>${Number.isFinite(x.volumeGrowth)?fmt(x.volumeGrowth,1)+'×':'—'}</td><td>${Number.isFinite(x.volumeVelocity)?vol(x.volumeVelocity)+'/m':'—'}</td><td>${esc(x.action)}</td><td><span class="gate ${x.execution==='ACTIONABLE'?'ok':'blocked'}">${x.execution==='ACTIONABLE'?'تنفيذي':'Research'}</span></td></tr>`).join('')||'<tr><td colspan="12" class="empty">لا توجد نتائج مطابقة.</td></tr>'; document.querySelectorAll('[data-t]').forEach(el=>el.onclick=()=>openDetail(analyzed.find(x=>x.ticker===el.dataset.t))); renderStatus();
}
function openDetail(x){if(!x)return;const d=$('#drawer');const invalidation=Number.isFinite(x.price)?`فقدان الزخم أو كسر نحو $${fmt(x.price*.94,x.price<1?3:2)}`:'فقدان الزخم/Retention';d.innerHTML=`<button class="close">إغلاق ×</button><div class="muted">${stageAr(x.stage)} · ${x.execution==='ACTIONABLE'?'تنفيذي':'Research Only'}</div><h2>${x.ticker}</h2><div class="row"><strong>${Number.isFinite(x.price)?'$'+fmt(x.price,x.price<1?3:2):'—'}</strong><strong class="${x.change>=0?'pos':'neg'}">${pct(x.change)}</strong></div><div class="detail-grid"><div class="detail"><h4>لماذا الآن؟</h4>${x.why.map(v=>`<p>• ${esc(v)}</p>`).join('')||'<p>لا توجد أدلة كافية.</p>'}</div><div class="detail"><h4>ما الذي يمنع التنفيذ؟</h4>${x.blockers.map(v=>`<p>• ${esc(v)}</p>`).join('')||'<p>لا يوجد مانع رئيسي.</p>'}</div><div class="detail"><h4>قرار ومخاطر</h4><p>Regime ${fmt(x.regime,0)} · Ignition ${fmt(x.ignition,0)} · Risk ${fmt(x.risk,0)}</p><p><b>الإبطال:</b> ${esc(invalidation)}</p><p><b>الأصل:</b> ${x.source==='discovery'?'Proactive-only':x.source==='both'?'Proactive + Movers':'Mover feed only'}</p></div><div class="detail"><h4>السرعة والسيولة</h4><p>Volume growth: ${Number.isFinite(x.volumeGrowth)?fmt(x.volumeGrowth,1)+'×':'—'}</p><p>Volume velocity: ${Number.isFinite(x.volumeVelocity)?vol(x.volumeVelocity)+'/دقيقة':'—'}</p><p>Price velocity: ${Number.isFinite(x.velocity10)?fmt(x.velocity10,1)+' نقطة/10د':'—'}</p><p>Retention: ${Number.isFinite(x.retention)?fmt(x.retention,0)+'%':'—'}</p></div><div class="detail"><h4>المحفز</h4><p>${esc(x.cat.label)}</p><p>${x.cat.ageH!==null?'عمر الخبر '+fmt(x.cat.ageH,1)+' ساعة':'No-news/غير مؤكد — مخاطرة أعلى'}</p></div><div class="detail"><h4>الامتثال</h4><p>${esc(x.c.status)} — ${esc(x.c.reason)}</p><p>Unverified يبقى Research ولا يُعرض كتوصية مؤكدة.</p></div></div>`;d.classList.add('open');d.querySelector('.close').onclick=()=>d.classList.remove('open')}
async function load(){state.error=null;$('#statusbar').innerHTML=badge('جلب البيانات…');try{const [m,d,s,e]=await Promise.allSettled([getJson(URLS.movers),getJson(URLS.discovery),getJson(URLS.snapshots),getJson(URLS.enrichment)]);if(m.status!=='fulfilled'&&d.status!=='fulfilled')throw new Error('لا يوجد أي feed سوق متاح');const movers=m.status==='fulfilled'?m.value:{rows:[]};const discovery=d.status==='fulfilled'?d.value:{rows:[]};state.meta=metaFrom(movers,discovery);state.rows=mergeFeeds(movers,discovery);state.history=s.status==='fulfilled'?buildHistory(s.value):new Map();state.enrichment=e.status==='fulfilled'?buildEnrichment(e.value):new Map();state.loadedAt=Date.now();render()}catch(err){state.error=err.message;state.rows=[];$('#bestDecision').innerHTML='<h2>تعذر جلب بيانات السوق</h2><div class="why">Fail-closed: لن يتم إنشاء فرص وهمية.</div>';$('#scannerBody').innerHTML='<tr><td colspan="12" class="empty">'+esc(err.message)+'</td></tr>';$('#statusbar').innerHTML=badge('DATA FAILURE','bad')}}
['search','stageFilter','executionFilter'].forEach(id=>document.addEventListener('input',e=>{if(e.target&&e.target.id===id)render()}));$('#refresh').onclick=load;load();setInterval(()=>{if(document.visibilityState==='visible')load()},120000);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&Date.now()-(state.loadedAt||0)>60000)load()});
