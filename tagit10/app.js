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
  const labels = {WATCH:'مراقبة',EARLY:'رصد مبكر',ACTIONABLE:'مرشح بحثي',CONFIRMED:'تكرر الرصد',STALE:'بيانات غير متاحة',INVALIDATED:'اتجاه ضعيف',EXTENDED:'حركة ممتدة'};
  const titles = {plans:'خطط دخول مشروطة — للمحاكاة',setups:'أنماط الجلسة — بحثية غير معتمدة',early:'الفرص المبكرة',actionable:'اجتازت الفلترة',confirmed:'رصد متكرر — غير معتمد للتداول',watch:'حركة نامية — قائمة المتابعة',invalidated:'اتجاه ضعيف أو حركة ممتدة',unavailable:'بيانات غير مكتملة أو متأخرة'};
  let data=null, tab='watch', selected=null, busy=false, error=false;
  function valid(d) {return d && Number.isFinite(stamp(d.updatedAtUTC)) && stamp(d.updatedAtUTC)<=Date.now()+30000 && Array.isArray(d.watch);}
  function feedFresh(){const s=seconds(data?.updatedAtUTC);return !error && s>=-30 && s<=180 && ['regular','pre-market','after-hours'].includes(data?.session);}
  function discovery(x){
    const b=x.riskBlocks||[];
    if(x.stage==='STALE'||!x.fresh||b.some(k=>['INCOMPLETE_WINDOWS','UNVERIFIED_SESSION','UNSUPPORTED_INSTRUMENT'].includes(k)))return 'UNAVAILABLE';
    if(b.includes('FALLING_PRICE'))return 'INVALIDATED';
    if(b.includes('EXTENDED_MOVE'))return 'EXTENDED';
    return b.length?'WATCH':x.stage==='WATCH'?'DEVELOPING':'OBSERVED';
  }
  function rows(){
    const map=new Map();
    for(const key of ['watch','early','actionable','confirmed','invalidated','unavailable','sessionSetups','conditionalPlans']) for(const x of data?.[key]||[]){
      if(!x || !/^[A-Z0-9.^-]{1,12}$/.test(x.symbol||''))continue;
      map.set(x.symbol,x);
    }
    return [...map.values()].map(x=>{
      const start=stamp(x.quoteTimestampUTC), close=x.barCloseTimestampUTC?stamp(x.barCloseTimestampUTC):start+60000;
      const qAge=(Date.now()-close)/1000, fresh=Math.abs(close-start-60000)<1&&qAge>=0&&qAge<=60&&num(x.price)>0;
      let stage=x.stage;
      if(!feedFresh()||!fresh)stage='STALE';
      // Old engines cannot supply the required two-observation confirmation.
      else if(data.engineVersion!=='10.3' || x.screeningVersion!=='10.3' ||
        x.screeningPassed!==true || x.barClosed!==true || (x.riskBlocks||[]).length)stage='WATCH';
      else if(stage==='CONFIRMED' && (num(x.confirmationCount)||0)<2)stage='ACTIONABLE';
      const row={...x,stage,qAge,fresh};return {...row,discoveryState:discovery(row)};
    }).sort((a,b)=>({OBSERVED:5,DEVELOPING:4,WATCH:3,EXTENDED:2,INVALIDATED:1,UNAVAILABLE:0}[b.discoveryState]-{OBSERVED:5,DEVELOPING:4,WATCH:3,EXTENDED:2,INVALIDATED:1,UNAVAILABLE:0}[a.discoveryState])||({CONFIRMED:3,ACTIONABLE:2,EARLY:1}[b.stage]||0)-({CONFIRMED:3,ACTIONABLE:2,EARLY:1}[a.stage]||0)||(num(b.ret5mPct)??-1e9)-(num(a.ret5mPct)??-1e9)||(num(b.ret15mPct)??-1e9)-(num(a.ret15mPct)??-1e9));
  }
  function waiting(x){
    if(tab==='plans'&&x.conditionalPlan)return window.TagitExecution.label(x);
    if(x.stage==='STALE')return 'البيانات متأخرة أو غير متاحة؛ لا يمكن تقييم فرصة الآن.';
    if(tab==='setups'&&window.TagitSession?.current(x))return window.TagitSession.label(x.sessionSetup)+' · رصد بحثي؛ لم تثبت ربحيته.';
    if(x.discoveryState==='INVALIDATED')return 'اتجاه السعر لا يؤيد الصعود الآن؛ نشاط التداول وحده لا يكفي.';
    if(['EARLY','ACTIONABLE','CONFIRMED'].includes(x.stage))return 'رصد نشط · افتح التفاصيل لفحص السعر والسيولة.';
    const names={INCOMPLETE_WINDOWS:'استكمال شموع الدقيقة',LOW_LIQUIDITY:'سيولة أعلى',FALLING_PRICE:'تحسن اتجاه السعر',EXTENDED_MOVE:'حركة أقل امتدادًا',UNSUPPORTED_INSTRUMENT:'التحقق من نوع الورقة',UNVERIFIED_SESSION:'جلسة مفتوحة'};
    const failed=(x.riskBlocks||[]).map(k=>names[k]||k);
    if(num(x.volumeAcceleration15m)==null)failed.push('قياس تسارع الحجم');
    else if(x.volumeAcceleration15m<1.2)failed.push('تسارع الحجم إلى 1.2×');
    if(num(x.range15mPct)!=null&&x.range15mPct>5.5)failed.push('ضيق النطاق السعري');
    if(num(x.score)==null||x.score<34)failed.push('اجتياز درجة الرصد');
    return 'المطلوب: '+(failed.slice(0,3).join(' · ')||'اكتمال شروط الرصد');
  }
  function choose(t){tab=t;render();}
  function render(){
    const all=rows(), isFresh=feedFresh(), fAge=seconds(data?.updatedAtUTC);
    const groups={plans:all.filter(x=>x.conditionalPlan),setups:all.filter(x=>window.TagitSession?.current(x)),watch:all.filter(x=>['OBSERVED','DEVELOPING','WATCH'].includes(x.discoveryState)),invalidated:all.filter(x=>['INVALIDATED','EXTENDED'].includes(x.discoveryState)),unavailable:all.filter(x=>x.discoveryState==='UNAVAILABLE'),early:all.filter(x=>['EARLY','ACTIONABLE','CONFIRMED'].includes(x.stage)&&num(x.changePct)!=null&&x.changePct<10),actionable:all.filter(x=>['ACTIONABLE','CONFIRMED'].includes(x.stage)),confirmed:all.filter(x=>x.stage==='CONFIRMED')};
    const freshCount=!isFresh?0:data?.freshnessBuckets?Object.entries(data.freshnessBuckets).reduce((n,[t,count])=>n+(seconds(t)>=-30&&seconds(t)<=120?count:0),0):all.filter(x=>x.fresh).length;
    const available=data?.freshnessBuckets?data.quotesValid:all.length;
    const partial=freshCount<available, assessable=isFresh&&freshCount>0;
    const dh=data?.dataHealth;
    window.TagitSession?.forward(data);
    window.TagitExecution?.health(data);
    $('status').textContent=error?'تعذر التحديث':!data?'جارٍ الاتصال':!isFresh?'التغذية متأخرة / مغلقة':freshCount===0?'بانتظار تحديث الأسعار':partial?'تغطية جزئية':'أسعار حديثة';
    $('status').dataset.state=isFresh&&freshCount>0&&!partial?'live':'stale';
    $('session').textContent=({regular:'الجلسة الرئيسية','pre-market':'ما قبل الجلسة','after-hours':'ما بعد الجلسة',closed:'الجلسة مغلقة'})[data?.session]||'حالة الجلسة غير متاحة';
    $('health').className=`health ${isFresh&&freshCount>0&&!partial?'live':''}`;
    $('health').textContent=!data?'تعذر الوصول للمحرك. إعادة المحاولة تلقائية.':`السعر حديث في ${freshCount} من ${available} سهم متاح · الملف منذ ${ageText(fAge)} · تحديث المحرك المستهدف ${data.truth?.backendCadenceSeconds||'—'}ث.`;
    if(dh)$('health').textContent+=` تغطية آخر 5 دقائق: ${fmt(dh.successfulLast5m,0)} / ${fmt(dh.directorySize,0)}. تعذر جلب ${fmt(dh.unavailableThisScan,0)} سهم في هذه الدورة.`;
    const q=data?.quality, eq=q?.byStage?.EARLY;
    $('quality').textContent=q ? `إصابة هدف +3% للرصد المبكر: ${eq?.precisionPct==null?'لم تكتمل العينة':fmt(eq.precisionPct)+'%'} · نتائج مكتملة ${eq?.resolved||0} · قيد المتابعة ${eq?.pending||0} · تعذر قياسها ${eq?.unscorable||0} · جلسات ${eq?.sessions||0} · متوسط العائد بعد التكلفة ${eq?.meanNetReturnPct==null?'غير متاح':fmt(eq.meanNetReturnPct)+'%'}. المعيار: افتتاح أول دقيقة كاملة بعد الرصد، +3% قبل −2% خلال 30 دقيقة. يسبق الوقف الهدف عند غموض ترتيب الحركة، مع تكلفة مفترضة 0.4%. ليست نتائج تنفيذ فعلي.` : 'قياس النسخة الجديدة قيد التهيئة؛ لا توجد دقة 95% مثبتة.';
    $('universe').textContent=fmt(data?.universeScanned,0);
    $('coverage').textContent=`${fmt(freshCount,0)} / ${fmt(available,0)}`;
    for(const [id,key] of [['watchN','watch'],['earlyN','early'],['actionN','actionable'],['confirmedN','confirmed']])$(id).textContent=assessable?groups[key].length:'—';
    $('asof').textContent=data?new Date(data.updatedAtUTC).toLocaleString('en-US',{timeZone:'America/New_York'})+' ET':'—';
    $('feedAge').textContent=data?` · منذ ${ageText(fAge)}`:'';
    document.querySelectorAll('[data-tab]').forEach(b=>{const on=b.dataset.tab===tab;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));});
    const query=$('search').value.trim().toUpperCase();
    const xs=groups[tab].filter(x=>x.symbol.includes(query));
    $('title').textContent=titles[tab];$('resultCount').textContent=`${xs.length} سهم`;
    if(!xs.length)$('rows').innerHTML=`<div class="empty"><b>${!assessable?'لا يمكن تقييم الفرص الآن':query?'لا توجد نتائج للرمز':tab==='unavailable'?'لا توجد بيانات ناقصة في القائمة المعروضة':tab==='invalidated'?'لا توجد حالات ضعف في القائمة المعروضة':'لا توجد حالات مجتازة في البيانات المتاحة'}</b>${tab==='setups'?'يعرض هذا القسم شموع 5 دقائق حديثة مع مقارنة حجم بجلسات سابقة. عدم توفر نمط لا يعني غياب فرص في السوق. افتح الأداء لنتائج الدراسة.':!assessable?'التغذية متأخرة أو الأسعار غير متاحة. هذا لا يعني غياب فرص في السوق. إعادة المحاولة تلقائية.':query?'جرّب الرمز في القوائم الأخرى.':'هذه النتيجة تخص الأسهم المغطاة فقط؛ راجع التغطية والقوائم الأخرى.'}${tab!=='watch'?'<br><button id="showWatch">عرض المراقبة</button>':''}</div>`;
    else $('rows').innerHTML=xs.map(x=>`<button type="button" class="row ${selected===x.symbol?'selected':''}" data-symbol="${esc(x.symbol)}" aria-label="تفاصيل ${esc(x.symbol)}"><span><b dir="ltr">${esc(x.symbol)}</b><small>${esc(({OBSERVED:'رصد شروط',DEVELOPING:'حركة نامية',WATCH:'قيد المتابعة',INVALIDATED:'اتجاه ضعيف',EXTENDED:'حركة ممتدة',UNAVAILABLE:'بيانات ناقصة'})[x.discoveryState])}</small></span><span class="stage"><span class="pill ${x.stage.toLowerCase()}">${esc(labels[x.discoveryState==='INVALIDATED'?'INVALIDATED':x.discoveryState==='EXTENDED'?'EXTENDED':x.stage]||x.stage)}</span><small>إغلاق الشمعة منذ ${ageText(x.qAge)}</small></span><span class="number"><b>${num(x.price)!=null?'$'+fmt(x.price,4):'—'}</b><small class="${num(x.changePct)>=0?'good':'warn'}">${pct(x.changePct)}</small></span><span class="row-flow">5د <b class="${num(x.ret5mPct)>=0?'good':'warn'}">${pct(x.ret5mPct)}</b> · 15د <b>${pct(x.ret15mPct)}</b> · تسارع الحجم <b>${fmt(x.volumeAcceleration15m)}×</b></span><span class="row-reason">${esc(waiting(x))}</span></button>`).join('');
    if($('showWatch'))$('showWatch').onclick=()=>choose('watch');
    document.querySelectorAll('[data-symbol]').forEach(b=>b.onclick=()=>{selected=b.dataset.symbol;render();if(matchMedia('(max-width:900px)').matches)document.querySelector('.details').classList.add('is-open');});
    const x=xs.find(x=>x.symbol===selected)||xs[0];
    if(x){selected=x.symbol;detail(x);}else {$('detail').innerHTML='<div class="empty">اختر سهمًا من قائمة المراقبة لفحص البيانات وأسباب الرصد.</div>';selected=null;}
  }
  function detail(x){
    const cell=(title,value)=>`<div><span>${title}</span><b>${value}</b></div>`;
    const why=Array.isArray(x.reasons)?[...x.reasons]:[];
    if(x.stage==='WATCH'||x.stage==='STALE')why.unshift(waiting(x));
    if(data?.engineVersion!=='10.3'||x.screeningVersion!=='10.3')why.unshift('هذه اللقطة من محرك سابق؛ لا تُعرض كمرشح بحثي جديد.');
    if(x.stage==='WATCH' && x.screeningPassed!==true && !why.length)why.push('لم تكتمل متطلبات الفلترة؛ تبقى للمراقبة.');
    const verdict=x.stage==='CONFIRMED'?'تكرر اجتياز الفلترة في شمعتين مغلقتين مع ثبات السعر. هذا تكرار من المصدر نفسه، وليس دليلاً مثبتًا على ربحية التداول.':x.stage==='STALE'?'البيانات غير حديثة؛ لا تعتمد هذه اللقطة للدخول.':x.stage==='ACTIONABLE'?'اجتازت فلترة البيانات والسيولة والاتجاه. مرشح بحثي يحتاج إلى قياس نتائج مستقبلية.':'للمتابعة فقط: لم تكتمل شروط التأكيد.';
    window.dispatchEvent(new CustomEvent('tagit-selection',{detail:x}));
    $('detail').innerHTML=`<div class="detail-top"><h2 dir="ltr">${esc(x.symbol)}</h2><span class="pill ${x.stage.toLowerCase()}">${esc(labels[x.stage]||x.stage)}</span></div><div class="price">$${fmt(x.price,4)} <small class="${num(x.changePct)>=0?'good':'warn'}">${pct(x.changePct)}</small></div><div class="verdict">${verdict}</div><div class="data-grid">${cell('حركة 5 دقائق',pct(x.ret5mPct))}${cell('حركة 15 دقيقة',pct(x.ret15mPct))}${cell('حجم 5 دقائق',fmt(x.volume5m,0))}${cell('تسارع حجم 15 دقيقة',num(x.volumeAcceleration15m)!=null?fmt(x.volumeAcceleration15m)+'×':'—')}${cell('قيمة تداول 5 دقائق',num(x.dollarVolume5m)!=null?'$'+fmt(x.dollarVolume5m,0):'—')}${cell('قيمة تداول 15 دقيقة',num(x.dollarVolume15m)!=null?'$'+fmt(x.dollarVolume15m,0):'—')}${cell('التراجع من قمة الجلسة',pct(x.drawdownFromHighPct))}${cell('الحجم النسبي',num(x.relativeVolume)!=null?fmt(x.relativeVolume)+'×':'—')}${cell('شموع رصد متتالية',fmt(x.confirmationCount,0))}</div><button type="button" id="useInPlan" class="refresh">Build a paper trade plan / بناء خطة</button><h4>مستويات المتابعة</h4><div class="data-grid">${cell('قمة نطاق 15 دقيقة',num(x.breakout15m)!=null?'$'+fmt(x.breakout15m,4):'—')}${cell('قاع نطاق 15 دقيقة',num(x.support15m)!=null?'$'+fmt(x.support15m,4):'—')}</div><p class="note">قمة وقاع شموع الدقيقة المغلقة. مستويات بحثية؛ السبريد والأخبار وحالة الإيقاف غير متحقق منها.</p>${window.TagitExecution?.detail(x)||''}${window.TagitSession?.detail(x)||''}${window.TagitExplosion?.detail(x.explosive)||''}<h4>لماذا ظهر السهم؟</h4><ul class="reasons">${why.length?why.map(t=>`<li>${esc(t)}</li>`).join(''):'<li>النسخة الحالية من التغذية لا توفر تفسيرًا تفصيليًا لهذه الإشارة.</li>'}</ul><p class="note">إغلاق شمعة السعر منذ: ${ageText(x.qAge)} · المصدر: ${esc(x.source||'Yahoo 1m + Finviz')}<br>مقياس نشاط التداول ${fmt(x.score)} / 100 غير معتمد لتوقع الصعود؛ لا يرتب قائمة المتابعة.</p>`;
  }
  async function get(url){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6500);
    try{const r=await fetch(`${url}?t=${Date.now()}`,{cache:'no-store',signal:controller.signal});if(!r.ok)throw new Error('feed');const d=await r.json();if(!valid(d))throw new Error('schema');return d;}finally{clearTimeout(timer);}
  }
  async function load(){
    if(busy||document.hidden)return;busy=true;$('refresh').disabled=true;
    let successes=0;
    try{
      // Render each successful response immediately; a slow mirror cannot hold it up.
      await Promise.allSettled(URLS.map(async url=>{
        const candidate=await get(url);successes++;
        if(!data||stamp(candidate.updatedAtUTC)>=stamp(data.updatedAtUTC))data=candidate;
        error=false;render();
      }));
      error=successes===0;
    }finally{busy=false;$('refresh').disabled=false;render();}
  }
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>choose(b.dataset.tab));
  $('detailClose').onclick=()=>document.querySelector('.details').classList.remove('is-open');
  document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelector('.details').classList.remove('is-open');});
  $('refresh').onclick=load;$('search').oninput=render;
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});window.addEventListener('online',load);
  document.addEventListener('click',e=>{if(e.target.closest('#useInPlan'))window.dispatchEvent(new CustomEvent('tagit-plan-request'));});
  load();setInterval(load,10000);setInterval(()=>{if(data&&!document.hidden)render();},5000);
})();


