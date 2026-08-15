'use strict';
(function(){
  const BUILD='TAG519';
  let mode='EXECUTIVE';
  function actionCode(z){return z?.actionability?.code||'X';}
  function visible(z){
    if(mode==='RESEARCH') return true;
    return z?.valid===true && z?.sharia==='VERIFIED' && ['A','B'].includes(actionCode(z));
  }
  function ensureSessionClock(){
    if(window.TAG500SessionClock||document.querySelector('script[data-tag519-session]')) return;
    const s=document.createElement('script');
    s.src='../tag500/session-state-519.js?v=519';s.dataset.tag519Session='1';document.head.appendChild(s);
  }
  function paintVersion(){
    const b=document.querySelector('#versionBadge');if(b)b.textContent=BUILD;
    const f=document.querySelector('footer strong');if(f)f.textContent=BUILD;
    document.title='TAG519 — منصة TAG500';
    const summary=document.querySelector('.release-box summary');if(summary)summary.textContent='سجل الإصدار · TAG519';
    const note=document.querySelector('.release-note');if(note&&note.closest('.release-box'))note.textContent='TAG519: Session-aware Final Close UX يميز intraperiod snapshots عن Final AH Close Candidate بعد 8:00 ET، ويُبقي اللقطة Research Only حتى Final Snapshot Reconciliation من مصدرين مستقلين على الأقل. Executive/Research Mode كما في TAG518، ولا تغيير في thresholds أو ادعاء أداء غير مثبت.';
  }
  function ensureControls(){
    const row=document.querySelector('.control-row');
    if(!row||document.querySelector('#viewMode518')) return;
    const wrap=document.createElement('label');
    wrap.innerHTML='وضع العرض<select id="viewMode518"><option value="EXECUTIVE">تنفيذي — فرص مؤهلة فقط</option><option value="RESEARCH">بحث — جميع الحالات</option></select>';
    row.prepend(wrap);
    const s=document.querySelector('#shariaFilter');
    if(s) s.value='VERIFIED';
  }
  function apply(){
    paintVersion();ensureSessionClock();ensureControls();
    const select=document.querySelector('#viewMode518');
    if(select) mode=select.value||mode;
    const map=new Map((window.analyzed||[]).map(z=>[z.ticker,z]));
    const body=document.querySelector('#scannerBody');
    if(body){
      let shown=0;
      for(const tr of body.querySelectorAll('tr[data-ticker]')){
        const z=map.get(tr.dataset.ticker);
        const show=mode==='RESEARCH'||visible(z);
        tr.hidden=!show;
        if(show) shown++;
      }
      let note=document.querySelector('#view518Note');
      if(!note){
        note=document.createElement('div');note.id='view518Note';note.className='release-note';note.style.margin='8px 0 0';
        body.closest('.table-panel')?.querySelector('.section-head')?.appendChild(note);
      }
      if(note){
        const total=(window.analyzed||[]).length;
        note.innerHTML=mode==='EXECUTIVE'
          ? `<strong>Executive Mode:</strong> يعرض فقط VERIFIED + A/B. ظاهر ${shown} من ${total}. انتقل إلى Research Mode لرؤية الحالات المحجوبة والمتأخرة وغير المتحققة.`
          : `<strong>Research Mode:</strong> يعرض جميع الحالات للبحث والتدقيق؛ الحالات غير المؤهلة لا تصبح فرصًا تنفيذية تلقائيًا.`;
      }
    }
    const top=document.querySelector('#topOpportunity');
    if(top) top.dataset.viewMode=mode;
  }
  function bind(){
    ensureControls();paintVersion();ensureSessionClock();
    const s=document.querySelector('#viewMode518');
    if(s&&!s.dataset.bound518){
      s.dataset.bound518='1';
      s.addEventListener('change',()=>{mode=s.value;apply();});
    }
    apply();
  }
  const baseRender=window.render;
  if(typeof baseRender==='function') window.render=function(){baseRender();queueMicrotask(bind);};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind); else bind();
  window.TAG500ViewMode={build:BUILD,getMode:()=>mode,setMode:(m)=>{mode=m==='RESEARCH'?'RESEARCH':'EXECUTIVE';const s=document.querySelector('#viewMode518');if(s)s.value=mode;apply();}};
})();