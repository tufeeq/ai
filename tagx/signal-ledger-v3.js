'use strict';
(function(){
  const RELEASE='TAGX-0.3';
  const LEDGER='https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/tagx-signal-ledger.json';
  let ledger={tickers:{},updatedAt:null,coverageAuditStatus:'UNAVAILABLE'};
  const baseTemporal=temporal;
  const baseRender=render;
  const baseLoad=load;

  function safeNum(v){const z=Number(v);return Number.isFinite(z)?z:null}
  function ledgerPath(ticker){
    const e=ledger?.tickers?.[ticker]; if(!e)return null;
    const path=(Array.isArray(e.path)?e.path:[]).map(p=>({
      ts:Date.parse(p.timestampET||p.timestampUTC||''),
      change:safeNum(p.changePct), volume:safeNum(p.volume), price:safeNum(p.price),
      source:p.source||'ledger'
    })).filter(p=>Number.isFinite(p.ts)).sort((a,b)=>a.ts-b.ts);
    return {e,path};
  }
  function calcTemporal(x){
    const lp=ledgerPath(x.ticker);
    if(!lp||!lp.path.length)return baseTemporal(x);
    const {e,path}=lp;
    const preferred=path.filter(p=>p.source==='proactive');
    const first=preferred[0]||path[0];
    const last=path[path.length-1];
    const currentChange=Number.isFinite(x.change)?x.change:last.change;
    const origin=Number.isFinite(safeNum(e.proactiveFirstChangePct))?safeNum(e.proactiveFirstChangePct):(Number.isFinite(first.change)?first.change:x.change);
    const firstTs=Date.parse(e.proactiveFirstSeenET||e.firstSeenET||'');
    const originTs=Number.isFinite(firstTs)?firstTs:first.ts;
    const elapsedMin=Math.max((Date.now()-originTs)/60000,1);
    const pathHours=Math.max((last.ts-first.ts)/36e5,1/60);
    const slope=path.length>=2&&Number.isFinite(first.change)&&Number.isFinite(last.change)?(last.change-first.change)/pathHours:null;
    const velocity10=Number.isFinite(origin)&&Number.isFinite(currentChange)?(currentChange-origin)/(elapsedMin/10):null;
    const changes=path.map(p=>p.change).filter(Number.isFinite);
    if(Number.isFinite(currentChange))changes.push(currentChange);
    const peak=changes.length?Math.max(...changes):null;
    const retention=Number.isFinite(peak)&&peak>0&&Number.isFinite(currentChange)?clamp(currentChange/peak*100):null;
    const firstPro=preferred[0]||first;
    const volumeVelocity=Number.isFinite(x.volume)&&Number.isFinite(firstPro.volume)?Math.max(0,(x.volume-firstPro.volume)/elapsedMin):null;
    const volumeGrowth=Number.isFinite(x.volume)&&Number.isFinite(firstPro.volume)&&firstPro.volume>0?x.volume/firstPro.volume:null;
    return {origin,firstTs:originTs,slope,velocity10,retention,volumeVelocity,volumeGrowth,points:path.length,originAuthority:'SIGNAL_LEDGER_V2',originClass:e.originClass||'UNKNOWN',proactiveEver:Boolean(e.proactiveEver),moverEver:Boolean(e.moverEver)};
  }
  temporal=calcTemporal;

  function coverageLine(){
    const total=Number(ledger?.currentMoverCount||0), early=Number(ledger?.currentMoverProactiveEarlyUnder20||0), miss=Number(ledger?.currentMoverCoverageMissCount||0), late=Number(ledger?.currentMoverLateCoverageMissCount||0);
    if(!total)return '<div class="signal">Signal Ledger: ينتظر أول لقطة مشتركة؛ لا توجد نسبة تغطية قابلة للحساب بعد.</div>';
    const rate=Math.round(early/total*100);
    return `<div class="signal"><b>Universe Early Coverage (intraperiod): ${rate}%</b> · proactive &lt;20% ${early}/${total} · mover-only ${miss} · late coverage misses ${late}</div>`;
  }
  render=function(){
    baseRender();
    const h=document.querySelector('#decisionHealth');
    if(h){
      h.insertAdjacentHTML('afterbegin',coverageLine());
      h.insertAdjacentHTML('beforeend',`<div class="signal">Origin authority: ${ledger?.updatedAt?'Signal Ledger v2':'snapshots fallback'} · ${ledger?.coverageAuditStatus||'UNAVAILABLE'} · هذا القياس تشخيصي حتى Final Reconciliation.</div>`);
    }
    const badgeEl=document.querySelector('.eyebrow'); if(badgeEl)badgeEl.textContent='TAGX 0.3 · SIGNAL-LEDGER EARLY DISCOVERY';
    document.title='TAGX 0.3 — Early Discovery Engine';
  };

  async function fetchLedger(){
    try{
      const r=await fetch(LEDGER+'?v='+Date.now(),{cache:'no-store'});
      if(!r.ok)throw new Error('HTTP '+r.status);
      const p=await r.json();
      if(Number(p?.schemaVersion)!==2)throw new Error('unsupported ledger schema');
      ledger=p; state.signalLedger=p;
      return true;
    }catch(err){
      ledger={tickers:{},updatedAt:null,coverageAuditStatus:'LEDGER_UNAVAILABLE',error:String(err.message||err)};
      state.signalLedger=ledger; return false;
    }
  }
  load=async function(){await fetchLedger();return baseLoad()};
  const btn=document.querySelector('#refresh'); if(btn)btn.onclick=load;
  fetchLedger().then(()=>{if(Array.isArray(state.rows)&&state.rows.length)render()});
  window.TAGX_SIGNAL_LEDGER={release:RELEASE,get:()=>ledger};
})();
