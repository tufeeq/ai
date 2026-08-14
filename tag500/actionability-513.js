'use strict';
(function(){
  const BUILD='TAG513';
  const ORDER={A:0,B:1,C:2,L:3,U:4,X:5};
  function tier(z){
    if(!z?.valid) return {code:'X',label:'محجوب',reason:'بيانات/شرعية/حداثة غير مؤهلة'};
    const cf=z.signalOrigin?.confirmation||'UNKNOWN';
    if(z.stage==='LATE'||z.stage==='EXHAUSTION'||z.discoveryCredit===false||cf==='LATE_ORIGIN') return {code:'L',label:'متأخر / مراقبة',reason:'لا Discovery credit'};
    if(cf==='EARLY_CONFIRMED'&&['DISCOVERY','IGNITION'].includes(z.stage)) return {code:'A',label:'A · مبكر مؤكد',reason:'أصل مبكر + مسار مؤكد'};
    if(cf==='EARLY_PENDING'&&['DISCOVERY','IGNITION'].includes(z.stage)) return {code:'B',label:'B · مبكر قيد التأكيد',reason:'أصل مبكر والمسار لم يكتمل بعد'};
    if(cf==='EARLY_FADING') return {code:'C',label:'C · مبكر يتلاشى',reason:'الأصل مبكر لكن الاستمرارية ضعفت'};
    return {code:'U',label:'غير محسوم',reason:'لا يوجد تأكيد زمني كافٍ'};
  }
  function decorate(){
    const a=Array.isArray(window.analyzed)?window.analyzed:[];
    for(const z of a) z.actionability=tier(z);
    const body=document.querySelector('#scannerBody');
    const head=document.querySelector('.table-panel thead tr');
    if(head&&!head.querySelector('[data-action513]')){
      const th=document.createElement('th'); th.dataset.action513='1'; th.textContent='قابلية التنفيذ';
      const scoreTh=[...head.children].find(el=>el.textContent.trim()==='TAG');
      if(scoreTh) scoreTh.after(th); else head.appendChild(th);
    }
    if(body){
      const map=new Map(a.map(z=>[z.ticker,z]));
      for(const tr of [...body.querySelectorAll('tr[data-ticker]')]){
        const z=map.get(tr.dataset.ticker); if(!z) continue;
        let td=tr.querySelector('[data-action513]');
        if(!td){td=document.createElement('td');td.dataset.action513='1';const scoreCell=[...tr.children].find(c=>c.classList.contains('score'));if(scoreCell)scoreCell.after(td);else tr.appendChild(td);}
        td.innerHTML=`<strong>${z.actionability.label}</strong><small style="display:block;color:#8fa9bd;font-size:10px;margin-top:3px">${z.actionability.reason}</small>`;
      }
      const tableRows=[...body.querySelectorAll('tr[data-ticker]')];
      tableRows.sort((ra,rb)=>{const A=map.get(ra.dataset.ticker),B=map.get(rb.dataset.ticker);return (ORDER[A?.actionability?.code]??9)-(ORDER[B?.actionability?.code]??9)||((B?.score??-1)-(A?.score??-1));});
      tableRows.forEach(r=>body.appendChild(r));
    }
    const top=document.querySelector('#topOpportunity');
    if(top){
      const eligible=a.filter(z=>z.valid&&['A','B'].includes(z.actionability?.code)).sort((x,y)=>(ORDER[x.actionability.code]-ORDER[y.actionability.code])||((y.score??-1)-(x.score??-1)));
      const best=eligible[0];
      if(best){
        top.classList.remove('empty');
        top.innerHTML=`<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><strong style="font-size:22px">${best.ticker}</strong><div style="margin-top:5px;color:#9fb6c8">${best.actionability.label} · ${best.stage}</div></div><strong style="font-size:24px">TAG ${Number.isFinite(best.score)?best.score.toFixed(0):'—'}</strong></div><div style="margin-top:10px">${best.reasons?.slice(0,3).join(' · ')||'—'}</div><div style="margin-top:8px;color:#9fb6c8;font-size:12px">اختيار البطاقة يفضّل جودة توقيت الإشارة على score الخام؛ الأسهم المتأخرة لا تتصدر هذه البطاقة.</div>`;
      } else {
        top.classList.add('empty');
        top.innerHTML='لا توجد حاليًا إشارة مبكرة مؤهلة من فئة A/B. الأسهم المتأخرة أو غير المتحققة لا تُرفع إلى «أفضل فرصة».';
      }
    }
    const log=document.querySelector('#integrityLog');
    if(log){const c={A:0,B:0,C:0,L:0,U:0,X:0};for(const z of a)c[z.actionability?.code||'X']++;log.insertAdjacentHTML('beforeend',`<div class="log-item">Actionability ${BUILD}: A=${c.A} · B=${c.B} · fading=${c.C} · late=${c.L} · unresolved=${c.U} · blocked=${c.X}. الترتيب يتغير داخل الفئات فقط ولا توجد إعادة معايرة للـthresholds.</div>`);}
  }
  const baseRender=window.render;
  if(typeof baseRender==='function') window.render=function(){baseRender();decorate();};
})();
