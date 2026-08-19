'use strict';
(function(){
  const BUILD='TAG552';
  const URL='https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/enrichment.json';
  const SECONDARY_FRESH_MIN=20;
  let secondary={updatedAt:null,rows:{},status:'LOADING',error:null};
  let inflight=null;

  function n(v){
    if(v===null||v===undefined||v==='') return null;
    const x=Number(String(v).replace(/[$,%\s,]/g,''));
    return Number.isFinite(x)?x:null;
  }
  function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
  function pct(v){return Number.isFinite(v)?v.toFixed(1)+'%':'—';}
  function band(divergence,lag){
    if(!Number.isFinite(divergence)) return 'UNAVAILABLE';
    if(Number.isFinite(lag)&&lag>SECONDARY_FRESH_MIN) return 'STALE_SECONDARY';
    // Diagnostic bands only. They do not block execution or alter scoring.
    if(divergence>5) return 'MATERIAL';
    if(divergence>2) return 'WATCH';
    return 'CONSISTENT';
  }
  function label(code){return {CONSISTENT:'متقارب',WATCH:'راقب الفرق',MATERIAL:'اختلاف مادي',STALE_SECONDARY:'Yahoo قديم',UNAVAILABLE:'غير متاح'}[code]||code;}
  function cls(code){return code==='MATERIAL'?'neg':code==='CONSISTENT'?'pos':'';}

  function measure(z){
    const e=secondary.rows?.[z?.ticker];
    const y=e?.price||null;
    const yahooPrice=n(y?.last);
    const finvizPrice=n(z?.price);
    const yahooChange=n(y?.changePct);
    const finvizChange=n(z?.changePct);
    const yTs=Date.parse(y?.timestampUTC||'');
    const fTs=window.sourceMeta?.updated instanceof Date?window.sourceMeta.updated.getTime():Date.parse(window.sourceMeta?.updated||'');
    const lag=Number.isFinite(yTs)&&Number.isFinite(fTs)?Math.abs(fTs-yTs)/60000:null;
    const mid=Number.isFinite(finvizPrice)&&Number.isFinite(yahooPrice)&&(finvizPrice+yahooPrice)!==0?(Math.abs(finvizPrice)+Math.abs(yahooPrice))/2:null;
    const divergence=Number.isFinite(mid)&&mid>0?Math.abs(finvizPrice-yahooPrice)/mid*100:null;
    const changeDelta=Number.isFinite(yahooChange)&&Number.isFinite(finvizChange)?Math.abs(finvizChange-yahooChange):null;
    const code=band(divergence,lag);
    return {code,finvizPrice,yahooPrice,divergencePct:divergence,changeDeltaPctPts:changeDelta,lagMinutes:lag,yahooTimestamp:Number.isFinite(yTs)?yTs:null,diagnosticOnly:true};
  }

  async function refreshSecondary(){
    if(inflight) return inflight;
    inflight=(async()=>{
      try{
        const r=await fetch(URL+(URL.includes('?')?'&':'?')+'ts='+Date.now(),{cache:'no-store'});
        if(!r.ok) throw new Error('HTTP '+r.status);
        const p=await r.json();
        secondary={updatedAt:p.updatedAt||null,rows:p.rows||{},status:'OK',error:null};
      }catch(e){
        secondary={updatedAt:null,rows:{},status:'ERROR',error:e.message};
      }finally{inflight=null;}
      if(Array.isArray(window.rows)&&window.rows.length&&typeof window.render==='function') window.render();
      return secondary;
    })();
    return inflight;
  }

  const baseAnalyze=window.analyze;
  if(typeof baseAnalyze==='function') window.analyze=function(x){
    const z=baseAnalyze(x);
    const c=measure(z);
    z.liveSourceConsistency=c;
    if(c.code==='MATERIAL') z.reasons=(z.reasons||[]).concat(`اختلاف سعري حي Finviz↔Yahoo ${pct(c.divergencePct)} — تشخيص فقط`);
    return z;
  };

  function ensureColumn(){
    const table=document.querySelector('.table-panel table');
    const head=table?.querySelector('thead tr');
    if(!head) return;
    if(!head.querySelector('th[data-source-consistency]')){
      const th=document.createElement('th');th.dataset.sourceConsistency='1';th.textContent='اتساق المصدر';head.appendChild(th);
    }
    const map=new Map((window.analyzed||[]).map(z=>[z.ticker,z]));
    for(const tr of table.querySelectorAll('tbody tr[data-ticker]')){
      let td=tr.querySelector('td[data-source-consistency]');
      if(!td){td=document.createElement('td');td.dataset.sourceConsistency='1';tr.appendChild(td);}
      const c=map.get(tr.dataset.ticker)?.liveSourceConsistency;
      if(!c){td.textContent='—';continue;}
      td.className=cls(c.code);
      td.title=`Finviz ${Number.isFinite(c.finvizPrice)?'$'+c.finvizPrice.toFixed(4):'—'} · Yahoo ${Number.isFinite(c.yahooPrice)?'$'+c.yahooPrice.toFixed(4):'—'} · فرق التغير ${Number.isFinite(c.changeDeltaPctPts)?c.changeDeltaPctPts.toFixed(1)+' نقطة':'—'} · فرق التوقيت ${Number.isFinite(c.lagMinutes)?c.lagMinutes.toFixed(1)+'د':'—'}`;
      td.textContent=`${label(c.code)} · ${pct(c.divergencePct)}`;
    }
  }

  function paintIntegrity(){
    const log=document.querySelector('#integrityLog');
    if(!log) return;
    document.querySelector('#sourceConsistency552')?.remove();
    const a=window.analyzed||[];
    const measured=a.filter(z=>Number.isFinite(z?.liveSourceConsistency?.divergencePct));
    const material=measured.filter(z=>z.liveSourceConsistency.code==='MATERIAL');
    const watch=measured.filter(z=>z.liveSourceConsistency.code==='WATCH');
    const stale=measured.filter(z=>z.liveSourceConsistency.code==='STALE_SECONDARY');
    const divs=measured.map(z=>z.liveSourceConsistency.divergencePct).sort((a,b)=>a-b);
    const median=divs.length?divs[Math.floor(divs.length/2)]:null;
    const item=document.createElement('div');item.id='sourceConsistency552';item.className='log-item';
    item.innerHTML=`Live Cross‑Source ${BUILD}: ${measured.length} سهم قابل للمقارنة · median فرق السعر ${pct(median)} · ${watch.length} مراقبة · ${material.length} اختلاف مادي · ${stale.length} Yahoo قديم. <strong>تشخيص فقط:</strong> لا يغيّر score/Actionability ولا يُحتسب كمصدر ثانٍ لـFinal Snapshot Reconciliation.${material.length?` أمثلة: ${material.slice(0,5).map(z=>esc(z.ticker)+' '+pct(z.liveSourceConsistency.divergencePct)).join('، ')}`:''}`;
    log.appendChild(item);
  }

  const baseRender=window.render;
  if(typeof baseRender==='function') window.render=function(){baseRender();queueMicrotask(()=>{ensureColumn();paintIntegrity();});};

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',refreshSecondary); else refreshSecondary();
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshSecondary();});
  setInterval(()=>{if(!document.hidden)refreshSecondary();},2*60*1000);
  window.TAG500SourceConsistency={build:BUILD,measure,refresh:refreshSecondary,getSecondary:()=>secondary,diagnosticOnly:true};
})();