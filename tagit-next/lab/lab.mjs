const $=id=>document.getElementById(id);
const labels={baseline:['القاعدة الأساسية','ارتفاع ٠٫٧٪ خلال ٣ دقائق؛ حجم ضعفين؛ تداول ٢٥ ألف دولار؛ ٣٠ صفقة؛ السعر فوق VWAP.'],no_extended:['استبعاد الحركة الممتدة','استبعاد الارتفاع فوق ٢٥٪ لليوم أو ٨٪ خلال ٣ دقائق.'],rvol_tod:['الحجم حسب توقيت اليوم','حجم لا يقل عن ٣ أضعاف المعتاد لهذا التوقيت.'],price_ge_1:['سعر دولار فأكثر','استبعاد الأسهم التي يقل سعرها عن دولار.'],spread_cap:['تقييد فرق السعر','نصف الفرق المقدّر لا يتجاوز ٧٥ نقطة أساس.'],no_dilution:['استبعاد التخفيف','استبعاد إيداعات الطرح والتخفيف في آخر ٣٠ يومًا.'],skip_open_15:['تجاوز أول ربع ساعة','انتظار ١٥ دقيقة من بداية الجلسة.'],target_1r:['هدف مخاطرة واحدة','الهدف يساوي المسافة إلى الوقف، بدل ضعفيها.'],hold_15:['احتفاظ ١٥ دقيقة','تقليص الحد الزمني من ٣٠ إلى ١٥ دقيقة.'],window_low_stop:['وقف عند قاع النافذة','استخدام قاع نافذة الإشارة بدل ATR.'],wide_stop:['وقف لا يقل عن ٣٪','رفع الحد الأدنى للوقف من ١٪ إلى ٣٪.'],quality_combo:['مزيج الجودة','جمع فلاتر الامتداد والحجم حسب التوقيت والسعر والفرق والتخفيف.']};
const num=n=>typeof n==='number'&&Number.isFinite(n);
const pct=n=>num(n)?`${(n*100).toFixed(2)}%`:'—';
const count=n=>num(n)?n.toLocaleString('ar-SA'):'—';
const dated=t=>t&&Number.isFinite(Date.parse(t))?new Date(t).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh',dateStyle:'short',timeStyle:'short'})+' (الرياض)':'—';
function row(values){const tr=document.createElement('tr');for(const v of values){const td=document.createElement('td');td.textContent=v??'—';tr.append(td);}return tr;}
for(const [key,[label,desc]]of Object.entries(labels))$('rule-rows').append(row([`${label} · ${key}`,desc]));
for(const b of document.querySelectorAll('[data-lab-view]'))b.onclick=()=>{for(const x of document.querySelectorAll('[data-lab-view]')){const active=x===b;x.classList.toggle('active',active);x.setAttribute('aria-pressed',String(active));}for(const v of ['results','rules'])$(v+'-view').hidden=v!==b.dataset.labView;resize();};
let busy=false;
async function json(url,timeout=15000){const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(timeout)});if(!r.ok)throw Error(`HTTP_${r.status}`);return r.json();}
function connection(d,archived=false){const code=d?.status;const texts={CONNECTED:'متصل ببيانات Alpaca التاريخية',NO_DATA:'استجاب المزود دون بيانات كافية',FEED_NOT_ENTITLED:'بيانات SIP غير متاحة لهذا الحساب',PROVIDER_AUTH_FAILED:'تعذر اعتماد مفاتيح Alpaca',RUNTIME_CREDENTIALS_NOT_CONFIGURED:'مفاتيح Alpaca غير مهيأة على الخادم',RATE_LIMITED:'بلغ الاتصال حد الطلبات؛ أعد المحاولة لاحقًا',PROVIDER_UNAVAILABLE:'مزود البيانات غير متاح مؤقتًا',CONNECTION_FAILED:'تعذر التحقق من الاتصال'};
 $('lab-status').textContent=(archived?'آخر فحص محفوظ: ':'')+(texts[code]||'تعذر التحقق من الاتصال');$('lab-status').dataset.connected=String(code==='CONNECTED'&&!archived);
 $('lab-connection-detail').textContent=code==='CONNECTED'?`تحقق فعلي من ${count(d.sample_bars)} شموع تاريخية. البيانات اللحظية للسوق منفصلة عن المختبر.`:'لم يُستبدل SIP بمصدر آخر. نتائج البحث تنتظر توفر البيانات المطلوبة.';
 $('lab-checked').textContent=d?.checked_at?'وقت الفحص: '+dated(d.checked_at):'قد يحتاج تشغيل الخادم نحو دقيقة.';
}
function render(d){
 const f=d.forward,s=f?.summary;
 $('sessions').textContent=count(f?.sessions_evaluated);$('trade-count').textContent=count(s?.n);$('mean-ret').textContent=pct(s?.mean_ret);
 $('last-session').textContent=f?.last_date?'آخر جلسة: '+f.last_date:'لا يوجد سجل منشور بعد';
 $('confidence').textContent=s?.mean_ret_ci?`فاصل الثقة: ${s.mean_ret_ci.map(pct).join(' إلى ')}`:'فاصل الثقة ٩٥٪';
 $('dev-stage').textContent=d.development?'نتائج منشورة':'لم يبدأ';$('wf-stage').textContent=d.walkforward?.verdict?.ar||'بانتظار البحث';$('holdout-stage').textContent=d.holdout?'فُتحت؛ راجع التقرير':'مغلقة';$('forward-stage').textContent=f?.last_date||'بانتظار أول جلسة';
 $('verdict').textContent=f?.verdict?.ar?`${f.verdict.ar} هذه نتيجة مرحلة المتابعة فقط؛ يلزم اكتمال بقية اختبارات التحقق.`:'لم تُنشر نتائج بحث بعد. اكتمال الربط لا يثبت ربحية الاستراتيجية.';
 $('report-link').hidden=!d.report_available;$('result-updated').textContent=d.published_at?'تحديث: '+dated(d.published_at):'';
 $('variant-results').replaceChildren();for(const [name,v]of Object.entries(d.development||{}))$('variant-results').append(row([labels[name]?.[0]||name,count(v.n),pct(v.win_rate),pct(v.mean_ret),v.mean_ret_ci?.map(pct).join(' / ')||'—']));
 $('results-empty').hidden=Boolean(Object.keys(d.development||{}).length);$('recent-trades').replaceChildren();
 const reasons={stop:'وقف الخسارة',target:'الهدف',time:'انتهاء المدة'};
 for(const t of d.recent_trades||[])$('recent-trades').append(row([t.date,t.symbol,labels[t.variant]?.[0]||t.variant,pct(t.ret),reasons[t.exit_reason]||t.exit_reason]));
 $('trades-empty').hidden=Boolean(d.recent_trades?.length);resize();
}
async function refresh(){if(busy)return;busy=true;$('refresh-lab').disabled=true;$('lab-status').textContent='جارٍ فحص الاتصال…';let data;
 const resultsPromise=json('results/summary.json').then(d=>{data=d;render(d);}).catch(()=>{$('verdict').textContent='تعذر تحميل ملف النتائج. أعد التحديث؛ لا تُعد هذه الحالة نتيجة للاختبار.';});
 try{const cfg=await json('../live-config.json');const endpoint=new URL(cfg.endpoint);if(endpoint.protocol!=='https:')throw Error('INVALID_ENDPOINT');connection(await json(endpoint.origin+'/api/lab/connection',70000));}
 catch{await resultsPromise;if(data?.connection)connection(data.connection,true);else connection({status:'CONNECTION_FAILED'});}
 await resultsPromise;$('refresh-lab').disabled=false;busy=false;resize();
}
function resize(){if(window.parent!==window)window.parent.postMessage({type:'tagit-lab-height',height:Math.ceil(document.body.getBoundingClientRect().height)},location.origin);}
function theme(){try{document.body.classList.toggle('dark',parent.document.body.classList.contains('dark'));}catch{}}
window.addEventListener('message',e=>{if(e.origin===location.origin&&e.data?.type==='tagit-theme'){document.body.classList.toggle('dark',e.data.dark);resize();}});
$('refresh-lab').onclick=refresh;new ResizeObserver(resize).observe(document.body);theme();void refresh();
