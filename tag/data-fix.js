'use strict';

const TAG_RUNTIME_VERSION='TAG507';
const FRESHNESS_LIMIT_MIN=20;

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

function freshnessMinutes(ts){
  const n=Date.parse(ts||'');
  return Number.isFinite(n)?Math.max(0,(Date.now()-n)/60000):Infinity;
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
  const marketCoreValid=core>=4&&Number.isFinite(score);
  const shariaVerified=x.sharia==='VERIFIED';
  const feedFresh=sourceMeta.feedFresh===true;
  const valid=marketCoreValid&&shariaVerified&&feedFresh;
  const trainingEligible=valid&&sourceMeta.finalReconciled===true&&sourceMeta.independentSourceCount>=2;
  const quality=Math.round((core/4*.65 + (Number.isFinite(x.prevVolume)?.15:0) + (Number.isFinite(x.catalystAgeHours)?.10:0) + (Number.isFinite(x.prevSessionChangePct)?.10:0))*100);

  if(x.sharia==='EXCLUDED') reasons.push('مستبعد شرعيًا');
  else if(!shariaVerified) reasons.push('غير متحقق شرعيًا — Research Only');
  if(!feedFresh) reasons.push(`لقطة قديمة > ${FRESHNESS_LIMIT_MIN} دقيقة — الترتيب التنفيذي متوقف`);
  if(Number.isFinite(prevVolRatio)) reasons.push(`الحجم/الجلسة السابقة ${prevVolRatio.toFixed(1)}×`);
  else if(Number.isFinite(x.volumeRank)) reasons.push(`الحجم ضمن أعلى ${(100-x.volumeRank).toFixed(0)}% من المسح`);
  if(Number.isFinite(gapPct)&&Math.abs(gapPct)>=5) reasons.push(`مقابل الإغلاق السابق ${fmtPct(gapPct)}`);
  if(Number.isFinite(x.prevSessionChangePct)) reasons.push(`الجلسة السابقة ${fmtPct(x.prevSessionChangePct)}`);
  if(Number.isFinite(x.catalystAgeHours)&&x.catalystAgeHours<=96) reasons.push(`خبر خلال ${Math.round(x.catalystAgeHours)}س`);
  if(!marketCoreValid) reasons.unshift('بيانات سوق غير كافية للتقييم');

  let stage='DATA_INSUFFICIENT';
  if(marketCoreValid){
    if(Number.isFinite(exhaustion)&&exhaustion>=76) stage='EXHAUSTION';
    else if(Number.isFinite(x.changePct)&&x.changePct>=45) stage='LATE';
    else if(Number.isFinite(ignition)&&ignition>=62) stage='IGNITION';
    else stage='DISCOVERY';
  }
  return {...x,rvol,prevVolRatio,turnover,gapPct,early,ignition,continuation,exhaustion,score,stage,valid,marketCoreValid,shariaVerified,feedFresh,trainingEligible,quality,reasons,missing};
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
    const currentTs=Date.parse(rawTs)||Date.now();
    const ageMin=freshnessMinutes(rawTs||currentTs);
    const feedFresh=Number.isFinite(ageMin)&&ageMin<=FRESHNESS_LIMIT_MIN;
    const reconciliation=String(primary.finalSnapshotReconciliation||primary.reconciliationStatus||primary.dataIntegrityState||'UNKNOWN').toUpperCase();
    const independentSourceCount=Number(primary.independentSourceCount||0);
    const finalReconciled=/FINAL|RECONCILED|MATCHED|VERIFIED/.test(reconciliation)&&!/ERROR|MISMATCH|UNVERIFIED|UNKNOWN/.test(reconciliation);

    mergeEnrichment(base,enrichment,currentTs);
    mergeHistorical(base,hist,sessionDateFromET(rawTs));
    volumePercentiles(base);
    rows=base;
    sourceMeta={name:'Finviz + Yahoo + session history',updated:new Date(currentTs),warnings:[],feedFresh,ageMin,reconciliation,independentSourceCount,finalReconciled};
    render();

    const executable=analyzed.filter(x=>x.valid).length;
    const researchOnly=analyzed.filter(x=>x.marketCoreValid&&!x.valid&&x.sharia!=='EXCLUDED').length;
    const training=analyzed.filter(x=>x.trainingEligible).length;
    const prev=rows.filter(x=>Number.isFinite(x.prevVolume)).length;
    $('#dataBadge').textContent=feedFresh?`● البيانات حديثة: ${base.length} سهم`:`● البيانات قديمة: ${Math.round(ageMin)}د`;
    $('#dataBadge').classList.toggle('connected',feedFresh);
    status.className=feedFresh?'connector-status ok':'connector-status err';
    status.textContent=`${TAG_RUNTIME_VERSION} · ${base.length} سهم · ${executable} مؤهل تنفيذيًا · ${researchOnly} Research Only · ${prev} بسياق جلسة سابقة · عمر اللقطة ${Number.isFinite(ageMin)?Math.round(ageMin)+'د':'غير معروف'}`;
    $('#integrityLog').innerHTML=`<div class="log-item">Freshness: ${feedFresh?'PASS':'FAIL'} · ${Number.isFinite(ageMin)?Math.round(ageMin)+' دقيقة':'timestamp غير صالح'} · الحد ${FRESHNESS_LIMIT_MIN} دقيقة</div><div class="log-item">Sharia gate: VERIFIED فقط مؤهل تنفيذيًا · UNVERIFIED = Research Only · EXCLUDED = مستبعد</div><div class="log-item">Final Snapshot Reconciliation: ${esc(reconciliation)} · مصادر مستقلة ${independentSourceCount} · Training Eligible ${training}</div><div class="log-item">لا تتحول أي نتيجة intraperiod أو غير مصالحة إلى حقيقة تدريبية.</div>`;
  }catch(e){
    rows=[]; analyzed=[];
    sourceMeta={name:'none',updated:null,warnings:[e.message],feedFresh:false,ageMin:Infinity,reconciliation:'ERROR',independentSourceCount:0,finalReconciled:false};
    status.className='connector-status err';
    status.textContent='فشل تحميل البيانات: '+e.message;
    $('#dataBadge').textContent='● DATA FAILURE';
    $('#integrityLog').innerHTML='<div class="log-item warn">DATA FAILURE: '+esc(e.message)+'</div>';
  }
};

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(loadData,0));
else setTimeout(loadData,0);
