'use strict';
(function(){
  const RELEASE='TAG565';
  const LATE_ORIGIN_PCT=20;
  const state=()=>window.TAG500State||{};
  const meta=()=>window.sourceMeta||state().sourceMeta||{};
  const analyzed=()=>Array.isArray(window.analyzed)?window.analyzed:(Array.isArray(state().analyzed)?state().analyzed:[]);
  const rows=()=>Array.isArray(window.rows)?window.rows:(Array.isArray(state().rows)?state().rows:[]);
  const ticker=x=>String(x.ticker||x.Ticker||x.symbol||x.Symbol||'').toUpperCase();
  const num=v=>{const n=Number(String(v??'').replace('%','').replace(',',''));return Number.isFinite(n)?n:null;};
  function bucket(){return String(meta().sessionBucket||meta().bucket||'').toUpperCase();}
  function isPremarket(){return String(meta().session||'').toLowerCase().includes('pre')||/^PM\d+$/.test(bucket());}
  function originBucket(x){return String(x.firstObservedBucket||x._firstObservedBucket||x.firstSessionObservedBucket||x._firstSessionObservedBucket||'').toUpperCase();}
  function originPct(x){for(const v of [x.firstObservedChange,x._firstObservedChange,x.firstSessionObservedChange,x._firstSessionObservedChange,x.originChangePct]){const n=num(v);if(n!==null)return n;}return null;}
  function classify(x){const b=originBucket(x),p=originPct(x);if(!b||p===null)return'UNKNOWN';if(b==='PM1')return p>=LATE_ORIGIN_PCT?'COLD_START_LATE':'PM1_BASELINE_EARLY';if(/^PM\d+$/.test(b))return p<LATE_ORIGIN_PCT?'POST_PM1_EARLY_ENTRY':'POST_PM1_LATE_ENTRY';return'OTHER';}
  function build(){
    const src=analyzed().length?analyzed():rows();
    const counts={COLD_START_LATE:0,PM1_BASELINE_EARLY:0,POST_PM1_EARLY_ENTRY:0,POST_PM1_LATE_ENTRY:0,UNKNOWN:0,OTHER:0};
    const items=[];
    src.forEach(x=>{const c=classify(x);counts[c]=(counts[c]||0)+1;items.push({ticker:ticker(x),class:c,originBucket:originBucket(x),originPct:originPct(x)});});
    const measurable=counts.POST_PM1_EARLY_ENTRY+counts.POST_PM1_LATE_ENTRY;
    return {release:RELEASE,bucket:bucket(),premarket:isPremarket(),total:src.length,counts,measurable,cohortEarlyRate:measurable?counts.POST_PM1_EARLY_ENTRY/measurable:null,lateTickers:items.filter(x=>x.class==='COLD_START_LATE').slice(0,8),earlyEntrants:items.filter(x=>x.class==='POST_PM1_EARLY_ENTRY').sort((a,b)=>(a.originPct??999)-(b.originPct??999)).slice(0,8),lateEntrants:items.filter(x=>x.class==='POST_PM1_LATE_ENTRY').sort((a,b)=>(b.originPct??-999)-(a.originPct??-999)).slice(0,8),evaluationEligible:bucket()!=='PM1',diagnosticOnly:true,trainingEligible:false};
  }
  const chips=list=>list.map(x=>`<span class="release-chip">${x.ticker} · ${x.originBucket||'—'} · ${x.originPct>=0?'+':''}${Number(x.originPct).toFixed(1)}%</span>`).join('');
  function render(){
    const d=build();window.TAG500PremarketColdStart=d;window.TAG500PremarketEntryCohort=d;
    let host=document.getElementById('coldStartGate564');const dataPanel=document.getElementById('data');
    if(!host&&dataPanel){host=document.createElement('section');host.id='coldStartGate564';host.className='panel';dataPanel.parentNode.insertBefore(host,dataPanel);}if(!host)return;
    if(!d.premarket){host.style.display='none';return;}host.style.display='block';
    if(d.bucket==='PM1'){
      host.innerHTML=`<div class="section-head"><div><h3>بوابة بداية ما قبل الافتتاح · Cold Start</h3><p>PM1 هي baseline. الأسهم التي وصلت أول لقطة وهي أصلًا ≥ ${LATE_ORIGIN_PCT}% تُصنف Overnight/Cold-Start Late Origin ولا تُحسب missed movers على TAG500.</p></div></div><div class="release-meta"><span class="release-chip">PM1 total: ${d.total}</span><span class="release-chip">Origin &lt;20%: ${d.counts.PM1_BASELINE_EARLY}</span><span class="release-chip">Cold-start ≥20%: ${d.counts.COLD_START_LATE}</span><span class="release-chip">Unknown: ${d.counts.UNKNOWN}</span></div>${d.lateTickers.length?`<div class="release-meta" style="margin-top:8px">${chips(d.lateTickers)}</div>`:''}<p class="release-note">PM1 لا تقيس قدرة TAG على اكتشاف حركة بدأت قبل فتح نافذة الرصد.</p>`;
      return;
    }
    const rate=d.cohortEarlyRate===null?'—':`${(d.cohortEarlyRate*100).toFixed(0)}%`;
    host.innerHTML=`<div class="section-head"><div><h3>Premarket Entry Cohort Audit</h3><p>بعد PM1، يفصل TAG565 بين الأسهم التي دخلت الكون لأول مرة وهي ما تزال تحت +${LATE_ORIGIN_PCT}% وبين الأسهم التي لم تدخل إلا بعد أن أصبحت الحركة متأخرة.</p></div></div><div class="release-meta"><span class="release-chip">Bucket: ${d.bucket||'—'}</span><span class="release-chip">New-entry measurable: ${d.measurable}</span><span class="release-chip">دخلت &lt;+20%: ${d.counts.POST_PM1_EARLY_ENTRY}</span><span class="release-chip">Universe Late Entry ≥+20%: ${d.counts.POST_PM1_LATE_ENTRY}</span><span class="release-chip">Cohort early-entry: ${rate}</span></div>${d.earlyEntrants.length?`<p class="release-note"><strong>دخول مبكر بعد PM1:</strong></p><div class="release-meta">${chips(d.earlyEntrants)}</div>`:''}${d.lateEntrants.length?`<p class="release-note"><strong>دخلت الكون متأخرة:</strong></p><div class="release-meta">${chips(d.lateEntrants)}</div>`:''}<p class="release-note">المقياس تشخيصي intraperiod فقط. ارتفاع Universe Late Entry يعني أن عنق الزجاجة في مصادر universe discovery، لا في threshold الترتيب. لا يتحول إلى training truth قبل Final Snapshot Reconciliation.</p>`;
  }
  const prior=window.render;if(typeof prior==='function')window.render=function(){const out=prior.apply(this,arguments);try{render();}catch(e){}return out;};
  document.addEventListener('tag500:state-final',render);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(render,0));else setTimeout(render,0);
})();
