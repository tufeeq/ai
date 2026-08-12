/* TAG8 — Predictive Intelligence Layer
   Feature release. Performance claims remain subject to multi-session reconciled validation. */
(function(){
const A={DISCOVERY:'اكتشاف مبكر',IGNITION:'اشتعال',LATE:'متأخر',EXHAUSTION:'إنهاك',VERIFIED:'شرعي مؤكد',UNVERIFIED:'غير متحقق',EXCLUDED:'مستبعد'};
const C=(v,a=0,b=100)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:0));
const num=v=>Number.isFinite(+v)?+v:0;
const pct=v=>`${v>=0?'+':''}${v.toFixed(1)}%`;
const money=v=>`$${num(v).toFixed(v<1?3:2)}`;
const safeDiv=(a,b)=>b>0?a/b:0;
function freshness(h){return h<=6?100:h<=24?88:h<=72?58:h<=168?34:18}
function etaText(hours){if(!Number.isFinite(hours)||hours<=0)return 'غير موثوق';if(hours<1)return `${Math.max(10,Math.round(hours*60))}–${Math.max(20,Math.round(hours*75))} دقيقة`;if(hours<=6)return `${Math.max(1,Math.round(hours*.7))}–${Math.max(2,Math.round(hours*1.35))} ساعات`;if(hours<=12)return 'خلال الجلسة';if(hours<=36)return '1–2 جلسة';if(hours<=72)return '2–3 جلسات';return '3–5 جلسات'}
function tag8Analyze(x){
  x={...x}; const price=Math.max(.0001,num(x.price)), change=num(x.changePct), vol=num(x.volume), avg=num(x.avgVolume), flt=num(x.float), pm=num(x.pmChange), ah=num(x.ahChange), ahv=num(x.ahVolume), spread=Math.max(0,num(x.spreadPct));
  const rvol=safeDiv(vol,avg), turnover=safeDiv(vol,flt), ahPart=safeDiv(ahv,vol), dollarVol=vol*price;
  const freshScore=freshness(num(x.catalystAgeHours||999));
  const volumeAcceleration=C(Math.log2(1+rvol)*21), floatCapture=C(turnover*32), liquidity=C(Math.log10(1+Math.max(0,dollarVol))*10-30), spreadQuality=C(100-spread*22);
  const ofiAvailable=Number.isFinite(+x.orderFlowImbalance), ofi=ofiAvailable?C((num(x.orderFlowImbalance)+1)*50):50;
  const depthAvailable=Number.isFinite(+x.bookDepthImbalance), depth=depthAvailable?C((num(x.bookDepthImbalance)+1)*50):50;
  const microstructure=ofiAvailable||depthAvailable?C(ofi*.58+depth*.42):50;
  const persistenceInput=Number.isFinite(+x.persistenceSlope)?num(x.persistenceSlope):Math.max(-1,Math.min(1,ah/Math.max(10,Math.abs(change)||10)));
  const persistence=C(50+persistenceInput*45 + Math.min(ahPart*120,20));
  const retention=Number.isFinite(+x.gainRetention)?C(num(x.gainRetention)*100):C(75-Math.max(0,-ah)*2.2);
  const sympathy=Number.isFinite(+x.sympathyScore)?C(num(x.sympathyScore)):50;
  const early=C(volumeAcceleration*.20+floatCapture*.15+spreadQuality*.10+freshScore*.10+microstructure*.20+persistence*.10+sympathy*.05+retention*.10);
  let ignition=C(early*.48+volumeAcceleration*.16+microstructure*.15+C(change*1.4)*.11+persistence*.10);
  let continuation=C(persistence*.30+retention*.22+microstructure*.18+freshScore*.12+spreadQuality*.08+volumeAcceleration*.10);
  let exhaustion=C(Math.max(0,change-28)*.78+Math.max(0,turnover-2)*8+Math.max(0,-ah)*1.8+(rvol>15?10:0)+(change>100?18:0));
  const formerRunner=C(num(x.formerRunnerMemory||0)); const failedBreakout=C(num(x.failedBreakoutMemory||0)); exhaustion=C(exhaustion+formerRunner*.10+failedBreakout*.12);
  const dilution=C(num(x.dilutionRisk||0)), haltHazard=C(num(x.haltHazard||Math.max(0,Math.abs(change)-35)*.8+Math.max(0,rvol-10)*1.2));
  const executionRisk=C(spread*13 + (dollarVol<500000?25:dollarVol<2000000?12:0) + (flt&&flt<1000000?12:0));
  const risk=C(dilution*.32+haltHazard*.22+executionRisk*.25+exhaustion*.21);
  if(change>70){ignition-=8;continuation-=8} if(change>110){ignition-=15;continuation-=15} if(ah<0&&change>45){continuation-=18;exhaustion+=12}
  ignition=C(ignition); continuation=C(continuation); exhaustion=C(exhaustion);
  let stage='DISCOVERY'; if(change>95||exhaustion>78)stage='EXHAUSTION'; else if(change>38||risk>78)stage='LATE'; else if(ignition>=64||change>=12)stage='IGNITION';
  const sharia=x.sharia||'UNVERIFIED'; const verified=sharia==='VERIFIED'; const excluded=sharia==='EXCLUDED';
  const dataFields=[price>0,vol>0,avg>0,flt>0,Number.isFinite(+x.catalystAgeHours),ofiAvailable,depthAvailable,Number.isFinite(+x.dilutionRisk),Number.isFinite(+x.haltHazard)];
  const dataQuality=C(dataFields.filter(Boolean).length/dataFields.length*100);
  const uncertainty=C(100-dataQuality + (spread>2?12:0) + (rvol===0?15:0));
  const base=C(early*.28+ignition*.22+continuation*.20+microstructure*.12+floatCapture*.08+freshScore*.10-risk*.30-exhaustion*.16);
  const score=excluded?0:C(base*(.72+.28*dataQuality/100));
  const sustainableVelocity=Math.max(.5,(volumeAcceleration*.18+microstructure*.18+persistence*.18+retention*.14+ignition*.22-risk*.18)/10);
  const raw1=C(7 + score*.11 + floatCapture*.035-risk*.035,5,28), raw2=C(raw1*1.85 + continuation*.055,10,62), raw3=C(raw2*1.65 + ignition*.08-risk*.05,18,125);
  const t1=price*(1+raw1/100), t2=price*(1+raw2/100), t3=price*(1+raw3/100);
  const p1=C(45+score*.42-risk*.18-uncertainty*.15), p2=C(25+score*.40+continuation*.15-risk*.22-uncertainty*.18), p3=C(8+score*.30+ignition*.10-risk*.24-uncertainty*.20);
  const eta1=raw1/Math.max(1,sustainableVelocity), eta2=raw2/Math.max(1,sustainableVelocity), eta3=raw3/Math.max(.8,sustainableVelocity*.8);
  const invalidation=price*(1-Math.min(.16,Math.max(.045,(spread/100)*2+.055+risk/2500)));
  let decision='مراقبة'; if(excluded)decision='مستبعد شرعيًا'; else if(!verified)decision='غير متحقق شرعيًا'; else if(dataQuality<45)decision='بيانات غير كافية'; else if(stage==='EXHAUSTION')decision='إنهاك مرتفع — لا تطارد'; else if(stage==='LATE')decision='الفرصة متأخرة'; else if(stage==='IGNITION'&&score>=62&&risk<60)decision='قابل للتنفيذ وفق النموذج'; else if(stage==='DISCOVERY'&&score>=52)decision='اكتشاف مبكر — راقب التأكيد';
  const reasons=[]; if(volumeAcceleration>65)reasons.push('تسارع حجم'); if(floatCapture>55)reasons.push('التقاط فلوت'); if(microstructure>62)reasons.push('ضغط طلب/OFI'); if(freshScore>80)reasons.push('محفز حديث'); if(persistence>65)reasons.push('استمرارية قوية'); if(sympathy>65)reasons.push('تعاطف قطاعي'); if(dilution>50)reasons.push('خطر تخفيف'); if(exhaustion>65)reasons.push('ذاكرة إنهاك'); if(!ofiAvailable&&!depthAvailable)reasons.push('Microstructure غير متوفر');
  return {...x,price,changePct:change,volume:vol,avgVolume:avg,float:flt,pmChange:pm,ahChange:ah,ahVolume:ahv,rvol,turnover,ahPart,dollarVol,volumeAcceleration,floatCapture,microstructure,persistence,retention,sympathy,early,ignition,continuation,exhaustion,dilution,haltHazard,executionRisk,risk,dataQuality,uncertainty,score,stage,decision,reasons,targets:{t1,t2,t3,p1,p2,p3,eta1,eta2,eta3,invalidation,up1:raw1,up2:raw2,up3:raw3}};
}
window.TAG8={analyze:tag8Analyze,stageLabel:s=>A[s]||s,shariaLabel:s=>A[s]||s,etaText};
window.analyze=tag8Analyze;
function detail(x){const z=tag8Analyze(x),t=z.targets;return `<div class="drawer-head"><div><small>TAG8 · ${A[z.stage]}</small><h2>${z.ticker}</h2><div class="drawer-price">${money(z.price)} <span class="${z.changePct>=0?'pos':'neg'}">${pct(z.changePct)}</span></div></div><button id="closeDrawer" class="ghost-btn">إغلاق ×</button></div>
<div class="decision-banner"><strong>${z.decision}</strong><span>درجة الفرصة ${z.score.toFixed(0)}/100 · المخاطر ${z.risk.toFixed(0)}/100 · جودة البيانات ${z.dataQuality.toFixed(0)}/100</span></div>
<div class="targets-grid">${[['T1',t.t1,t.up1,t.p1,t.eta1],['T2',t.t2,t.up2,t.p2,t.eta2],['T3',t.t3,t.up3,t.p3,t.eta3]].map(q=>`<div class="target-card"><small>${q[0]}</small><strong>${money(q[1])}</strong><span>${pct(q[2])} · احتمال ${q[3].toFixed(0)}%</span><b>${etaText(q[4])}</b></div>`).join('')}<div class="target-card invalid"><small>إبطال السيناريو</small><strong>${money(t.invalidation)}</strong><span>${pct((t.invalidation/z.price-1)*100)}</span></div></div>
<div class="detail-grid"><section><h3>لماذا ظهر؟</h3><p>${z.reasons.join(' · ')||'لا توجد إشارة مكتملة.'}</p><dl><dt>Early Regime</dt><dd>${z.early.toFixed(0)}</dd><dt>Ignition</dt><dd>${z.ignition.toFixed(0)}</dd><dt>Continuation</dt><dd>${z.continuation.toFixed(0)}</dd><dt>Persistence</dt><dd>${z.persistence.toFixed(0)}</dd><dt>Microstructure</dt><dd>${z.microstructure.toFixed(0)}</dd></dl></section>
<section><h3>السيولة والتنفيذ</h3><dl><dt>RVOL</dt><dd>${z.rvol.toFixed(1)}×</dd><dt>Float Turnover</dt><dd>${z.turnover.toFixed(1)}×</dd><dt>Dollar Volume</dt><dd>$${Math.round(z.dollarVol).toLocaleString()}</dd><dt>Execution Risk</dt><dd>${z.executionRisk.toFixed(0)}/100</dd><dt>Spread</dt><dd>${num(z.spreadPct).toFixed(2)}%</dd></dl></section>
<section><h3>المخاطر</h3><dl><dt>Dilution</dt><dd>${z.dilution.toFixed(0)}</dd><dt>Halt Hazard</dt><dd>${z.haltHazard.toFixed(0)}</dd><dt>Exhaustion</dt><dd>${z.exhaustion.toFixed(0)}</dd><dt>Former Runner</dt><dd>${C(num(z.formerRunnerMemory)).toFixed(0)}</dd><dt>عدم اليقين</dt><dd>${z.uncertainty.toFixed(0)}</dd></dl></section>
<section><h3>التحقق</h3><dl><dt>الشرعية</dt><dd>${A[z.sharia]||z.sharia}</dd><dt>جودة البيانات</dt><dd>${z.dataQuality.toFixed(0)}%</dd><dt>المحفز</dt><dd>${num(z.catalystAgeHours||999)<72?`منذ ${num(z.catalystAgeHours).toFixed(0)} ساعة`:'قديم/غير متحقق'}</dd><dt>OFI</dt><dd>${Number.isFinite(+z.orderFlowImbalance)?num(z.orderFlowImbalance).toFixed(2):'غير متوفر'}</dd><dt>Depth</dt><dd>${Number.isFinite(+z.bookDepthImbalance)?num(z.bookDepthImbalance).toFixed(2):'غير متوفر'}</dd></dl></section></div>`}
function openDrawer(ticker){const x=(window.rows||rows||[]).find(r=>r.ticker===ticker); if(!x)return; const d=document.querySelector('#stockDrawer'); if(!d)return; d.innerHTML=detail(x); d.classList.add('open'); document.body.classList.add('drawer-open'); document.querySelector('#closeDrawer').onclick=()=>{d.classList.remove('open');document.body.classList.remove('drawer-open')}}
window.openTAG8Drawer=openDrawer;
const oldRender=window.render;
window.render=function(){
 const q=document.querySelector('#search')?.value.trim().toUpperCase()||'',sf=document.querySelector('#stageFilter')?.value||'all',sh=document.querySelector('#shariaFilter')?.value||'all';
 const src=(typeof rows!=='undefined'?rows:[]), all=src.map(tag8Analyze),out=all.filter(x=>(!q||x.ticker.includes(q))&&(sf==='all'||x.stage===sf)&&(sh==='all'||x.sharia===sh)).sort((a,b)=>b.score-a.score);
 const body=document.querySelector('#scannerBody'); if(body)body.innerHTML=out.map(x=>`<tr data-ticker="${x.ticker}" class="stock-row"><td class="ticker">${x.ticker}<small>${A[x.stage]}</small></td><td>${money(x.price)}</td><td class="${x.changePct>=0?'pos':'neg'}">${pct(x.changePct)}</td><td class="score">${x.score.toFixed(0)}</td><td><span class="pill p-${x.stage.toLowerCase()}">${A[x.stage]}</span></td><td>${money(x.targets.t2)}<small>${pct(x.targets.up2)}</small></td><td>${x.targets.p2.toFixed(0)}%</td><td>${etaText(x.targets.eta2)}</td><td>${x.risk.toFixed(0)}</td><td>${x.dataQuality.toFixed(0)}%</td><td><span class="pill p-${x.sharia.toLowerCase()}">${A[x.sharia]||x.sharia}</span></td></tr>`).join('')||'<tr><td colspan="11">لا توجد نتائج مطابقة.</td></tr>';
 if(body)body.querySelectorAll('.stock-row').forEach(tr=>tr.onclick=()=>openDrawer(tr.dataset.ticker));
 const actionable=all.filter(x=>x.sharia==='VERIFIED'&&['DISCOVERY','IGNITION'].includes(x.stage)&&x.score>=52).length, verified=all.filter(x=>x.sharia==='VERIFIED').length, quality=all.length?all.reduce((s,x)=>s+x.dataQuality,0)/all.length:0, risk=all.length?all.reduce((s,x)=>s+x.risk,0)/all.length:0;
 const sc=document.querySelector('#summaryCards'); if(sc)sc.innerHTML=`<div class="metric"><small>الكون المرصود</small><strong>${all.length}</strong></div><div class="metric"><small>فرص قابلة للمتابعة</small><strong>${actionable}</strong></div><div class="metric"><small>شرعي مؤكد</small><strong>${verified}</strong></div><div class="metric"><small>جودة البيانات</small><strong>${quality.toFixed(0)}%</strong></div><div class="metric"><small>متوسط المخاطر</small><strong>${risk.toFixed(0)}</strong></div>`;
 if(typeof renderVisuals==='function')try{renderVisuals(all)}catch(e){}
};
window.resultHTML=function(x){return detail(x)};
document.addEventListener('DOMContentLoaded',()=>{const b=document.querySelector('#versionBadge');if(b)b.textContent='TAG8';});
})();