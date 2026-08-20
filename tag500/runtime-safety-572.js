'use strict';
(()=>{
  const RELEASE='TAG572';
  const runtime={release:RELEASE,ok:true,critical:[],warnings:[],lastEventAt:null,renderBound:false,renderBoundaryRevision:0,lastBoundaryAt:null};
  const now=()=>new Date().toISOString();
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function ownedScript(src){return /\/tag500\//.test(String(src||''));}
  function remember(kind,message,source,stack){
    const item={kind,message:String(message||'Unknown runtime error'),source:String(source||''),stack:String(stack||'').slice(0,1200),at:now()};
    const list=kind==='warning'?runtime.warnings:runtime.critical;
    const key=item.kind+'|'+item.message+'|'+item.source;
    if(!list.some(x=>(x.kind+'|'+x.message+'|'+x.source)===key)) list.unshift(item);
    list.splice(12);
    runtime.lastEventAt=item.at;
    runtime.ok=runtime.critical.length===0;
    paint();
    try{window.dispatchEvent(new CustomEvent('tag500:runtime-safety',{detail:{ok:runtime.ok,critical:runtime.critical.slice(-10),item}}));}catch(_){ }
  }
  window.TAG500RuntimeSafety=runtime;
  window.addEventListener('error',e=>{
    const target=e.target;
    if(target&&target.tagName==='SCRIPT'&&ownedScript(target.src)){
      remember('error','فشل تحميل ملف تشغيل TAG500',target.src,'SCRIPT_LOAD_ERROR');
      return;
    }
    if(e.error||e.message) remember('error',e.message||e.error?.message||'JavaScript error',e.filename||'runtime',e.error?.stack||'');
  },true);
  window.addEventListener('unhandledrejection',e=>{
    const r=e.reason;
    const msg=String(r?.message||r||'Unhandled promise rejection');
    const stack=String(r?.stack||'');
    if(/network|fetch|failed to fetch|load failed|http\s+\d+/i.test(msg)) remember('warning',msg,'promise/network',stack);
    else remember('error',msg,'promise',stack);
  });
  function paint(){
    const host=document.querySelector('#integrityLog');
    if(!host)return;
    let panel=host.querySelector('[data-runtime-safety]');
    if(!panel){panel=document.createElement('div');panel.dataset.runtimeSafety='1';panel.className='log-entry';host.prepend(panel);}
    const status=runtime.critical.length?'FAIL-CLOSED':runtime.warnings.length?'تحذير':'سليم';
    const cls=runtime.critical.length?'bad':runtime.warnings.length?'warn':'ok';
    const latest=[...runtime.critical,...runtime.warnings].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0];
    panel.innerHTML=`<b class="${cls}">Runtime Safety · ${status}</b><small>${runtime.renderBound?'Render Boundary ✓':'Render Boundary: جارٍ الربط'} · إعادة ربط ${runtime.renderBoundaryRevision}${latest?` · ${esc(latest.message)}`:''}</small>`;
  }
  function wrapOutermost(){
    const current=window.render;
    if(typeof current!=='function') return false;
    if(current.__tag500RuntimeBoundary===runtime){runtime.renderBound=true;paint();return true;}
    const base=current;
    function guardedRender(){
      try{
        const out=base.apply(this,arguments);
        paint();
        return out;
      }catch(err){
        remember('error',err?.message||String(err),'render/outermost',err?.stack||'');
        paint();
        throw err;
      }
    }
    Object.defineProperty(guardedRender,'__tag500RuntimeBoundary',{value:runtime,configurable:false});
    Object.defineProperty(guardedRender,'__tag500RuntimeBase',{value:base,configurable:false});
    window.render=guardedRender;
    runtime.renderBound=true;
    runtime.renderBoundaryRevision+=1;
    runtime.lastBoundaryAt=now();
    paint();
    try{window.dispatchEvent(new CustomEvent('tag500:runtime-boundary-ready',{detail:{release:RELEASE,revision:runtime.renderBoundaryRevision}}));}catch(_){ }
    return true;
  }
  runtime.ensureRenderBoundary=wrapOutermost;
  let stable=0,attempts=0;
  const timer=setInterval(()=>{
    attempts+=1;
    const before=window.render;
    const ok=wrapOutermost();
    const after=window.render;
    if(ok&&before===after&&after?.__tag500RuntimeBoundary===runtime) stable+=1; else stable=0;
    if(stable>=6||attempts>=80){
      clearInterval(timer);
      if(!runtime.renderBound&&document.readyState==='complete') remember('error','تعذر ربط حد أمان render النهائي','runtime-safety','RENDER_BOUNDARY_NOT_ATTACHED');
    }
  },50);
  const rebind=()=>{stable=0;wrapOutermost();};
  ['tag500:runtime-ready','tag500:state-ready','tag500:state-final'].forEach(name=>window.addEventListener(name,rebind));
  window.addEventListener('load',()=>{wrapOutermost();setTimeout(wrapOutermost,0);});
  queueMicrotask(wrapOutermost);
  setTimeout(wrapOutermost,0);
  setTimeout(wrapOutermost,250);
  paint();
})();
