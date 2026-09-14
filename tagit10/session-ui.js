(()=>{'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const num=(n,d=2)=>Number.isFinite(n)?n.toLocaleString('en-US',{maximumFractionDigits:d}):'—';
 const names={OPENING_IMPULSE:'اندفاع الافتتاح',RANGE_BREAKOUT:'اختراق نطاق',PULLBACK_RECLAIM:'استعادة بعد تراجع'};
 const cell=(label,value)=>`<div><span>${label}</span><strong>${value}</strong></div>`;
 let loaded=false,busy=false;
 async function load(force=false){
  const el=document.getElementById('sessionReport');if(!el||busy||loaded&&!force)return;busy=true;
  el.textContent='جارٍ تحميل دراسة أنماط الجلسة…';
  try{
   const r=await fetch('./reports/session-study.json?t='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(15000)});
   if(!r.ok)throw Error('report unavailable');const d=await r.json();
   if(d.schema!=='session-setups-v1.0')throw Error('report schema');
   const baseline=d.baselines||{};
   el.innerHTML=`<p class="warn"><strong>${d.validationStatus==='NOT_SUPPORTED_FOR_TRADING'?'لم تثبت ربحية هذه الأنماط؛ النموذج غير معتمد للتداول':'نتائج بحثية تتطلب تحققًا مستقبليًا'}</strong></p><p>يبدأ فحص اندفاع الافتتاح بعد أول شمعة مكتملة من 5 دقائق، مع فحص اختراق النطاق واستعادة السعر بعد التراجع. الحجم المرتفع وحده لا يكفي.</p><div class="data-grid">${cell('أسهم في الدراسة',num(d.collection?.symbols,0))}${cell('شموع حقيقية',num(d.collection?.bars,0))}${cell('أمثلة إخفاق في التدريب',num(d.examples?.hardNegativesInTraining,0))}${cell('تنبيهات النموذج في الاختبار',num(d.holdout?.alerts,0))}</div><h4>المقارنة التاريخية بعد تأخير الدخول والتكاليف</h4><div class="table-scroll"><table class="research-table"><thead><tr><th>الطريقة</th><th>رصد / نتائج معلومة</th><th>+3% قبل −2%</th><th>متوسط صافي العائد</th></tr></thead><tbody>${[['volumeMomentum','حجم وزخم'],['unweightedSetups','أنماط بلا نموذج']].map(([k,name])=>{const x=baseline[k]||{};return `<tr><td>${name}</td><td>${num(x.alerts,0)} / ${num(x.scorable,0)}</td><td>${num(x.target3Hits,0)}</td><td>${num(x.meanNetPct)}%</td></tr>`;}).join('')}</tbody></table></div><p class="note">5 تنبيهات كحد أقصى يوميًا، وأول رصد للسهم فقط؛ دخول افتراضي بعد 5 دقائق كاملة، +3% قبل −2% خلال 30 دقيقة، وتكلفة مفترضة 0.4%. النتائج المجهولة لا تُحسب نجاحًا. هذه عوائد لكل رصد قابل للتقييم وليست عائد محفظة.</p><p>لم يختر النموذج تنبيهات ذات عائد متوقع موجب في فترة الاختبار. هذا فشل في إثبات فائدته، ولا يعني غياب فرص في السوق. استهلكت أنماط الافتتاح جميع خانات المقارنة؛ لم يُختبر استمرار الجلسة بميزانية مستقلة.</p><p>يسجل الرادار الآن أول رصد للسهم لكل نمط، حتى 5 حالات لكل نمط في الجلسة. هذه عينة مستقبلية مختلفة عن مقارنة 5 تنبيهات إجمالًا، ولا يجوز جمع نتائجها معها.</p><details><summary>تفاصيل الدراسة وحدودها</summary><p>Model ${esc(d.modelId)} · ${esc(d.generatedAtUTC)}</p><p>${esc((d.splits?.test||[]).join(' · '))}</p><ul>${(d.limitations||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul><a href="./reports/session-study.json" target="_blank" rel="noopener">نتائج الدراسة الكاملة</a></details>`;
   loaded=true;
  }catch(e){el.textContent='تعذر تحميل الدراسة. أعد تحديث النتائج.';}finally{busy=false;}
 }
 document.querySelectorAll('[data-view="research"]').forEach(b=>b.addEventListener('click',()=>load()));
 document.getElementById('researchRefresh')?.addEventListener('click',()=>load(true));
 window.TagitSession={
  forward(data){const el=document.getElementById('sessionForward');if(!el)return;
   const groups=data?.sessionSetupLearning?.forwardByFamily;
   el.innerHTML=!groups?'لم تصل نتائج سجل الأنماط من المحرك بعد.':`<h4>نتائج الأنماط المسجلة قبل النتيجة</h4><div class="table-scroll"><table class="research-table"><thead><tr><th>النمط</th><th>مسجلة / معلومة</th><th>مجهولة / انتظار</th><th>أصابت +3%</th><th>صافي العائد</th></tr></thead><tbody>${Object.entries(groups).map(([name,x])=>`<tr><td>${esc(names[name]||name)}</td><td>${num(x.recorded,0)} / ${num(x.scorable,0)}</td><td>${num(x.unscorable,0)} / ${num(x.pending,0)}</td><td>${num(x.target3Hits,0)}</td><td>${num(x.meanNetPct)}%</td></tr>`).join('')}</tbody></table></div><p class="note">حتى 5 مشاهدات لكل نمط يوميًا. يمكن أن ينتمي السهم لأكثر من نمط؛ لا تجمع الصفوف كصفقات مستقلة. تكلفة مفترضة 0.4%، والبيانات المفقودة تبقى مجهولة. اللقطة ${esc(data.updatedAtUTC)}.</p>`;
  },
  current(row){const x=row?.sessionSetup,age=(Date.now()-Date.parse(x?.decisionAtUTC||''))/1000;
   return x?.status==='RESEARCH_SETUP'&&x.tradeEligible===false&&row.fresh&&row.stage!=='STALE'&&row.session==='regular'&&row.instrumentType==='EQUITY'&&Number.isFinite(age)&&age>=0&&age<=60&&row.price>=x.referencePrice;
  },
  label(x){return (x?.families||[]).map(n=>names[n]||n).join(' · ');},
  detail(row){const x=row?.sessionSetup;if(!x||x.status!=='RESEARCH_SETUP')return '';
   const e=x.indicatorEvidence||{},current=this.current(row);
   return `<section class="research-panel"><h4>${esc(this.label(x))} — نمط بحثي</h4><p class="warn">${current?'نمط مرصود الآن؛ لم تثبت ربحيته':'انتهت صلاحية الرصد أو تراجع السعر؛ ليست حالة نشطة'}</p><div class="data-grid">${cell('دقائق من الافتتاح',num(x.minutesFromOpen,0))}${cell('عائد شمعة 5 دقائق',num(e.return5)+'%')}${cell('الحجم مقابل الوقت نفسه',Number.isFinite(e.logRelativeVolume)?num(Math.expm1(e.logRelativeVolume))+'×':'—')}${cell('المسافة فوق VWAP',num(e.vwapDistance)+'%')}${cell('الذيل العلوي / النطاق',Number.isFinite(e.upperWick5)?num(e.upperWick5*100)+'%':'—')}${cell('تقدير النموذج بعد التكلفة',num(x.estimatedNet30mPct)+'%')}</div><p class="note">التقدير غير مثبت، وليس احتمال نجاح. الرصد عند ${esc(x.decisionAtUTC)}، والسعر المرجعي $${num(x.referencePrice,4)}. النمط مستقل عن فلترة 30 دقيقة؛ لا يمنح موافقة تداول.</p></section>`;
  }
 };
})();
