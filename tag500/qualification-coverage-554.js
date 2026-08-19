'use strict';
(function(){
  const BUILD='TAG554';
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const pct=(n,d)=>d?`${Math.round(n/d*100)}%`:'—';
  function arr(v){return Array.isArray(v)?v:[];}
  function reasonCodes(z){return arr(z?.raw?._qualificationDecisionReasonCodes).map(String);}
  function shariaOk(z){return String(z?.shariaStatus||z?.sharia?.status||z?.sharia||'').toUpperCase()==='VERIFIED';}
  function activityExcluded(z){return String(z?.businessActivityGate?.state||'').toUpperCase()==='EXCLUDED';}
  function structuralUnverified(z){return String(z?.businessActivityGate?.code||'').toUpperCase()==='SHELL_OR_SPAC';}
  function catalystReady(z){
    const c=z?.catalystClock||z?.catalyst;
    const code=String(c?.code||c?.mode||'').toUpperCase();
    if(['ENRICHMENT_STALE','SWEEP_UNAVAILABLE','UNKNOWN',''].includes(code)) return false;
    return !reasonCodes(z).includes('CATALYST_SWEEP_NOT_AVAILABLE');
  }
  function modelReady(z){return !reasonCodes(z).includes('INCOMPLETE_MODEL_INPUTS');}
  function earlyOrigin(z){
    const v=Number(z?.origin?.firstChangePct ?? z?.signalOrigin?.firstChangePct ?? z?.raw?._firstObservedChange?.toString().replace('%',''));
    return Number.isFinite(v)&&v<20;
  }
  function executive(z){
    const tier=String(z?.actionability?.tier||z?.actionabilityTier||z?.tier||'').toUpperCase();
    return shariaOk(z)&&['A','B'].includes(tier)&&z?.valid!==false;
  }
  function snapshot(){
    const a=arr(window.analyzed);
    const blockers={};
    for(const z of a) for(const r of reasonCodes(z)) blockers[r]=(blockers[r]||0)+1;
    const top=Object.entries(blockers).sort((x,y)=>y[1]-x[1]).slice(0,5);
    const sourceMeasured=a.filter(z=>Number.isFinite(z?.liveSourceConsistency?.divergencePct)).length;
    return {total:a.length,sharia:a.filter(shariaOk).length,activityExcluded:a.filter(activityExcluded).length,structuralUnverified:a.filter(structuralUnverified).length,catalyst:a.filter(catalystReady).length,model:a.filter(modelReady).length,early:a.filter(earlyOrigin).length,executive:a.filter(executive).length,sourceMeasured,top};
  }
  function card(label,value,sub,cls=''){
    return `<div style="background:#0b1723;border:1px solid #20364a;border-radius:12px;padding:12px;min-width:0" class="${cls}"><div style="font-size:12px;color:#9fb3c5">${esc(label)}</div><div style="font-size:24px;font-weight:800;margin:4px 0">${esc(value)}</div><div style="font-size:12px;color:#9fb3c5;line-height:1.5">${esc(sub)}</div></div>`;
  }
  function renderCoverage(){
    const host=document.querySelector('#opportunities');
    if(!host) return;
    let panel=document.querySelector('#qualificationCoverage553');
    if(!panel){panel=document.createElement('section');panel.id='qualificationCoverage553';panel.className='panel';host.parentNode.insertBefore(panel,host);}
    const s=snapshot();
    const primary=s.top[0];
    const bottleneck=primary?`${primary[0]} (${primary[1]})`:'لا يوجد مانع موحد';
    panel.innerHTML=`<div class="section-head"><div><h3>تغطية أهلية القرار · ${BUILD}</h3><p>تفصل بين جودة الاكتشاف وجودة المدخلات، وتضيف استبعاد النشاط الواضح قبل الـscoring. الحالات غير المحسومة تبقى Unverified.</p></div></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px">
        ${card('الكون الحالي',String(s.total),'حالات محللة')}
        ${card('استبعاد نشاطي حتمي',pct(s.activityExcluded,s.total),`${s.activityExcluded}/${s.total} · قبل scoring`)}
        ${card('Shell/SPAC غير متحقق',pct(s.structuralUnverified,s.total),`${s.structuralUnverified}/${s.total} · لا يُعرض كفرصة`)}
        ${card('شرعية VERIFIED',pct(s.sharia,s.total),`${s.sharia}/${s.total}`)}
        ${card('Catalyst sweep جاهز',pct(s.catalyst,s.total),`${s.catalyst}/${s.total}`)}
        ${card('مدخلات النموذج مكتملة',pct(s.model,s.total),`${s.model}/${s.total}`)}
        ${card('Origin < 20%',pct(s.early,s.total),`${s.early}/${s.total}`)}
        ${card('قابل تنفيذيًا A/B',pct(s.executive,s.total),`${s.executive}/${s.total}`)}
        ${card('Cross-source measured',pct(s.sourceMeasured,s.total),`${s.sourceMeasured}/${s.total}`)}
      </div>
      <div style="margin-top:10px;padding:10px 12px;border:1px solid #20364a;border-radius:10px;color:#b9c9d8;font-size:13px"><strong>أكبر عنق زجاجة:</strong> ${esc(bottleneck)}${s.top.length?` · ${s.top.map(([r,n])=>`${esc(r)} ${n}`).join(' · ')}`:''}</div>`;
  }
  const baseRender=window.render;
  if(typeof baseRender==='function') window.render=function(){baseRender();queueMicrotask(renderCoverage);};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>queueMicrotask(renderCoverage)); else queueMicrotask(renderCoverage);
  window.TAG500QualificationCoverage={build:BUILD,snapshot,render:renderCoverage,diagnosticOnly:true};
})();
