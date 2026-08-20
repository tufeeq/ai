'use strict';
(function(){
  const state={ok:true,critical:[],warnings:[],lastEventAt:null};
  function now(){return new Date().toISOString();}
  function text(v){return String(v||'').slice(0,500);}
  function moduleName(src){try{const u=new URL(src,location.href);return u.pathname.split('/').pop()||u.pathname;}catch(_){return text(src);}}
  function publish(){
    state.ok=state.critical.length===0;
    state.lastEventAt=now();
    window.TAG500RuntimeSafety={ok:state.ok,critical:state.critical.slice(-10),warnings:state.warnings.slice(-10),lastEventAt:state.lastEventAt};
    window.dispatchEvent(new CustomEvent('tag500:runtime-safety',{detail:window.TAG500RuntimeSafety}));
    window.dispatchEvent(new Event('tag500:runtime-ready'));
    paint();
  }
  function push(kind,entry){
    const arr=kind==='critical'?state.critical:state.warnings;
    const sig=JSON.stringify(entry);
    if(!arr.some(x=>JSON.stringify(x)===sig))arr.push(entry);
    if(arr.length>20)arr.splice(0,arr.length-20);
    publish();
  }
  function isOwned(src){const s=text(src);return /\/tag500\/|\/tag\/(app|data-fix|tag)/i.test(s);}
  function paint(){
    const log=document.querySelector('#integrityLog');
    if(!log)return;
    let row=document.querySelector('#runtime571Safety');
    if(!row){row=document.createElement('div');row.id='runtime571Safety';row.className='log-item';log.appendChild(row);}
    if(state.critical.length){
      const last=state.critical[state.critical.length-1];
      row.innerHTML=`<strong>Runtime Safety: FAIL-CLOSED</strong> · ${state.critical.length} خطأ تشغيلي حرج · ${text(last.message||last.module||last.type)}. Executive Mode محجوب حتى إعادة تحميل runtime سليمة.`;
    }else if(state.warnings.length){
      row.innerHTML=`<strong>Runtime Safety: OK</strong> · لا أخطاء حرجة · ${state.warnings.length} تحذير غير حرج مسجل.`;
    }else{
      row.innerHTML='<strong>Runtime Safety: OK</strong> · لم تُرصد أخطاء JavaScript أو ملفات runtime مفقودة.';
    }
  }
  window.addEventListener('error',function(e){
    const target=e.target;
    if(target&&target!==window){
      const src=target.src||target.href||'';
      if(target.tagName==='SCRIPT'&&isOwned(src))push('critical',{type:'SCRIPT_LOAD_ERROR',module:moduleName(src),message:'فشل تحميل ملف runtime'});
      return;
    }
    const src=e.filename||'';
    if(isOwned(src))push('critical',{type:'RUNTIME_EXCEPTION',module:moduleName(src),message:text(e.message),line:e.lineno||null,col:e.colno||null});
  },true);
  window.addEventListener('unhandledrejection',function(e){
    const reason=e.reason;
    const stack=text(reason?.stack||reason?.message||reason);
    const critical=/\/tag500\/|\/tag\/(app|data-fix|tag)/i.test(stack)&&!/fetch|network|http/i.test(stack);
    push(critical?'critical':'warning',{type:'UNHANDLED_REJECTION',message:text(reason?.message||reason||'Unhandled promise rejection')});
  });
  const baseRender=window.render;
  if(typeof baseRender==='function'){
    window.render=function(){
      baseRender.apply(this,arguments);
      queueMicrotask(function(){
        paint();
        if(state.critical.length&&window.TAG500ExecutiveView?.getMode?.()==='EXECUTIVE'){
          const top=document.querySelector('#topOpportunity');
          if(top){top.classList.add('empty');top.textContent='تم حجب الفرص التنفيذية: خطأ runtime حرج. راجع سلامة البيانات ثم أعد تحميل الصفحة.';}
          document.querySelectorAll('#scannerBody tr[data-ticker]').forEach(tr=>{tr.hidden=true;});
        }
      });
    };
  }
  window.TAG500RuntimeSafety={ok:true,critical:[],warnings:[],lastEventAt:null};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',paint);else paint();
})();