'use strict';
(function(){
  const BUILD='TAG531';
  const VERSION_URL='../tag500/versions.json';
  let state={ok:false,ready:false,expected:BUILD,page:null,badge:null,executive:null,registry:null,error:null};

  function readIdentity(){
    const page=document.body?.dataset?.tagRelease||null;
    const badge=document.querySelector('#versionBadge')?.textContent?.trim()||null;
    const executive=window.TAG500ExecutiveView?.build||null;
    return {page,badge,executive};
  }

  function blockExecutive(reason){
    document.documentElement.dataset.releaseConsistency='blocked';
    const body=document.querySelector('#scannerBody');
    if(body) for(const tr of body.querySelectorAll('tr[data-ticker]')) tr.hidden=true;
    const top=document.querySelector('#topOpportunity');
    if(top){top.classList.add('empty');top.textContent='تم حجب الفرص التنفيذية مؤقتًا: '+reason;}
  }

  function paint(){
    const log=document.querySelector('#integrityLog');
    let item=document.querySelector('#releaseConsistency531');
    if(log&&!item){item=document.createElement('div');item.id='releaseConsistency531';item.className='log-item';log.appendChild(item);}
    if(!item)return;
    if(!state.ready){item.textContent='Release Consistency TAG531: جاري التحقق من هوية النسخة…';return;}
    if(state.ok){
      document.documentElement.dataset.releaseConsistency='ok';
      item.textContent='Release Consistency TAG531: ✓ HTML + badge + Executive runtime + versions registry متطابقة.';
    }else{
      item.classList.add('warn');
      const parts=[`HTML=${state.page||'—'}`,`Badge=${state.badge||'—'}`,`Executive=${state.executive||'—'}`,`Registry=${state.registry||'—'}`];
      if(state.error)parts.push('Error='+state.error);
      item.textContent='Release Consistency TAG531: ⚠ '+parts.join(' · ');
      blockExecutive('هوية الإصدار غير متطابقة. لا يتم عرض فرص حتى استعادة runtime متسق.');
    }
  }

  async function verify(){
    const id=readIdentity();
    state={...state,...id,ready:false,error:null};paint();
    try{
      const r=await fetch(VERSION_URL+(VERSION_URL.includes('?')?'&':'?')+'ts='+Date.now(),{cache:'no-store'});
      if(!r.ok)throw new Error('HTTP '+r.status);
      const registry=await r.json();
      state.registry=String(registry?.current||'').trim()||null;
    }catch(e){state.error=e?.message||String(e);}
    const vals=[state.page,state.badge,state.executive,state.registry];
    state.ok=!state.error&&vals.every(v=>v===BUILD);
    state.ready=true;paint();
    return {...state};
  }

  function schedule(){queueMicrotask(()=>setTimeout(verify,0));}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule);else schedule();
  window.addEventListener('focus',verify);
  window.TAG500ReleaseConsistency={build:BUILD,verify,getState:()=>({...state})};
})();