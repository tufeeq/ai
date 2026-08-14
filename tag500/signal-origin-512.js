'use strict';
(function(){
  const BUILD='TAG512';
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
  function confirmation(z,c){
    const t=z?.temporal||{};
    if(c==='LATE'||c==='VERY_LATE') return 'LATE_ORIGIN';
    if(c==='UNKNOWN') return 'UNKNOWN';
    if(t.trajectory==='FADING') return 'EARLY_FADING';
    const hasFollowUp=Number.isFinite(t.count)&&t.count>=1;
    const retained=!Number.isFinite(t.retention)||t.retention>=.65;
    const constructive=['ACCELERATING','BUILDING','STABLE'].includes(t.trajectory);
    if(hasFollowUp&&retained&&constructive) return 'EARLY_CONFIRMED';
    return 'EARLY_PENDING';
  }
  function label(c){return {EARLY:'مبكر',FORMING:'يتكوّن',LATE:'متأخر',VERY_LATE:'متأخر جدًا',UNKNOWN:'غير معروف'}[c]||c;}
  function confirmationLabel(c){return {EARLY_CONFIRMED:'مبكر · مؤكد بالمسار',EARLY_PENDING:'مبكر · بانتظار التأكيد',EARLY_FADING:'مبكر · يتلاشى',LATE_ORIGIN:'ظهر متأخرًا',UNKNOWN:'غير معروف'}[c]||c;}
  function fmtTime(ts){
    const d=Date.parse(ts||''); if(!Number.isFinite(d)) return '—';
    return new Intl.DateTimeFormat('ar-SA',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'}).format(new Date(d))+' ET';
  }
  const baseAnalyze=window.analyze;
  if(typeof baseAnalyze==='function') window.analyze=function(x){
    const z=baseAnalyze(x),m=firstMeta(z),c=originClass(m),cf=confirmation(z,c);
    z.signalOrigin={...m,class:c,confirmation:cf};
    const observedLate=c==='LATE'||c==='VERY_LATE';
    if(observedLate){
      z.discoveryCredit=false;
      if(z.stage==='DISCOVERY'||z.stage==='IGNITION') z.stage='LATE';
      z.reasons.unshift(`أول ظهور ${label(c)} عند ${Number.isFinite(m.change)?m.change.toFixed(1)+'%':'—'}`);
    } else if(cf==='EARLY_CONFIRMED') {
      z.reasons.push(`أصل الإشارة مبكر ومؤكد بالمسار`);
    } else if(cf==='EARLY_FADING') {
      z.reasons.push(`ظهر مبكرًا لكن المسار الحالي يتلاشى`);
    } else if(c==='EARLY'||c==='FORMING') {
      z.reasons.push(`أول ظهور ${label(c)} عند ${m.change.toFixed(1)}% · التأكيد قيد الانتظار`);
    }
    z.centralFirstSeenVerified=Boolean(m.ts&&Number.isFinite(m.change));
    return z;
  };
  const baseRender=window.render;
  if(typeof baseRender==='function') window.render=function(){
    baseRender();
    const head=document.querySelector('.table-panel thead tr');
    if(head&&!head.querySelector('[data-origin512]')){
      const th=document.createElement('th'); th.dataset.origin512='1'; th.textContent='أصل الإشارة';
      const stageTh=[...head.children].find(el=>el.textContent.trim()==='المرحلة');
      if(stageTh) stageTh.after(th); else head.appendChild(th);
    }
    document.querySelectorAll('#scannerBody tr[data-ticker]').forEach(tr=>{
      if(tr.querySelector('[data-origin512]')) return;
      const z=(window.analyzed||[]).find(x=>x.ticker===tr.dataset.ticker); if(!z?.signalOrigin) return;
      const stageCell=[...tr.children].find(td=>td.querySelector('.pill')); if(!stageCell) return;
      const m=z.signalOrigin,td=document.createElement('td'); td.dataset.origin512='1';
      const ret=Number.isFinite(z.temporal?.retention)?` · ret ${(z.temporal.retention*100).toFixed(0)}%`:'';
      td.innerHTML=`<strong>${confirmationLabel(m.confirmation)}</strong><small style="display:block;color:#8fa9bd;font-size:10px;margin-top:3px">${fmtTime(m.ts)}${Number.isFinite(m.change)?` · ${m.change>=0?'+':''}${m.change.toFixed(1)}%`:''}${m.bucket?` · ${m.bucket}`:''}${ret}</small>`;
      stageCell.after(td);
    });
    const log=document.querySelector('#integrityLog');
    if(log){
      const a=window.analyzed||[],known=a.filter(x=>x.centralFirstSeenVerified).length,confirmed=a.filter(x=>x.signalOrigin?.confirmation==='EARLY_CONFIRMED').length,pending=a.filter(x=>x.signalOrigin?.confirmation==='EARLY_PENDING').length,fading=a.filter(x=>x.signalOrigin?.confirmation==='EARLY_FADING').length,late=a.filter(x=>x.signalOrigin?.confirmation==='LATE_ORIGIN').length;
      log.insertAdjacentHTML('beforeend',`<div class="log-item">Origin Confirmation ${BUILD}: ${known} بسجل أول ظهور · ${confirmed} مبكر مؤكد بالمسار · ${pending} ينتظر التأكيد · ${fading} مبكر يتلاشى · ${late} ظهر متأخرًا. لا تعديل للـthresholds أو ادعاء أداء.</div>`);
    }
  };
})();