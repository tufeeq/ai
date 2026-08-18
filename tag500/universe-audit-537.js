'use strict';
(function(){
  const BUILD='TAG537';
  const TOP_N=20;
  function n(v){return Number.isFinite(+v)?+v:null;}
  function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
  function originChange(z){const v=z?.signalOrigin?.change;return Number.isFinite(v)?v:null;}
  function currentChange(z){const v=n(z?.changePct);return Number.isFinite(v)?v:null;}
  function originBucket(v){if(!Number.isFinite(v))return'UNKNOWN';if(v<8)return'EARLY';if(v<20)return'FORMING';return'LATE';}
  function snapshotAudit(){
    const all=(window.analyzed||[]).filter(z=>Number.isFinite(currentChange(z))).slice().sort((a,b)=>currentChange(b)-currentChange(a));
    const top=all.slice(0,Math.min(TOP_N,all.length));
    const known=top.filter(z=>Number.isFinite(originChange(z)));
    const early=known.filter(z=>originBucket(originChange(z))==='EARLY');
    const forming=known.filter(z=>originBucket(originChange(z))==='FORMING');
    const late=known.filter(z=>originBucket(originChange(z))==='LATE');
    const unknown=top.length-known.length;
    const under20=early.length+forming.length;
    const coverage=known.length?under20/known.length:null;
    const debt=known.length?late.length/known.length:null;
    const evidenceEarly=known.filter(z=>originChange(z)<20&&currentChange(z)>=20).sort((a,b)=>(currentChange(b)-originChange(b))-(currentChange(a)-originChange(a))).slice(0,5);
    const lateExamples=late.slice().sort((a,b)=>currentChange(b)-currentChange(a)).slice(0,5);
    return {top,known,early,forming,late,unknown,coverage,debt,evidenceEarly,lateExamples};
  }
  function pct(v){return Number.isFinite(v)?Math.round(v*100)+'%':'—';}
  function chip(z){const f=originChange(z),c=currentChange(z);return `<span class="ua-chip"><b>${esc(z.ticker)}</b> ${Number.isFinite(f)?(f>=0?'+':'')+f.toFixed(1)+'%':'—'} → ${Number.isFinite(c)?(c>=0?'+':'')+c.toFixed(1)+'%':'—'}</span>`;}
  function ensurePanel(){
    let p=document.querySelector('#universeAudit537');
    if(p)return p;
    p=document.createElement('section');p.id='universeAudit537';p.className='panel';
    p.innerHTML='<div class="section-head"><div><h3>تدقيق تغطية الاكتشاف المبكر</h3><p>يقيس متى دخلت أكبر movers الحالية إلى كون TAG، وليس نجاحًا تنبؤيًا نهائيًا. اللقطة اللحظية لا تصبح training truth دون Final Snapshot Reconciliation.</p></div></div><div id="universeAudit537Body"></div>';
    const anchor=document.querySelector('.table-panel')||document.querySelector('#opportunities');
    if(anchor?.parentNode)anchor.parentNode.insertBefore(p,anchor);
    const st=document.createElement('style');st.id='universeAudit537Style';st.textContent='.ua-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.ua-metric{border:1px solid #20364a;border-radius:12px;padding:11px;background:#0a1520}.ua-metric small{display:block;color:#8fa9bd;margin-bottom:5px}.ua-metric strong{font-size:20px}.ua-row{margin-top:12px;padding-top:10px;border-top:1px solid #1b3042}.ua-chip{display:inline-block;margin:4px 0 0 6px;padding:5px 8px;border:1px solid #29445b;border-radius:999px;font-size:12px}.ua-warn{color:#e3b45b}.ua-ok{color:#7fd4a3}@media(max-width:760px){.ua-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}';document.head.appendChild(st);
    return p;
  }
  function renderAudit(){
    ensurePanel();const b=document.querySelector('#universeAudit537Body');if(!b)return;
    const a=snapshotAudit();
    const confidence=a.known.length>=10?'كافٍ لوصف تغطية الكون اللحظية':'عينة محدودة';
    const diagnosis=Number.isFinite(a.debt)&&a.debt>=.5?'عنق الزجاجة الحالي هو دخول عدد كبير من movers إلى الكون بعد بدء الحركة؛ الأولوية لتوسيع مصادر الاكتشاف قبل قوائم top gainers.':Number.isFinite(a.coverage)&&a.coverage>=.6?'تغطية أصل الإشارة اللحظية جيدة نسبيًا؛ راقب جودة التأكيد والـfalse positives قبل تعديل thresholds.':'التغطية مختلطة؛ لا يوجد دليل كافٍ لتغيير thresholds.';
    b.innerHTML=`<div class="ua-grid"><div class="ua-metric"><small>Top movers الحالية</small><strong>${a.top.length}</strong></div><div class="ua-metric"><small>دخلت تحت +20%</small><strong>${a.early.length+a.forming.length}</strong><div>${pct(a.coverage)} من المعروف</div></div><div class="ua-metric"><small>دخلت متأخرة ≥+20%</small><strong class="${a.debt>=.5?'ua-warn':''}">${a.late.length}</strong><div>${pct(a.debt)} من المعروف</div></div><div class="ua-metric"><small>أصل غير معروف</small><strong>${a.unknown}</strong><div>${confidence}</div></div></div><div class="ua-row"><b>تشخيص تغطية الكون:</b> ${diagnosis}</div>${a.evidenceEarly.length?`<div class="ua-row"><b class="ua-ok">حالات ظهرت قبل +20% ثم أصبحت mover:</b> ${a.evidenceEarly.map(chip).join('')}</div>`:''}${a.lateExamples.length?`<div class="ua-row"><b class="ua-warn">أمثلة دين الاكتشاف المتأخر:</b> ${a.lateExamples.map(chip).join('')}</div>`:''}<div class="ua-row" style="color:#8fa9bd">Intraperiod audit فقط · لا يحتسب Early-Capture Rate ولا missed movers نهائيًا قبل reconciliation.</div>`;
    const log=document.querySelector('#integrityLog');
    let item=document.querySelector('#universeAudit537Log');
    if(log&&!item){item=document.createElement('div');item.id='universeAudit537Log';item.className='log-item';log.appendChild(item);}
    if(item)item.textContent=`Universe Audit ${BUILD}: top ${a.top.length}, known origin ${a.known.length}, under +20% ${a.early.length+a.forming.length}, late-origin ${a.late.length}, unknown ${a.unknown}. Observational only; no threshold retune.`;
  }
  const baseRender=window.render;
  if(typeof baseRender==='function')window.render=function(){baseRender();queueMicrotask(renderAudit);};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>queueMicrotask(renderAudit));else queueMicrotask(renderAudit);
  window.TAG500UniverseAudit={build:BUILD,snapshotAudit,render:renderAudit};
})();