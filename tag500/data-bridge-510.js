'use strict';
(function(){
  const BUILD='TAG510';
  const MAIN='https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/';
  const LOCAL='./data/';
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
  window.TAG500_DATA_BRIDGE={build:BUILD,primary:'main',fallback:'published-branch'};
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
      const fresh=ageMinutes<=TAG500_FRESHNESS_MINUTES;
      const rec=reconciliationMeta(primary);
      mergeEnrichment(base,enrichment,currentTs);
      mergeHistorical(base,hist,sessionDateFromET(rawTs));
      volumePercentiles(base);
      rows=base;
      sourceMeta={name:'Finviz + Yahoo + session history',updated:new Date(currentTs),warnings:[],ageMinutes,fresh,reconciliation:rec.state,independentSourceCount:rec.independentSourceCount,trainingEligible:rec.trainingEligible&&fresh,dataOrigin:p.origin,enrichmentOrigin:e.origin,historyOrigin:h.origin};
      render();
      const valid=analyzed.filter(x=>x.valid).length,prev=rows.filter(x=>Number.isFinite(x.prevVolume)).length,verified=rows.filter(x=>x.sharia==='VERIFIED').length;
      $('#dataBadge').textContent=fresh?`● البيانات: ${base.length} سهم · LIVE`:`● البيانات: STALE ${ageMinutes.toFixed(0)}د`;
      $('#dataBadge').classList.toggle('connected',fresh);
      status.className=fresh?'connector-status ok':'connector-status err';
      status.textContent=`${fresh?'لقطة حية':'لقطة قديمة — الترتيب التنفيذي متوقف'} · ${base.length} سهم · ${verified} شرعي مؤكد · ${valid} صالح للترتيب · المصدر ${p.origin==='main-live'?'main/live':'fallback'} · آخر لقطة ${new Date(currentTs).toLocaleString('ar-SA')}`;
      const trainingText=sourceMeta.trainingEligible?'Training Eligible':'Research Only / Not Training Eligible';
      $('#integrityLog').innerHTML=`<div class="log-item">Data Route: ${esc(p.origin)} · enrichment ${esc(e.origin)} · history ${esc(h.origin)}</div><div class="log-item">Freshness: ${fresh?'PASS':'FAIL'} · عمر اللقطة ${ageMinutes.toFixed(1)} دقيقة · الحد ${TAG500_FRESHNESS_MINUTES} دقيقة</div><div class="log-item">Sharia Gate: VERIFIED فقط للترتيب التنفيذي · UNVERIFIED = Research Only · EXCLUDED = مستبعد</div><div class="log-item">Final Snapshot Reconciliation: ${esc(rec.state)} · مصادر مستقلة: ${rec.independentSourceCount} · ${trainingText}</div>`;
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