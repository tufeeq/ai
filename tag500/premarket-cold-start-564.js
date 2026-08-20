'use strict';
(function(){
  const RELEASE='TAG564';
  const LATE_ORIGIN_PCT=20;
  const state=()=>window.TAG500State||{};
  const meta=()=>window.sourceMeta||state().sourceMeta||{};
  const analyzed=()=>Array.isArray(window.analyzed)?window.analyzed:(Array.isArray(state().analyzed)?state().analyzed:[]);
  const rows=()=>Array.isArray(window.rows)?window.rows:(Array.isArray(state().rows)?state().rows:[]);
  function isPM1(){
    const m=meta();
    const bucket=String(m.sessionBucket||m.bucket||'').toUpperCase();
    const session=String(m.session||'').toLowerCase();
    return bucket==='PM1'||(session.includes('pre')&&String(m.cadenceStatus||'').toUpperCase()==='INITIAL');
  }
  function originPct(x){
    const candidates=[x.firstObservedChange,x._firstObservedChange,x.firstSessionObservedChange,x.originChangePct,x.changePct];
    for(const v of candidates){
      const n=Number(String(v??'').replace('%','').replace(',',''));
      if(Number.isFinite(n)) return n;
    }
    return null;
  }
  function ticker(x){return String(x.ticker||x.Ticker||x.symbol||x.Symbol||'').toUpperCase();}
  function build(){
    const a=analyzed(); const r=rows(); const src=a.length?a:r;
    const cold=isPM1();
    const late=src.filter(x=>{const p=originPct(x);return Number.isFinite(p)&&p>=LATE_ORIGIN_PCT;});
    const early=src.filter(x=>{const p=originPct(x);return Number.isFinite(p)&&p<LATE_ORIGIN_PCT;});
    const unknown=src.filter(x=>!Number.isFinite(originPct(x)));
    return {release:RELEASE,coldStart:cold,total:src.length,lateOrigins:late.length,earlyOrigins:early.length,unknownOrigins:unknown.length,lateTickers:late.slice(0,8).map(x=>({ticker:ticker(x),originPct:originPct(x)})),evaluationEligible:!cold};
  }
  function render(){
    const d=build();
    window.TAG500PremarketColdStart=d;
    let host=document.getElementById('coldStartGate564');
    const dataPanel=document.getElementById('data');
    if(!host&&dataPanel){
      host=document.createElement('section'); host.id='coldStartGate564'; host.className='panel';
      dataPanel.parentNode.insertBefore(host,dataPanel);
    }
    if(!host) return;
    if(!d.coldStart){host.style.display='none';return;}
    host.style.display='block';
    const late=d.lateTickers.map(x=>`<span class="release-chip">${x.ticker} ${x.originPct>=0?'+':''}${x.originPct.toFixed(1)}%</span>`).join('');
    host.innerHTML=`<div class="section-head"><div><h3>بوابة بداية ما قبل الافتتاح · Cold Start</h3><p>PM1 هي أول لقطة بعد فتح pre-market، لذلك الأسهم التي وصلت إليها وهي أصلًا ≥ ${LATE_ORIGIN_PCT}% تُصنف Overnight/Cold-Start Late Origin ولا تُحسب missed movers على نموذج TAG500.</p></div></div><div class="release-meta"><span class="release-chip">PM1 total: ${d.total}</span><span class="release-chip">Origin &lt;20%: ${d.earlyOrigins}</span><span class="release-chip">Cold-start ≥20%: ${d.lateOrigins}</span><span class="release-chip">Unknown: ${d.unknownOrigins}</span></div>${late?`<div class="release-meta" style="margin-top:8px">${late}</div>`:''}<p class="release-note">التقييم اللحظي للاكتشاف المبكر يبدأ من اللقطات التالية المتصلة. هذه البوابة لا تغيّر score أو Actionability ولا تحول PM1 إلى training truth.</p>`;
  }
  const prior=window.render;
  if(typeof prior==='function') window.render=function(){const out=prior.apply(this,arguments);try{render();}catch(e){}return out;};
  document.addEventListener('tag500:state-final',render);
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(render,0)); else setTimeout(render,0);
})();
