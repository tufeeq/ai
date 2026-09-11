(() => {
  'use strict';
  const URLS = ['https://raw.githubusercontent.com/tufeeq/ai/tagit10-live/tagit10-live.json', 'https://raw.githubusercontent.com/tufeeq/ai/main/tagit10-live.json'];
  const $ = id => document.getElementById(id);
  const num = v => v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
  const fmt = (v, digits = 2) => num(v) == null ? '—' : Number(v).toLocaleString('en-US', {maximumFractionDigits:digits});
  const pct = v => num(v) == null ? '—' : `${Number(v)>=0?'+':''}${fmt(v)}%`;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stamp = v => Date.parse(v || '');
  const seconds = v => (Date.now()-stamp(v))/1000;
  const ageText = v => !Number.isFinite(v) ? 'توقيت غير متاح' : v < -30 ? 'توقيت غير صالح' : v < 60 ? `${Math.max(0,Math.floor(v))} ث` : `${fmt(v/60,1)} د`;
  const labels = {WATCH:'مراقبة',EARLY:'رصد مبكر',ACTIONABLE:'اجتازت الفلترة',CONFIRMED:'مؤكدة',STALE:'سعر متأخر'};
  const titles = {early:'الفرص المبكرة',actionable:'اجتازت الفلترة',confirmed:'تأكيد متعدد اللقطات',watch:'قائمة المراقبة'};
  let data=null, tab='early', selected=null, busy=false, error=false;
  function valid(d) {return d && Number.isFinite(stamp(d.updatedAtUTC)) && stamp(d.updatedAtUTC)<=Date.now()+30000 && Array.isArray(d.watch);}
  function feedFresh(){const s=seconds(data?.updatedAtUTC);return !error && s>=-30 && s<=180 && ['regular','pre-market','after-hours'].includes(data?.session);}
  function rows(){
    const map=new Map();
    for(const key of ['watch','early','actionable','confirmed']) for(const x of data?.[key]||[]){
      if(!x || !/^[A-Z0-9.^-]{1,12}$/.test(x.symbol||''))continue;
      map.set(x.symbol,x);
    }
    return [...map.values()].map(x=>{
      const qAge=seconds(x.quoteTimestampUTC), fresh=qAge>=-30&&qAge<=120&&num(x.price)>0;
      let stage=x.stage;
      if(!feedFresh()||!fresh)stage='STALE';
      // Old engines cannot supply the required two-observation confirmation.
      else if(stage==='CONFIRMED' && (num(x.confirmationCount)||0)<2)stage='ACTIONABLE';
      return {...x,stage,qAge,fresh};
    }).sort((a,b)=>Number(b.fresh)-Number(a.fresh)||(num(b.score)||0)-(num(a.score)||0));
  }
  function choose(t){tab=t;render();}
  function render(){
    const all=rows(), isFresh=feedFresh(), fAge=seconds(data?.updatedAtUTC);
    const groups={watch:all,early:all.filter(x=>['EARLY','ACTIONABLE','CONFIRMED'].includes(x.stage)&&num(x.changePct)!=null&&x.changePct<10),actionable:all.filter(x=>['ACTIONABLE','CONFIRMED'].includes(x.stage)),confirmed:all.filter(x=>x.stage==='CONFIRMED')};
    $('status').textContent=error?'تعذر التحديث':!data?'جارٍ الاتصال':isFresh?'لقطة حديثة':'بيانات متأخرة / مغلقة';
    $('status').dataset.state=isFresh?'live':'stale';
    $('session').textContent=({regular:'الجلسة الرئيسية','pre-market':'ما قبل الجلسة','after-hours':'ما بعد الجلسة',closed:'الجلسة مغلقة'})[data?.session]||'حالة الجلسة غير متاحة';
    $('health').className=`health ${isFresh?'live':''}`;
    $('health').textContent=!data?'تعذر الوصول للمحرك. ستتم إعادة المحاولة تلقائيًا.':!isFresh?'لا توجد إشارات حديثة معتمدة الآن. الأسعار السابقة متاحة في «المراقبة» مع عمر كل سعر.':`آخر مسح منذ ${ageText(fAge)}. ${groups.confirmed.length} تأكيد متعدد اللقطات؛ التحديث المرئي لا يعني وصول صفقة جديدة.`;
    $('universe').textContent=fmt(data?.universeScanned,0);
    $('coverage').textContent=`${fmt(data?.quotesFresh,0)} / ${fmt(data?.quotesValid,0)}`;
    for(const [id,key] of [['watchN','watch'],['earlyN','early'],['actionN','actionable'],['confirmedN','confirmed']])$(id).textContent=data?groups[key].length:'—';
    $('asof').textContent=data?new Date(data.updatedAtUTC).toLocaleString('en-US',{timeZone:'America/New_York'})+' ET':'—';
    $('feedAge').textContent=data?` · منذ ${ageText(fAge)}`:'';
    document.querySelectorAll('[data-tab]').forEach(b=>{const on=b.dataset.tab===tab;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));});
    const query=$('search').value.trim().toUpperCase();
    const xs=groups[tab].filter(x=>x.symbol.includes(query));
    $('title').textContent=titles[tab];$('resultCount').textContent=`${xs.length} سهم`;
    if(!xs.length)$('rows').innerHTML=`<div class="empty"><b>${query?'لا توجد نتائج للرمز':'لا توجد فرص مجتازة الآن'}</b>${query?'جرّب الرمز في قائمة المراقبة.':'انتظر اكتمال السعر والسيولة والتأكيد. يمكنك فحص الأسهم المرصودة.'}${tab!=='watch'?'<br><button id="showWatch">عرض المراقبة</button>':''}</div>`;
    else $('rows').innerHTML=xs.map(x=>`<button type="button" class="row ${selected===x.symbol?'selected':''}" data-symbol="${esc(x.symbol)}" aria-label="تفاصيل ${esc(x.symbol)}"><span><b dir="ltr">${esc(x.symbol)}</b><small>درجة رصد ${fmt(x.score,0)}</small></span><span class="stage"><span class="pill ${x.stage.toLowerCase()}">${esc(labels[x.stage]||x.stage)}</span><small>منذ ${ageText(x.qAge)}</small></span><span class="number"><b>${num(x.price)!=null?'$'+fmt(x.price,4):'—'}</b><small class="${num(x.changePct)>=0?'good':'warn'}">${pct(x.changePct)}</small></span></button>`).join('');
    if($('showWatch'))$('showWatch').onclick=()=>choose('watch');
    document.querySelectorAll('[data-symbol]').forEach(b=>b.onclick=()=>{selected=b.dataset.symbol;render();if(matchMedia('(max-width:900px)').matches)$('detail').scrollIntoView({behavior:'smooth',block:'start'});});
    const x=xs.find(x=>x.symbol===selected)||xs[0];
    if(x){selected=x.symbol;detail(x);}else {$('detail').innerHTML='<div class="empty">اختر سهمًا من قائمة المراقبة لفحص البيانات وأسباب الرصد.</div>';selected=null;}
  }
  function detail(x){
    const cell=(title,value)=>`<div><span>${title}</span><b>${value}</b></div>`;
    const why=Array.isArray(x.reasons)?x.reasons:[];
    const verdict=x.stage==='CONFIRMED'?'اجتازت الإشارة لقطتين مستقلتين حديثتين. راقب استمرار السيولة وثبات السعر.':x.stage==='STALE'?'البيانات غير حديثة؛ لا تعتمد هذه اللقطة للدخول.':x.stage==='ACTIONABLE'?'توافقت شروط الرصد؛ انتظر استمرارها في لقطة مستقلة.':'للمتابعة فقط: لم تكتمل شروط التأكيد.';
    $('detail').innerHTML=`<div class="detail-top"><h2 dir="ltr">${esc(x.symbol)}</h2><span class="pill ${x.stage.toLowerCase()}">${esc(labels[x.stage]||x.stage)}</span></div><div class="price">$${fmt(x.price,4)} <small class="${num(x.changePct)>=0?'good':'warn'}">${pct(x.changePct)}</small></div><div class="verdict">${verdict}</div><div class="data-grid">${cell('حركة 5 دقائق',pct(x.ret5mPct))}${cell('حركة 15 دقيقة',pct(x.ret15mPct))}${cell('حجم 5 دقائق',fmt(x.volume5m,0))}${cell('تسارع حجم 15 دقيقة',num(x.volumeAcceleration15m)!=null?fmt(x.volumeAcceleration15m)+'×':'—')}${cell('الحجم النسبي',num(x.relativeVolume)!=null?fmt(x.relativeVolume)+'×':'—')}${cell('لقطات تأكيد مستقلة',fmt(x.confirmationCount,0))}</div><h4>مستويات المتابعة</h4><div class="data-grid">${cell('قمة نطاق 15 دقيقة',num(x.breakout15m)!=null?'$'+fmt(x.breakout15m,4):'—')}${cell('قاع نطاق 15 دقيقة',num(x.support15m)!=null?'$'+fmt(x.support15m,4):'—')}</div><p class="note">مستويات مرجعية مستخرجة من إغلاقات الدقيقة، وليست أوامر دخول أو أهدافًا مضمونة.</p><h4>لماذا ظهر السهم؟</h4><ul class="reasons">${why.length?why.map(t=>`<li>${esc(t)}</li>`).join(''):'<li>النسخة الحالية من التغذية لا توفر تفسيرًا تفصيليًا لهذه الإشارة.</li>'}</ul><p class="note">عمر السعر: ${ageText(x.qAge)} · المصدر: ${esc(x.source||'Yahoo 1m + Finviz')}<br>درجة الرصد ${fmt(x.score)} / 100 ليست نسبة نجاح.</p>`;
  }
  async function get(url){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6500);
    try{const r=await fetch(`${url}?t=${Date.now()}`,{cache:'no-store',signal:controller.signal});if(!r.ok)throw new Error('feed');const d=await r.json();if(!valid(d))throw new Error('schema');return d;}finally{clearTimeout(timer);}
  }
  async function load(){
    if(busy||document.hidden)return;busy=true;$('refresh').disabled=true;
    try{const candidates=(await Promise.allSettled(URLS.map(get))).filter(x=>x.status==='fulfilled').map(x=>x.value).sort((a,b)=>stamp(b.updatedAtUTC)-stamp(a.updatedAtUTC));if(!candidates.length)throw new Error('offline');if(!data||stamp(candidates[0].updatedAtUTC)>=stamp(data.updatedAtUTC))data=candidates[0];error=false;}catch{error=true;}finally{busy=false;$('refresh').disabled=false;render();}
  }
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>choose(b.dataset.tab));
  $('refresh').onclick=load;$('search').oninput=render;
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});window.addEventListener('online',load);
  load();setInterval(load,10000);setInterval(()=>{if(data&&!document.hidden)render();},5000);
})();
