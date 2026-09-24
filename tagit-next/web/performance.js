const $=id=>document.getElementById(id);
try{const r=await fetch('phase1-evidence.json',{cache:'no-cache'});if(!r.ok)throw Error();const e=await r.json();
 if(!Number.isFinite(e.resolved_expectancy_pct)||e.signals!==e.evaluable+e.unevaluable||e.profitability_claim_allowed!==false)throw Error('INVALID_EVIDENCE');
 $('baseline').textContent=`المصدر: سجل discovery-1 بتاريخ ${e.as_of}. ${e.signals} إشارة؛ ${e.evaluable} قابلة للتقييم و${e.unevaluable} ناقصة. متوسط الحالات المقيمة ${Number(e.resolved_expectancy_pct).toFixed(2)}٪ بعد تكلفة افتراضية. هذا ليس عائد جميع الإشارات ولا نتيجة اختبار الهدف والوقف.`;
}catch{$('baseline').textContent='تعذر تحميل دليل خط الأساس.';}
const names={TARGET:'لُمس الهدف في المحاكاة',STOP:'لُمس الوقف في المحاكاة',TIMEOUT:'انتهاء المدة',WAITING:'قيد الرصد',NO_PLAN:'لا خطة مشروطة',NO_ENTRY:'لا دخول وفق النموذج',UNKNOWN_EXIT:'خروج غير محسوم',UNKNOWN_COVERAGE:'تغطية غير مكتملة',UNKNOWN_ROUND_LOT_SIZE:'وحدة حجم العرض غير موثقة',SINGLE_EXCHANGE_OR_DELAYED:'تغطية جزئية أو مؤجلة',INVALIDATED_BEFORE_ENTRY:'أُلغيت قبل الدخول',INVALID_PLAN_OR_EVENT:'بيانات غير صالحة'};
let busy=false;
async function refresh(){if(busy)return;busy=true;try{
 const c=await fetch('live-config.json',{cache:'no-cache'}).then(r=>r.json());const u=new URL(c.endpoint);
 if(u.protocol!=='https:'||u.username||u.password)throw Error();
 const r=await fetch(u.origin+'/api/performance',{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error();const d=await r.json();
 if(d.source!=='SERVER_OBSERVATION_JOURNAL'){$('server').textContent='السجل الخادمي غير متصل؛ لا يوجد أداء حي موثق لعرضه.';return;}
 $('server').textContent=`حتى ${d.as_of}: ${d.signals} إشارة محفوظة، ${d.scans} مسح، ${d.evaluated} سجل تقييم يشمل الحالات غير المحسومة. التخزين ${d.storage}؛ استدامة القرص تتطلب تحقق الاستضافة.`;
 $('runtime').textContent=`الرصد الخلفي ${d.runtime.background_enabled?'مفعّل أثناء الجلسة النظامية':'غير مفعّل'}؛ آخر مسح ${d.runtime.last_scan_at??'غير متاح'}؛ آخر خطأ ${d.runtime.last_error??'لا يوجد مسجل'}.`;
 $('outcomes').replaceChildren();for(const row of d.recent??[]){const tr=document.createElement('tr');for(const value of [row.symbol,row.at,row.feed,names[row.outcome?.status]??'لم يُقيّم بعد']){const td=document.createElement('td');td.textContent=value;tr.append(td);}$('outcomes').append(tr);}
}catch{$('server').textContent='تعذر الوصول إلى السجل الخادمي. لا يعني ذلك عدم وجود إشارات أو أن الأداء صفر.';}
finally{busy=false;}}
$('refresh').onclick=refresh;void refresh();
