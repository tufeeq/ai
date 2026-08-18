'use strict';
(function(){
  const BUILD='TAG538';
  const TOP_N=20;
  function n(v){return Number.isFinite(+v)?+v:null;}
  function esc(s){return String(s??'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[m]));}
  function currentChange(z){const v=n(z?.changePct);return Number.isFinite(v)?v:null;}
  function originChange(z){const v=n(z?.signalOrigin?.change);return Number.isFinite(v)?v:null;}
  function sourceSignals(){const rows=window.marketRows||window.rows||[];const set=new Set();for(const r of rows){for(const s of (r?._signals||r?.signals||[]))set.add(String(s));}return [...set];}
  function sourceBias(){const s=sourceSignals();const reactive=s.filter(x=>/topgainer|unusualvolume|mostactive/i.test(x));return {signals:s,reactive,reactiveOnly:s.length>0&&reactive.length===s.length};}
  function audit(){
    const all=(window.analyzed||[]).filter(z=>Number.isFinite(currentChange(z))).slice().sort((a,b)=>currentChange(b)-currentChange(a));
    const top=all.slice(0,Math.min(TOP_N,all.length));
    const known=top.filter(z=>Number.isFinite(originChange(z)));
    const under20=known.filter(z=>originChange(z)<20);
    const late=known.filter(z=>originChange(z)>=20);
    const unknown=top.length-known.length;
    const knownCoverage=known.length?under20.length/known.length:null;
    const conservativeCoverage=top.length?under20.length/top.length:null;
    const lateDebtKnown=known.length?late.length/known.length:null;
    const originCompleteness=top.length?known.length/top.length:null;
    const bias=sourceBias();
    return {top,known,under20,late,unknown,knownCoverage,conservativeCoverage,lateDebtKnown,originCompleteness,bias};
  }
  function pct(v){return Number.isFinite(v)?Math.round(v*100)+'%':'—';}
  function ensure(){
    let p=document.querySelector('#universeComposition538');if(p)return p;
    p=document.createElement('section');p.id='universeComposition538';p.className='panel';
    p.innerHTML='<div class="section-head"><div><h3>جودة كون الاكتشاف</h3><p>يفصل بين جودة ترتيب TAG وبين تحيز مصادر الاكتشاف نفسها. لا يعتبر قياسًا نهائيًا للسوق خارج الكون.</p></div></div><div id="universeComposition538Body"></div>';
    const anchor=document.querySelector('#universeAudit537')||document.querySelector('.table-panel');if(anchor?.parentNode)anchor.parentNode.insertBefore(p,anchor);
    const st=document.createElement('style');st.textContent='.uc-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.uc-m{border:1px solid #20364a;border-radius:12px;padding:11px;background:#0a1520}.uc-m small{display:block;color:#8fa9bd;margin-bottom:5px}.uc-m strong{font-size:20px}.uc-row{margin-top:12px;padding-top:10px;border-top:1px solid #1b3042}.uc-warn{color:#e3b45b}.uc-bad{color:#ef8f8f}.uc-ok{color:#7fd4a3}@media(max-width:760px){.uc-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}';document.head.appendChild(st);return p;
  }
  function render(){ensure();const b=document.querySelector('#universeComposition538Body');if(!b)return;const a=audit();
    const sourceText=a.bias.signals.length?a.bias.signals.map(esc).join(' · '):'غير معروف';
    const diagnosis=a.bias.reactiveOnly?'مصادر الكون الحالية تفاعلية بالكامل (top gainers / unusual volume / most active). لا يجوز تفسير نسبة الالتقاط داخل هذا الكون كتغطية اكتشاف مبكر للسوق؛ الأولوية لإضافة مصادر قبل الحركة.':(a.conservativeCoverage!==null&&a.conservativeCoverage<.4?'الالتقاط المبكر المحافظ منخفض؛ المشكلة قد تكون في تغطية الكون أو توقيت دخوله أكثر من ترتيب الـscore.':'التغطية الداخلية مقبولة وصفيًا، لكن لا تُعامل كـEarly-Capture نهائي قبل reconciliation ومقارنة movers خارج الكون.');
    b.innerHTML=`<div class="uc-grid"><div class="uc-m"><small>التقاط مبكر محافظ</small><strong class="${a.conservativeCoverage<.4?'uc-bad':''}">${pct(a.conservativeCoverage)}</strong><div>تحت +20% ÷ كل Top ${a.top.length}</div></div><div class="uc-m"><small>التقاط بين الأصول المعروفة</small><strong>${pct(a.knownCoverage)}</strong><div>مقياس ثانوي فقط</div></div><div class="uc-m"><small>اكتمال أصل الإشارة</small><strong>${pct(a.originCompleteness)}</strong><div>${a.known.length}/${a.top.length}</div></div><div class="uc-m"><small>دين الظهور المتأخر</small><strong class="${a.lateDebtKnown>=.5?'uc-warn':''}">${pct(a.lateDebtKnown)}</strong><div>من الأصول المعروفة</div></div></div><div class="uc-row"><b>مصادر الكون:</b> ${sourceText}</div><div class="uc-row"><b>التشخيص:</b> ${diagnosis}</div><div class="uc-row" style="color:#8fa9bd">Unknown origin يُحسب ضد النسبة المحافظة بدل استبعاده من المقام. هذا يمنع تضخيم coverage بسبب نقص instrumentation.</div>`;
    const log=document.querySelector('#integrityLog');let item=document.querySelector('#universeComposition538Log');if(log&&!item){item=document.createElement('div');item.id='universeComposition538Log';item.className='log-item';log.appendChild(item);}if(item)item.textContent=`Universe Composition ${BUILD}: conservative under20/top=${pct(a.conservativeCoverage)}, known-only=${pct(a.knownCoverage)}, origin completeness=${pct(a.originCompleteness)}, reactive-only=${a.bias.reactiveOnly}. Observational only.`;
  }
  const baseRender=window.render;if(typeof baseRender==='function')window.render=function(){baseRender();queueMicrotask(render);};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>queueMicrotask(render));else queueMicrotask(render);
  window.TAG500UniverseComposition={build:BUILD,audit,render};
})();