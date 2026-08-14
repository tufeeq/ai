'use strict';

const TAG500_FRESHNESS_MINUTES=20;

function sessionDateFromET(ts){
  const d=new Date(ts||Date.now());
  if(!Number.isFinite(d.getTime())) return null;
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hour12:false}).formatToParts(d);
  const o=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  let y=+o.year,m=+o.month,day=+o.day,h=+o.hour;
  const local=new Date(Date.UTC(y,m-1,day));
  if(h<4) local.setUTCDate(local.getUTCDate()-1);
  return local.toISOString().slice(0,10);
}

function flattenSnapshots(payload){
  const out=[];
  for(const snap of Array.isArray(payload)?payload:[]){
    const ts=snap.timestampET||snap.timestampUTC||'';
    const sdate=sessionDateFromET(ts);
    for(const r of (snap.topMovers||snap.rows||[])) out.push({...r,__ts:Date.parse(ts)||0,__sessionDate:sdate,__session:snap.session||''});
  }
  return out;
}

function mergeHistorical(base,hist,currentSessionDate){
  const all=flattenSnapshots(hist),groups=new Map();
  for(const r of all){
    const t=String(rawPick(r,FIELD_ALIASES.ticker)||'').toUpperCase();
    if(!t) continue;
    if(!groups.has(t)) groups.set(t,[]);
    groups.get(t).push(r);
  }
  for(const x of base){
    const g=(groups.get(x.ticker)||[]).filter(r=>r.__sessionDate&&(!currentSessionDate||r.__sessionDate<currentSessionDate)).sort((a,b)=>b.__ts-a.__ts);
    if(!g.length) continue;
    const latestDate=g[0].__sessionDate;
    const prev=g.filter(r=>r.__sessionDate===latestDate).sort((a,b)=>b.__ts-a.__ts)[0];
    const p=num(rawPick(prev,FIELD_ALIASES.price)),v=num(rawPick(prev,FIELD_ALIASES.volume)),c=num(rawPick(prev,FIELD_ALIASES.changePct));
    if(x.prevClose==null&&p!=null){x.prevClose=p;x.prevCloseDerived=true;}
    if(v!=null){x.prevVolume=v;x.prevVolumeDerived=true;}
    if(c!=null)x.prevSessionChangePct=c;
    x.prevSessionDate=latestDate;
  }
  return base;
}

function mergeEnrichment(base,enrichment,nowTs){
  const map=enrichment&&enrichment.rows&&typeof enrichment.rows==='object'?enrichment.rows:{};
  for(const x of base){
    const e=map[x.ticker]; if(!e) continue;
    const p=e.price||{};
    if(num(p.last)!=null) x.confirmedPrice=num(p.last);
    if(num(p.previousClose)!=null){x.prevClose=num(p.previousClose);x.prevCloseDerived=false;}
    if(num(p.volume)!=null) x.confirmedVolume=num(p.volume);
    const news=Array.isArray(e.news)?e.news:[];
    const newest=news.map(n=>Date.parse(n.published||'')).filter(Number.isFinite).sort((a,b)=>b-a)[0];
    if(Number.isFinite(newest)) x.catalystAgeHours=Math.max(0,(nowTs-newest)/36e5);
    x.newsCount=news.length;
    x.latestNews=news[0]?.title||null;
  }
  return base;
}

function volumePercentiles(base){
  const vals=base.map(x=>x.volume).filter(Number.isFinite).sort((a,b)=>a-b);
  for(const x of base){
    if(!Number.isFinite(x.volume)||!vals.length){x.volumeRank=null;continue;}
    let lo=0,hi=vals.length; while(lo<hi){const mid=(lo+hi)>>1;if(vals[mid]<=x.volume)lo=mid+1;else hi=mid;}
    x.volumeRank=lo/vals.length*100;
  }
}

function reconciliationMeta(primary){
  const state=String(primary.finalSnapshotReconciliation||primary.reconciliationStatus||primary.dataIntegrityState||'UNKNOWN').toUpperCase();
  const independentSourceCount=Number(primary.independentSourceCount||0);
  const finalState=['FINAL_RECONCILED','RECONCILED','MATCHED','PASS','VERIFIED'].includes(state);
  return {state,independentSourceCount,trainingEligible:finalState&&independentSourceCount>=2};
}

analyze=function(x){
  const reasons=[],missing=[];
  const prevVolRatio=Number.isFinite(x.volume)&&Number.isFinite(x.prevVolume)&&x.prevVolume>0?x.volume/x.prevVolume:null;
  const rvol=Number.isFinite(x.volume)&&Number.isFinite(x.avgVolume)&&x.avgVolume>0?x.volume/x.avgVolume:prevVolRatio;
  const turnover=Number.isFinite(x.volume)&&Number.isFinite(x.float)&&x.float>0?x.volume/x.float:null;
  const gapPct=Number.isFinite(x.price)&&Number.isFinite(x.prevClose)&&x.prevClose>0?(x.price-x.prevClose)/x.prevClose*100:x.changePct;
  const volScore=Number.isFinite(prevVolRatio)?clamp(Math.log2(1+prevVolRatio)*22):Number.isFinite(x.volumeRank)?x.volumeRank:null;
  const moveScore=Number.isFinite(x.changePct)?clamp(Math.max(0,x.changePct)*1.35):null;
  const gapScore=Number.isFinite(gapPct)?clamp(Math.max(0,gapPct)*1.2):null;
  const catalyst=Number.isFinite(x.catalystAgeHours)?(x.catalystAgeHours<=12?95:x.catalystAgeHours<=36?75:x.catalystAgeHours<=96?50:25):null;
  const prior=Number.isFinite(x.prevSessionChangePct)?clamp(50+x.prevSessionChangePct*2):null;
  let early=weighted([[volScore,.35],[gapScore,.25],[catalyst,.20],[prior,.20]]).value;
  let ignition=weighted([[moveScore,.42],[volScore,.35],[gapScore,.23]]).value;
  let continuation=weighted([[volScore,.35],[catalyst,.25],[prior,.20],[Number.isFinite(x.changePct)?clamp(55+x.changePct*.5):null,.20]]).value;
  let exhaustion=weighted([[Number.isFinite(x.changePct)?clamp(Math.max(0,x.changePct-45)*1.4):null,.70],[Number.isFinite(prevVolRatio)&&prevVolRatio>20?80:null,.30]]).value;
  if(Number.isFinite(x.changePct)&&x.changePct>100&&Number.isFinite(early)) early=clamp(early-20);
  const score=weighted([[early,.42],[ignition,.30],[continuation,.20],[Number.isFinite(exhaustion)?100-exhaustion:null,.08]]).value;
  const core=['price','volume','changePct','prevClose'].filter(k=>Number.isFinite(x[k])).length;
  const dataComplete=core>=4&&Number.isFinite(score);
  const feedFresh=sourceMeta.fresh!==false;
  const shariaVerified=x.sharia==='VERIFIED';
  const valid=dataComplete&&feedFresh&&shariaVerified;
  const quality=Math.round((core/4*.65 + (Number.isFinite(x.prevVolume)?.15:0) + (Number.isFinite(x.catalystAgeHours)?.10:0) + (Number.isFinite(x.prevSessionChangePct)?.10:0))*100);
  if(!feedFresh) reasons.push(`لقطة قديمة: ${(sourceMeta.ageMinutes||0).toFixed(0)} دقيقة`);
  if(x.sharia==='UNVERIFIED') reasons.push('Research Only: الشرعية غير متحققة');
  if(x.sharia==='EXCLUDED') reasons.push('مستبعد شرعيًا');
  if(Number.isFinite(prevVolRatio)) reasons.push(`الحجم/الجلسة السابقة ${prevVolRatio.toFixed(1)}×`);
  else if(Number.isFinite(x.volumeRank)) reasons.push(`الحجم ضمن أعلى ${(100-x.volumeRank).toFixed(0)}% من المسح`);
  if(Number.isFinite(gapPct)&&Math.abs(gapPct)>=5) reasons.push(`مقابل الإغلاق السابق ${fmtPct(gapPct)}`);
  if(Number.isFinite(x.prevSessionChangePct)) reasons.push(`الجلسة السابقة ${fmtPct(x.prevSessionChangePct)}`);
  if(Number.isFinite(x.catalystAgeHours)&&x.catalystAgeHours<=96) reasons.push(`خبر خلال ${Math.round(x.catalystAgeHours)}س`);
  if(!dataComplete) reasons.unshift('بيانات غير كافية للتقييم');
  for(const k of ['price','volume','changePct','prevClose']) if(!Number.isFinite(x[k])) missing.push(k);
  let stage='DATA_INSUFFICIENT';
  if(dataComplete){
    if(Number.isFinite(exhaustion)&&exhaustion>=76) stage='EXHAUSTION';
    else if(Number.isFinite(x.changePct)&&x.changePct>=45) stage='LATE';
    else if(Number.isFinite(ignition)&&ignition>=62) stage='IGNITION';
    else stage='DISCOVERY';
  }
  return {...x,rvol,prevVolRatio,turnover,gapPct,early,ignition,continuation,exhaustion,score,stage,valid,dataComplete,feedFresh,shariaVerified,trainingEligible:Boolean(sourceMeta.trainingEligible&&valid),quality,reasons,missing};
};

loadData=async function(){
  const status=$('#finvizStatus');
  status.textContent='جاري دمج Finviz + Yahoo + الجلسات السابقة…';
  try{
    const [primary,enrichment,hist]=await Promise.all([
      fetchJSON('./data/finviz.json'),
      fetchJSON('./data/enrichment.json').catch(()=>({})),
      fetchJSON('./data/snapshots.json').catch(()=>([]))
    ]);
    let base=recordsFromPayload(primary).map(normalizeRecord).filter(Boolean);
    if(!base.length) throw new Error('لا توجد سجلات قابلة للقراءة');
    const rawTs=primary.snapshotTimestampET||primary.snapshotTimestampUTC||primary.updatedAt||'';
    const currentTs=Date.parse(rawTs);
    if(!Number.isFinite(currentTs)) throw new Error('MARKET_TIMESTAMP_MISSING');
    const ageMinutes=Math.max(0,(Date.now()-currentTs)/60000);
    const fresh=ageMinutes<=TAG500_FRESHNESS_MINUTES;
    const rec=reconciliationMeta(primary);
    mergeEnrichment(base,enrichment,currentTs);
    mergeHistorical(base,hist,sessionDateFromET(rawTs));
    volumePercentiles(base);
    rows=base;
    sourceMeta={name:'Finviz + Yahoo + session history',updated:new Date(currentTs),warnings:[],ageMinutes,fresh,reconciliation:rec.state,independentSourceCount:rec.independentSourceCount,trainingEligible:rec.trainingEligible&&fresh};
    render();
    const valid=analyzed.filter(x=>x.valid).length,prev=rows.filter(x=>Number.isFinite(x.prevVolume)).length,verified=rows.filter(x=>x.sharia==='VERIFIED').length;
    $('#dataBadge').textContent=fresh?`● البيانات: ${base.length} سهم · Fresh`:`● البيانات: STALE ${ageMinutes.toFixed(0)}د`;
    $('#dataBadge').classList.toggle('connected',fresh);
    status.className=fresh?'connector-status ok':'connector-status err';
    status.textContent=`${fresh?'لقطة حديثة':'لقطة قديمة — الترتيب التنفيذي متوقف'} · ${base.length} سهم · ${verified} شرعي مؤكد · ${valid} صالح للترتيب · ${prev} بسياق جلسة سابقة · آخر لقطة ${new Date(currentTs).toLocaleString('ar-SA')}`;
    const trainingText=sourceMeta.trainingEligible?'Training Eligible':'Research Only / Not Training Eligible';
    $('#integrityLog').innerHTML=`<div class="log-item">Freshness: ${fresh?'PASS':'FAIL'} · عمر اللقطة ${ageMinutes.toFixed(1)} دقيقة · الحد ${TAG500_FRESHNESS_MINUTES} دقيقة</div><div class="log-item">Sharia Gate: VERIFIED فقط للترتيب التنفيذي · UNVERIFIED = Research Only · EXCLUDED = مستبعد</div><div class="log-item">Final Snapshot Reconciliation: ${esc(rec.state)} · مصادر مستقلة: ${rec.independentSourceCount} · ${trainingText}</div>`;
  }catch(e){
    rows=[]; analyzed=[];
    sourceMeta={name:'none',updated:null,warnings:[e.message],ageMinutes:null,fresh:false,reconciliation:'NO_DATA',independentSourceCount:0,trainingEligible:false};
    render();
    status.className='connector-status err';
    status.textContent='فشل تحميل البيانات: '+e.message;
    $('#dataBadge').textContent='● البيانات: FAIL-CLOSED';
    $('#integrityLog').innerHTML='<div class="log-item warn">DATA FAILURE: '+esc(e.message)+'</div>';
  }
};

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(loadData,0));
else setTimeout(loadData,0);
