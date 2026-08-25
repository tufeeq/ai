'use strict';

(function(){
  const fmt=(v,d=1)=>Number.isFinite(Number(v))?Number(v).toFixed(d):'—';
  const pct=(v,d=1)=>Number.isFinite(Number(v))?`${Number(v)>=0?'+':''}${Number(v).toFixed(d)}%`:'—';
  const mul=(v)=>Number.isFinite(Number(v))?`${Number(v).toFixed(1)}×`:'—';
  const esc=(s)=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  function metricLabel(k){return ({volumeExpansion10m:'توسع الحجم خلال 10د',volumeExpansion30m:'توسع الحجم خلال 30د',priceMove10mPct:'الحركة من أول رصد خلال 10د',priceMove30mPct:'الحركة من أول رصد خلال 30د',changeAcceleration10mPts:'تسارع التغير خلال 10د',changeAcceleration30mPts:'تسارع التغير خلال 30د'})[k]||k;}
  function ensureShell(){
    if(document.querySelector('#learning'))return; const radar=document.querySelector('#radarSection'); if(!radar)return;
    const section=document.createElement('section'); section.className='panel learning-panel'; section.id='learning';
    section.innerHTML=`<div class="section-head learning-head"><div><div class="section-kicker">MODEL LEARNING</div><h3>ما الذي يسبق الحركة الكبيرة؟</h3><p>يتعلم فقط من الأسهم التي رصدها TAGX وهي بين -10% و+10%، ثم يقارن أول 10–30 دقيقة بين من وصل +50% ومن بقي تحت +10%.</p></div><span id="learningStatus" class="learning-status">جاري التحليل</span></div><div id="learningBody" class="learning-body"><div class="learning-loading">يتم تحميل تقرير التعلم اليومي…</div></div>`;
    radar.insertAdjacentElement('afterend',section);
  }
  function ensureNav(){
    if(document.querySelector('.tagx-nav'))return; const header=document.querySelector('.topbar'); if(!header)return;
    const nav=document.createElement('nav'); nav.className='tagx-nav'; nav.innerHTML=`<a href="#radarSection">الرادار</a><a href="#opportunities">الفرص</a><a href="#learning">التعلم</a><a href="#analysis">التحليل</a>`; header.insertAdjacentElement('afterend',nav);
  }
  function render(p){
    const body=document.querySelector('#learningBody'),status=document.querySelector('#learningStatus'); if(!body)return;
    const c=p.counts||{},w=p.winners||{},f=p.failures||{},th=p.proposedThresholds||{},top=(p.strongestEdges||[]).slice(0,3),winners=(p.topWinners||[]).slice(0,5),promotion=!!p.promotionEligible;
    const earlyW=c.earlyWinners50??c.winners50??0, explosive=c.explosive100??0, failures=c.earlyFailuresUnder10??c.failuresUnder10??0, sample=c.earlyCohort??c.eligible??0;
    status.textContent=promotion?'مؤهل للمعايرة':'مراقبة فقط'; status.className=`learning-status ${promotion?'ready':'observe'}`;
    body.innerHTML=`<div class="learning-summary"><div><small>التقطهم مبكرًا ثم +50%</small><strong>${earlyW}</strong></div><div><small>انفجارات +100%</small><strong>${explosive}</strong></div><div><small>العينة المبكرة الفاشلة</small><strong>${failures}</strong></div><div><small>العينة المبكرة</small><strong>${sample}</strong></div></div><div class="learning-grid"><section class="learning-card emphasis"><div class="learning-card-title"><b>الفروق الأقوى في الالتقاط المبكر</b><span>Early winner − failure</span></div>${top.length?top.map(x=>`<div class="edge-row"><span>${esc(metricLabel(x.metric))}</span><strong>${/volumeExpansion/.test(x.metric)?mul(x.winnerMinusFailure):pct(x.winnerMinusFailure)}</strong></div>`).join(''):'<div class="learning-empty">لا توجد عينة كافية بعد.</div>'}</section><section class="learning-card"><div class="learning-card-title"><b>بصمة الرابحين المبكرين</b><span>Median</span></div><div class="edge-row"><span>توسع الحجم 10د</span><strong>${mul(w.volumeExpansion10mMedian)}</strong></div><div class="edge-row"><span>توسع الحجم 30د</span><strong>${mul(w.volumeExpansion30mMedian)}</strong></div><div class="edge-row"><span>حركة السعر 30د</span><strong>${pct(w.priceMove30mMedianPct)}</strong></div></section><section class="learning-card"><div class="learning-card-title"><b>مقابل الفاشلين المبكرين</b><span>Median</span></div><div class="edge-row"><span>توسع الحجم 10د</span><strong>${mul(f.volumeExpansion10mMedian)}</strong></div><div class="edge-row"><span>توسع الحجم 30د</span><strong>${mul(f.volumeExpansion30mMedian)}</strong></div><div class="edge-row"><span>حركة السعر 30د</span><strong>${pct(f.priceMove30mMedianPct)}</strong></div></section></div><div class="learning-footer-grid"><div class="threshold-box"><span>عتبات تجريبية مقترحة</span><b>قاعدة هادئة ≤ ${fmt(th.quietBaseAbsPctMax,1)}%</b><b>حجم 10د ≥ ${mul(th.volumeExpansion10mMin)}</b><b>حجم 30د ≥ ${mul(th.volumeExpansion30mMin)}</b><small>${promotion?'العينة والنتيجة النهائية اجتازتا حارس المعايرة.':'هذه حدود مراقبة فقط؛ لا تُطبّق تلقائيًا قبل اكتمال العينة والمصالحة النهائية.'}</small></div><div class="winner-strip"><span>أفضل الالتقاطات المبكرة</span>${winners.length?winners.map(x=>`<button type="button" data-learn-ticker="${esc(x.ticker)}"><b>${esc(x.ticker)}</b><small>${pct(x.maxObservedChangePct,0)}</small></button>`).join(''):'<small>سيظهر هنا الرابحون الذين التقطهم الرادار قبل +10%.</small>'}</div></div>`;
    body.querySelectorAll('[data-learn-ticker]').forEach(btn=>btn.addEventListener('click',()=>{const input=document.querySelector('#analysisTicker');if(input){input.value=btn.dataset.learnTicker;document.querySelector('#analysis')?.scrollIntoView({behavior:'smooth',block:'start'});}}));
  }
  async function load(){try{const r=await fetch(`./data/daily-learning.json?v=${Date.now()}`,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);render(await r.json());}catch(e){const body=document.querySelector('#learningBody'),status=document.querySelector('#learningStatus');if(status){status.textContent='يبني أول تقرير';status.className='learning-status observe';}if(body)body.innerHTML='<div class="learning-loading">تم تفعيل محرك التعلم اليومي. سيظهر تحليل الالتقاط المبكر هنا عند اكتمال أول دورة.</div>';}}
  function boot(){ensureNav();ensureShell();load();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
