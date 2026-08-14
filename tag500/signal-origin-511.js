'use strict';
(function(){
  const BUILD='TAG511';
  function n(v){
    if(v===null||v===undefined||v==='') return null;
    if(typeof v==='number') return Number.isFinite(v)?v:null;
    const m=String(v).replace(/[$,%\s,]/g,'').match(/^(-?[\d.]+)/);
    return m?Number(m[1]):null;
  }
  function firstMeta(x){
    const r=x?.raw||{};
    const ts=r._firstObservedTimestampET||r._firstObservedTimestampUTC||null;
    const ch=n(r._firstObservedChange);
    const vol=n(r._firstObservedVolume);
    const session=r._firstObservedSession||null;
    const bucket=r._firstObservedBucket||null;
    const q=String(r._qualificationDecision||'UNASSESSED').toUpperCase();
    const reasons=Array.isArray(r._qualificationDecisionReasonCodes)?r._qualificationDecisionReasonCodes:[];
    return {ts,change:ch,volume:vol,session,bucket,qualification:q,qualificationReasons:reasons};
  }
  function originClass(m){
    if(!Number.isFinite(m.change)) return 'UNKNOWN';
    if(m.change<8) return 'EARLY';
    if(m.change<20) return 'FORMING';
    if(m.change<40) return 'LATE';
    return 'VERY_LATE';
  }
  function label(c){return {EARLY:'مبكر',FORMING:'يتكوّن',LATE:'متأخر',VERY_LATE:'متأخر جدًا',UNKNOWN:'غير معروف'}[c]||c;}
  function fmtTime(ts){
    const d=Date.parse(ts||''); if(!Number.isFinite(d)) return '—';
    return new Intl.DateTimeFormat('ar-SA',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'}).format(new Date(d))+' ET';
  }
  const baseAnalyze=window.analyze;
  if(typeof baseAnalyze==='function') window.analyze=function(x){
    const z=baseAnalyze(x),m=firstMeta(z),c=originClass(m);
    z.signalOrigin={...m,class:c};
    const observedLate=c==='LATE'||c==='VERY_LATE';
    if(observedLate){
      z.discoveryCredit=false;
      if(z.stage==='DISCOVERY'||z.stage==='IGNITION') z.stage='LATE';
      z.reasons.unshift(`أول ظهور ${label(c)} عند ${Number.isFinite(m.change)?m.change.toFixed(1)+'%':'—'}`);
    } else if(c==='EARLY') {
      z.reasons.push(`أول ظهور مبكر عند ${m.change.toFixed(1)}%`);
    }
    z.centralFirstSeenVerified=Boolean(m.ts&&Number.isFinite(m.change));
    return z;
  };
  const baseRender=window.render;
  if(typeof baseRender==='function') window.render=function(){
    baseRender();
    const head=document.querySelector('.table-panel thead tr');
    if(head&&!head.querySelector('[data-origin511]')){
      const th=document.createElement('th'); th.dataset.origin511='1'; th.textContent='أول ظهور';
      const stageTh=[...head.children].find(el=>el.textContent.trim()==='المرحلة');
      if(stageTh) stageTh.after(th); else head.appendChild(th);
    }
    document.querySelectorAll('#scannerBody tr[data-ticker]').forEach(tr=>{
      if(tr.querySelector('[data-origin511]')) return;
      const z=(window.analyzed||[]).find(x=>x.ticker===tr.dataset.ticker); if(!z?.signalOrigin) return;
      const stageCell=[...tr.children].find(td=>td.querySelector('.pill')); if(!stageCell) return;
      const m=z.signalOrigin,td=document.createElement('td'); td.dataset.origin511='1';
      td.innerHTML=`<strong>${label(m.class)}</strong><small style="display:block;color:#8fa9bd;font-size:10px;margin-top:3px">${fmtTime(m.ts)}${Number.isFinite(m.change)?` · ${m.change>=0?'+':''}${m.change.toFixed(1)}%`:''}${m.bucket?` · ${m.bucket}`:''}</small>`;
      stageCell.after(td);
    });
    const log=document.querySelector('#integrityLog');
    if(log){
      const a=window.analyzed||[],known=a.filter(x=>x.centralFirstSeenVerified).length,early=a.filter(x=>x.signalOrigin?.class==='EARLY').length,late=a.filter(x=>['LATE','VERY_LATE'].includes(x.signalOrigin?.class)).length,blocked=a.filter(x=>x.signalOrigin?.qualification==='BLOCKED').length;
      log.insertAdjacentHTML('beforeend',`<div class="log-item">Signal Origin Gate ${BUILD}: ${known} بسجل مركزي لأول ظهور · ${early} ظهرت مبكرًا · ${late} ظهرت متأخرة · ${blocked} BLOCKED في pipeline.</div>`);
    }
  };
})();