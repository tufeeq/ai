'use strict';
(function(){
  const RELEASE='TAG565';
  const EARLY_MAX=20;
  const state=()=>window.TAG500State||{};
  const meta=()=>window.sourceMeta||state().sourceMeta||{};
  const analyzed=()=>Array.isArray(window.analyzed)?window.analyzed:(Array.isArray(state().analyzed)?state().analyzed:[]);
  const rows=()=>Array.isArray(window.rows)?window.rows:(Array.isArray(state().rows)?state().rows:[]);
  const ticker=x=>String(x.ticker||x.Ticker||x.symbol||x.Symbol||'').toUpperCase();
  const num=v=>{const n=Number(String(v??'').replace('%','').replace(',',''));return Number.isFinite(n)?n:null;};
  function originBucket(x){return String(x.firstObservedBucket||x._firstObservedBucket||x.firstSessionObservedBucket||x._firstSessionObservedBucket||'').toUpperCase();}
  function originPct(x){for(const v of [x.firstObservedChange,x._firstObservedChange,x.firstSessionObservedChange,x._firstSessionObservedChange,x.originChangePct]){const n=num(v);if(n!==null)return n;}return null;}
  function currentBucket(){return String(meta().sessionBucket||meta().bucket||'').toUpperCase();}
  function isPremarket(){return String(meta().session||'').toLowerCase().includes('pre')||/^PM\d+$/.test(currentBucket());}
  function classify(x){
    const b=originBucket(x),p=originPct(x);
    if(!b||p===null)return'UNKNOWN';
    if(b==='PM1')return p>=EARLY_MAX?'COLD_START_LATE':'PM1_BASELINE_EARLY';
    if(/^PM\d+$/.test(b))return p<EARLY_MAX?'POST_PM1_EARLY_ENTRY':'POST_PM1_LATE_ENTRY';
    return'OTHER';
  }
  function build(){
    const src=analyzed().length?analyzed():rows();
    const counts={COLD_START_LATE:0,PM1_BASELINE_EARLY:0,POST_PM1_EARLY_ENTRY:0,POST_PM1_LATE_ENTRY:0,UNKNOWN:0,OTHER:0};
    const items=[];
    src.forEach(x=>{const c=classify(x);counts[c]=(counts[c]||0)+1;items.push({ticker:ticker(x),class:c,originBucket:originBucket(x),originPct:originPct(x)});});
    const measurable=counts.POST_PM1_EARLY_ENTRY+counts.POST_PM1_LATE_ENTRY;
    const cohortEarlyRate=measurable?counts.POST_PM1_EARLY_ENTRY/measurable:null;
    return {release:RELEASE,bucket:currentBucket(),premarket:isPremarket(),total:src.length,counts,measurable,cohortEarlyRate,earlyEntrants:items.filter(x=>x.class==='POST_PM1_EARLY_ENTRY').sort((a,b)=>(a.originPct??999)-(b.originPct??999)).slice(0,8),lateEntrants:items.filter(x=>x.class==='POST_PM1_LATE_ENTRY').sort((a,b)=>(b.originPct??-999)-(a.originPct??-999)).slice(0,8),diagnosticOnly:true,trainingEligible:false};
  }
  function chips(list){return list.map(x=>`<span class="release-chip">${x.ticker} · ${x.originBucket} · ${x.originPct>=0?'+':''}${x.originPct.toFixed(1)}%</span>`).join('');}
  function render(){
    const d=build();window.TAG500PremarketEntryCohort=d;
    let host=document.getElementById('premarketEntryCohort565');const dataPanel=document.getElementById('data');
    if(!host&&dataPanel){host=document.createElement('section');host.id='premarketEntryCohort565';host.className='panel';dataPanel.parentNode.insertBefore(host,dataPanel);}
    if(!host)return;
    if(!d.premarket||d.bucket==='PM1'){host.style.display='none';return;}host.style.display='block';
    const rate=d.cohortEarlyRate===null?'—':`${(d.cohortEarlyRate*100).toFixed(0)}%`;
    host.innerHTML=`<div class="section-head"><div><h3>تدقيق دخول الكون بعد PM1</h3><p>يفصل بين الأسهم التي دخلت TAG لأول مرة بعد لقطة البداية وهي ما تزال تحت +${EARLY_MAX}%، وبين الأسهم التي لم تدخل الكون إلا بعد أن أصبحت الحركة متأخرة. هذا مقياس تغطية للكون، وليس Early-Capture النهائي.</p></div></div><div class="release-meta"><span class="release-chip">Bucket: ${d.bucket||'—'}</span><span class="release-chip">New-entry measurable: ${d.measurable}</span><span class="release-chip">دخلت &lt;+20%: ${d.counts.POST_PM1_EARLY_ENTRY}</span><span class="release-chip">دخلت ≥+20%: ${d.counts.POST_PM1_LATE_ENTRY}</span><span class="release-chip">Cohort early-entry rate: ${rate}</span></div>${d.earlyEntrants.length?`<p class="release-note"><strong>دخول مبكر بعد PM1:</strong></p><div class="release-meta">${chips(d.earlyEntrants)}</div>`:''}${d.lateEntrants.length?`<p class="release-note"><strong>Universe Late Entry:</strong></p><div class="release-meta">${chips(d.lateEntrants)}</div>`:''}<p class="release-note">إذا ارتفعت Universe Late Entry عبر عدة buckets وجلسات، فالمشكلة الأساسية في مصادر اكتشاف الكون قبل الحركة وليست في threshold الترتيب. لا تستخدم هذه النسبة كحقيقة تدريبية قبل Final Snapshot Reconciliation.</p>`;
  }
  const prior=window.render;if(typeof prior==='function')window.render=function(){const out=prior.apply(this,arguments);try{render();}catch(e){}return out;};
  document.addEventListener('tag500:state-final',render);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(render,0));else setTimeout(render,0);
})();
