'use strict';
(function(){
  const BUILD='TAG534';
  const MAIN='https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/';
  const LOCAL='./data/';
  function etParts(ts){const d=new Date(ts||Date.now());const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(d);return Object.fromEntries(parts.map(p=>[p.type,p.value]));}
  function sessionCode(ts){const p=etParts(ts),m=Number(p.hour)*60+Number(p.minute);if(['Sat','Sun'].includes(p.weekday))return'CLOSED';if(m<240)return'CLOSED';if(m<570)return'PRE';if(m<960)return'RTH';if(m<1200)return'AH';return'FINAL';}
  function sourceSessionCode(primary,currentTs){const raw=String(primary.sessionBucket||primary.session||'').toUpperCase().replace(/[^A-Z0-9]/g,'');if(raw.includes('PRE')||raw.startsWith('PM'))return'PRE';if(raw.includes('RTH')||raw.includes('REGULAR')||raw.includes('OPEN'))return'RTH';if(raw.includes('AFTER')||raw==='AH'||raw.startsWith('AH'))return'AH';if(raw.includes('FINAL'))return'FINAL';if(raw.includes('CLOSED'))return'CLOSED';return sessionCode(currentTs);}
  function sessionAligned(nowCode,srcCode){if(nowCode==='FINAL')return srcCode==='AH'||srcCode==='FINAL';return nowCode===srcCode;}
  async function directJSON(url){
    const sep=url.includes('?')?'&':'?';
    const r=await fetch(url+sep+'ts='+Date.now(),{cache:'no-store'});
    if(!r.ok) throw new Error('HTTP '+r.status+' '+url);
    return r.json();
  }
  async function liveFile(name,optional=false){
    let mainErr=null;
    try{return {payload:await directJSON(MAIN+name),origin:'main-live'};}
    catch(e){mainErr=e;}
    try{return {payload:await directJSON(LOCAL+name),origin:'published-fallback'};}
    catch(e){if(optional)return {payload:name==='snapshots.json'?[]:{},origin:'unavailable'};throw new Error((mainErr?.message||'MAIN_UNAVAILABLE')+' | '+e.message);}
  }
  window.TAG500_DATA_BRIDGE={build:BUILD,primary:'main',fallback:'published-branch',sessionAlignment:true};
  loadData=async function(){
    const status=$('#finvizStatus');
    status.textContent='جاري جلب لقطة السوق الحية من main…';
    try{
      const [p,e,h]=await Promise.all([liveFile('finviz.json'),liveFile('enrichment.json',true),liveFile('snapshots.json',true)]);
      const primary=p.payload,enrichment=e.payload,hist=h.payload;
      let base=recordsFromPayload(primary).map(normalizeRecord).filter(Boolean);
      if(!base.length) throw new Error('NO_LIVE_MARKET_ROWS');
      const rawTs=primary.snapshotTimestampET||primary.snapshotTimestampUTC||primary.updatedAt||primary.timestampET||primary.timestampUTC||'';
      const currentTs=Date.parse(rawTs);
      if(!Number.isFinite(currentTs)) throw new Error('MARKET_TIMESTAMP_MISSING');
      const ageMinutes=Math.max(0,(Date.now()-currentTs)/60000);
      const timeFresh=ageMinutes<=TAG500_FRESHNESS_MINUTES;
      const nowSession=sessionCode(Date.now()),srcSession=sourceSessionCode(primary,currentTs),aligned=sessionAligned(nowSession,srcSession);
      const fresh=timeFresh&&aligned;
      const rec=reconciliationMeta(primary);
      mergeEnrichment(base,enrichment,currentTs);
      mergeHistorical(base,hist,sessionDateFromET(rawTs));
      volumePercentiles(base);
      rows=base;
      sourceMeta={name:'Finviz + Yahoo + session history',updated:new Date(currentTs),warnings:aligned?[]:[`SESSION_MISMATCH_${srcSession}_TO_${nowSession}`],ageMinutes,fresh,timeFresh,sessionAligned:aligned,currentSession:nowSession,sourceSession:srcSession,reconciliation:rec.state,independentSourceCount:rec.independentSourceCount,trainingEligible:rec.trainingEligible&&fresh,dataOrigin:p.origin,enrichmentOrigin:e.origin,historyOrigin:h.origin};
      render();
      const valid=analyzed.filter(x=>x.valid).length,verified=rows.filter(x=>x.sharia==='VERIFIED').length;
      $('#dataBadge').textContent=!timeFresh?`● البيانات: STALE ${ageMinutes.toFixed(0)}د`:!aligned?`● البيانات: SESSION MISMATCH ${srcSession}→${nowSession}`:`● البيانات: ${base.length} سهم · LIVE`;
      $('#dataBadge').classList.toggle('connected',fresh);
      status.className=fresh?'connector-status ok':'connector-status err';
      status.textContent=fresh?`لقطة حية ومتوافقة مع جلسة ${nowSession} · ${base.length} سهم · ${verified} شرعي مؤكد · ${valid} صالح للترتيب · المصدر ${p.origin==='main-live'?'main/live':'fallback'} · آخر لقطة ${new Date(currentTs).toLocaleString('ar-SA')}`:!timeFresh?`لقطة قديمة — الترتيب التنفيذي متوقف · عمرها ${ageMinutes.toFixed(1)} دقيقة`:`انتقال جلسة — الترتيب التنفيذي متوقف حتى تصل لقطة ${nowSession} · المصدر الحالي ${srcSession} عند ${new Date(currentTs).toLocaleString('ar-SA')}`;
      const trainingText=sourceMeta.trainingEligible?'Training Eligible':'Research Only / Not Training Eligible';
      $('#integrityLog').innerHTML=`<div class="log-item">Data Route: ${esc(p.origin)} · enrichment ${esc(e.origin)} · history ${esc(h.origin)}</div><div class="log-item">Freshness: ${timeFresh?'PASS':'FAIL'} · عمر اللقطة ${ageMinutes.toFixed(1)} دقيقة · الحد ${TAG500_FRESHNESS_MINUTES} دقيقة</div><div class="log-item">Session Alignment: ${aligned?'PASS':'FAIL'} · current ${esc(nowSession)} · source ${esc(srcSession)}${aligned?'':' · حجب تنفيذي حتى تتطابق الجلسة'}</div><div class="log-item">Sharia Gate: VERIFIED فقط للترتيب التنفيذي · UNVERIFIED = Research Only · EXCLUDED = مستبعد</div><div class="log-item">Final Snapshot Reconciliation: ${esc(rec.state)} · مصادر مستقلة: ${rec.independentSourceCount} · ${trainingText}</div>`;
    }catch(err){
      rows=[];analyzed=[];
      sourceMeta={name:'none',updated:null,warnings:[err.message],ageMinutes:null,fresh:false,reconciliation:'NO_DATA',independentSourceCount:0,trainingEligible:false,dataOrigin:'failed'};
      render();
      status.className='connector-status err';
      status.textContent='فشل تحميل البيانات الحية: '+err.message;
      $('#dataBadge').textContent='● البيانات: FAIL-CLOSED';
      $('#integrityLog').innerHTML='<div class="log-item warn">DATA ROUTE FAILURE: '+esc(err.message)+'</div><div class="log-item">لم يتم استخدام بيانات بديلة أو اصطناعية.</div>';
    }
  };
})();