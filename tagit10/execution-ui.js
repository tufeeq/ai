(()=>{'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const n=(v,d=4)=>Number.isFinite(v)?v.toLocaleString('en-US',{maximumFractionDigits:d}):'—';
 const reasons={QUOTE_UNAVAILABLE:'عروض الشراء والبيع غير متاحة',QUOTE_EXPIRED:'انتهت حداثة العرض',INVALID_BID_ASK:'عرض سعر غير صالح',SPREAD_TOO_WIDE:'السبريد أكبر من 0.3%',UNSUPPORTED_QUOTE_FEED:'مصدر غير مدعوم',PLAN_EXPIRED:'انتهت صلاحية الخطة',STRUCTURE_UNAVAILABLE:'شروط السعر أو البيانات غير مكتملة',PLAN_INVALIDATED:'أُبطلت الخطة',STOP_ALREADY_BREACHED:'السعر كسر مستوى الإبطال',ENTRY_ALREADY_EXTENDED:'السعر تجاوز الحد الأعلى للدخول'};
 const providerLabels={RUNTIME_CREDENTIALS_NOT_CONFIGURED:'اتصال Alpaca المستمر غير مهيأ',AUTH_OR_ENTITLEMENT_DENIED:'رفض Alpaca المصادقة أو صلاحية البيانات',PROVIDER_UNAVAILABLE:'تعذر الوصول إلى Alpaca',PROVIDER_ERROR:'خطأ من مزود البيانات',PARTIAL:'تغطية عروض جزئية',OK:'استجابة Alpaca متاحة',NO_QUALIFYING_SYMBOLS:'لا توجد رموز مكتملة الشروط في هذه الدورة',INVALID_FEED_CONFIGURATION:'إعداد مصدر البيانات غير صالح'};
 function expiry(p){return (Date.parse(p?.expiresAtUTC||'')-Date.now())/1000;}
 function status(row){const p=row?.conditionalPlan;if(!p)return 'UNAVAILABLE';
  if(!Number.isFinite(expiry(p))||expiry(p)<=0)return 'EXPIRED';
  const q=p.quote,age=(Date.now()-Date.parse(q?.timestampUTC||''))/1000;
  if(!row.fresh||row.stage==='STALE'||row.screeningPassed!==true||(row.riskBlocks||[]).length)return 'BLOCKED';
  if(!q||!Number.isFinite(age)||age<0||age>15)return 'WAITING_FOR_QUOTE';
  return p.status;
 }
 const labels={PAPER_TRIGGER_OBSERVED:'لُوحظ شرط الدخول — للمحاكاة',WAITING_FOR_TRIGGER:'بانتظار اختراق مستوى الدخول',WAITING_FOR_QUOTE:'بانتظار عرض سعر حديث',EXPIRED:'خطة منتهية',BLOCKED:'الخطة غير مستوفية للشروط',UNAVAILABLE:'الخطة غير متاحة'};
 window.TagitExecution={status,
  label(row){return labels[status(row)]||'خطة مشروطة';},
  health(data){const el=document.getElementById('quoteHealth');if(!el)return;
   const h=data?.quoteValidation?.provider;
   el.textContent=h?`${providerLabels[h.status]||h.status} · المصدر ${h.feed?.toUpperCase()||'—'}${h.feed==='iex'?' (بورصة واحدة)':''} · عروض حديثة وقت المسح ${n(data.quoteValidation.freshQuotes,0)} / ${n(h.requested,0)}. الخطط مشروطة وغير معتمدة للتداول الحقيقي.`:'بانتظار حالة اتصال عروض السعر. لا توجد موافقة تداول مثبتة.';
  },
  detail(row){const p=row?.conditionalPlan;if(!p)return '';
   const q=p.quote,age=q?(Date.now()-Date.parse(q.timestampUTC))/1000:null;
   const cell=(label,value)=>`<div><span>${label}</span><b>${value}</b></div>`;
   return `<section class="research-panel" data-plan-id="${esc(p.id)}"><h4>خطة دخول مشروطة</h4><p class="warn">${esc(this.label(row))}</p><div class="data-grid">${cell('شرط الدخول — ask يصل إلى','$'+n(p.entryTrigger))}${cell('أعلى سعر دخول في المحاكاة','$'+n(p.entryLimit))}${cell('مرجع الإبطال / الوقف','$'+n(p.stopReference))}${cell('سيناريو الهدف — ليس توقعًا','$'+n(p.targetScenario))}${cell('Bid / Ask',q?'$'+n(q.bid)+' / $'+n(q.ask):'غير متاح')}${cell('السبريد',q&&q.ask>0&&q.bid>0?n(100*(q.ask-q.bid)/((q.ask+q.bid)/2),3)+'%':'—')}${cell('عمر العرض',age!=null&&Number.isFinite(age)?n(Math.max(0,age),0)+' ث':'—')}${cell('الصلاحية المتبقية',n(Math.max(0,expiry(p)),0)+' ث')}</div><p>${(p.blocks||[]).map(b=>esc(reasons[b]||b)).join(' · ')}</p><p class="note">${esc(q?.feed?.toUpperCase()||'لا يوجد مصدر عروض')} ${q?.feed==='iex'?'يمثل بورصة واحدة ولا يثبت أفضل سعر في السوق.':''} الهدف محسوب عند أعلى سعر دخول لتحقيق 2R بعد انزلاق مفترض 0.2% لكل جانب وعمولة صفر. هذه افتراضات وليست تنفيذًا فعليًا؛ تحقق الأخبار والإيقاف واعتماد الاستراتيجية لم يكتمل.</p><button type="button" id="copyConditionalPlan" class="refresh" ${expiry(p)>0?'':'disabled'}>نقل الخطة إلى المحاكاة</button></section>`;
  }
 };
})();
