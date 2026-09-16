import {viewQuote,serviceOrigin,validPayload} from './price-state.mjs';
const el=id=>document.getElementById(id);
const labels={RECENT_IEX:'تحديث حديث · IEX فقط',RECENT_SIP:'تحديث حديث · SIP',STALE:'سعر قديم',DELAYED:'متأخر 15 دقيقة',WIDE_SPREAD:'فارق طلب وعرض مرتفع',INVALID_QUOTE:'سعر غير صالح أو مفقود',FUTURE_TIMESTAMP:'توقيت غير صالح'};
const errors={HOSTING_ACCESS_REQUIRED:'خدمة الأسعار جاهزة برمجيًا، لكن يلزم ربط حساب الاستضافة وضبط بيانات مزود الأسعار قبل تشغيل الاتصال.',VERCEL_DAILY_LIMIT:'نشر خادم الأسعار متوقف مؤقتًا بسبب الحد اليومي للاستضافة. الربط الفعلي لم يعمل بعد.',RUNTIME_CREDENTIALS_NOT_CONFIGURED:'لم تُضبط مفاتيح Alpaca في خادم الأسعار.',FEED_NOT_ENTITLED:'الحساب لا يملك صلاحية مصدر الأسعار المحدد.',PROVIDER_AUTH_FAILED:'تعذر توثيق اتصال الخادم بمزود الأسعار.',RATE_LIMITED:'وصل مزود البيانات إلى حد الطلبات؛ ستتم إعادة المحاولة بعد مهلة.',CURRENT_UNIVERSE_REQUIRED:'مرجع القيمة السوقية غير حديث أو غير متاح. تعذر التحقق من شرط أقل من مليار دولار.',INELIGIBLE_SYMBOLS:'رمز غير مؤهل وفق مرجع القيمة السوقية الحالي، أو غير موجود فيه.',INVALID_SYMBOLS:'أدخل من 1 إلى 20 رمز سهم، مفصولة بفواصل.',INVALID_PAYLOAD:'الاستجابة غير متوافقة مع شروط البيانات؛ لم تُعرض كسعر صالح.',PROVIDER_UNAVAILABLE:'تعذر الوصول إلى مزود الأسعار.',DISCONNECTED:'انقطع اتصال الأسعار. البيانات السابقة لم تعد تُعرض كأسعار متصلة.'};
const money=n=>typeof n==='number'&&Number.isFinite(n)?'$'+n.toLocaleString('en-US',{maximumFractionDigits:4}):'—';
const time=s=>{const d=new Date(s);return Number.isFinite(d.getTime())?d.toLocaleTimeString('en-GB',{timeZone:'America/New_York',hour12:false}):'—';};
const ago=ms=>ms===null?'غير معروف':ms<1000?'أقل من ثانية':Math.floor(ms/1000)+' ث';
let endpoint=null,config=null,rows=[],received=0,requestDuration=0,generation=0,controller=null,timer=null,failures=0,paused=false,currentSymbols=[];
function item(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function render(){
 el('price-rows').replaceChildren(...rows.map(row=>{
  const state=viewQuote(row,performance.now()-received+requestDuration),tr=item('tr');
  tr.append(item('td',row.symbol,'num'),item('td',money(row.trade?.price),'num'),item('td',money(row.quote?.bid),'num'),item('td',money(row.quote?.ask),'num'));
  const status=item('td');status.append(item('span',paused?'موقوف':labels[state.status]||'حالة غير معروفة','badge '+(['RECENT_IEX','RECENT_SIP'].includes(state.status)?'TARGET':state.status==='STALE'?'UNKNOWN_TIMEOUT_QUOTE':'')));tr.append(status);
  const timing=item('td');timing.append(item('div','طلب/عرض: '+time(row.quote?.timestamp)+' · '+ago(state.quoteAge)),item('small','آخر صفقة: '+time(row.trade?.timestamp)+' · '+ago(state.tradeAge)+(state.tradeStatus==='STALE'?' · قديمة':'')));tr.append(timing);
  tr.append(item('td',(row.market_cap/1e6).toLocaleString('en-US',{maximumFractionDigits:2})+' M','num'));return tr;
 }));
}
function stopRequest(){generation++;controller?.abort();controller=null;clearTimeout(timer);timer=null;}
function chooseSymbols(){const s=[...new Set(el('price-symbols').value.toUpperCase().split(',').map(x=>x.trim()).filter(Boolean))];if(!s.length||s.length>20||s.some(x=>!/^[A-Z][A-Z0-9.-]{0,9}$/.test(x)))throw new Error('INVALID_SYMBOLS');return s;}
function message(code){el('price-status').textContent=errors[code]||errors.DISCONNECTED;el('price-status').dataset.state='error';}
function schedule(){if(endpoint&&!paused&&!document.hidden)timer=setTimeout(refresh,failures?Math.min(60000,5000*2**Math.min(failures,4)):5000);}
async function refresh(){
 if(!endpoint||paused||document.hidden||controller)return;
 let symbols;try{symbols=chooseSymbols();}catch(e){message(e.message);return;}
 const epoch=generation;const abort=new AbortController();controller=abort;const timeout=setTimeout(()=>abort.abort(),9000);const started=performance.now();
 el('price-refresh').disabled=true;
 try{
  const r=await fetch(endpoint+'/api/quotes?symbols='+encodeURIComponent(symbols.join(',')),{cache:'no-store',signal:abort.signal});const p=await r.json();
  if(epoch!==generation)return;
  if(!r.ok||!['OK','PARTIAL'].includes(p.status))throw new Error(p.status||'DISCONNECTED');
  if(!validPayload(p,symbols))throw new Error('INVALID_PAYLOAD');
  rows=p.rows;currentSymbols=symbols;requestDuration=performance.now()-started;received=performance.now();failures=0;
  el('price-status').textContent='اتصال الخدمة يعمل · طلب أسعار كل 5 ثوانٍ أثناء فتح الصفحة. حداثة كل سعر موضحة في صفه.';el('price-status').dataset.state='connected';
  el('price-feed').textContent=p.feed==='iex'?'IEX · سوق واحد':p.feed==='sip'?'SIP · أسعار مجمعة':'SIP · متأخر 15 دقيقة';
  el('price-reference').textContent='القيمة السوقية وفق مرجع '+new Date(p.metadata_at).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh',calendar:'gregory'})+' · نطاق مرجعي، وليس جميع الأسهم الأمريكية.';
  el('price-rejected').textContent=p.rejected?.length?'لم تُطلب أسعار الرموز التالية لعدم تحقق أهليتها في المرجع الحالي: '+p.rejected.join(', '):'';el('price-empty').hidden=true;render();
 }catch(e){if(epoch!==generation)return;rows=[];render();el('price-feed').textContent='غير متصل';el('price-rejected').textContent='';el('price-empty').hidden=false;message(e.message);failures++;}
 finally{clearTimeout(timeout);if(epoch===generation){controller=null;el('price-refresh').disabled=!endpoint||paused;schedule();}}
}
function begin(){if(!endpoint){message(config?.deployment_status);return;}stopRequest();rows=[];render();failures=0;paused=false;el('price-empty').hidden=false;el('price-status').textContent='جارٍ طلب الأسعار…';el('price-status').dataset.state='connecting';el('price-pause').textContent='إيقاف مؤقت';refresh();}
el('price-form').addEventListener('submit',e=>{e.preventDefault();begin();});
el('price-pause').addEventListener('click',()=>{paused=!paused;stopRequest();el('price-pause').textContent=paused?'استئناف':'إيقاف مؤقت';el('price-refresh').disabled=paused||!endpoint;if(paused){el('price-status').textContent='التحديث موقوف يدويًا.';el('price-status').dataset.state='paused';render();}else{el('price-status').textContent='جارٍ استئناف الاتصال…';el('price-status').dataset.state='connecting';refresh();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopRequest();el('price-status').textContent='التحديث متوقف أثناء إخفاء الصفحة.';el('price-status').dataset.state='paused';}else if(endpoint&&!paused)refresh();});
setInterval(()=>{if(rows.length)render();},1000);
async function loadConfig(){
 try{const r=await fetch('live-config.json',{cache:'no-store'});if(!r.ok)throw new Error('CONFIG_UNAVAILABLE');config=await r.json();if(config.schema_version!==1||config.approved_for_live!==false)throw new Error('CONFIG_UNAVAILABLE');el('price-symbols').value=config.default_symbols.join(', ');if(!config.endpoint){message(config.deployment_status);return;}endpoint=serviceOrigin(config.endpoint);el('price-refresh').disabled=false;el('price-pause').disabled=false;refresh();}
 catch{el('price-status').textContent='لم يُضبط اتصال خادم الأسعار أو تعذر تحميل إعداداته. سجل الاختبارات أدناه متاح.';}
}
loadConfig();
