(()=>{
'use strict';
const URL='https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/tagit-post-session-report.json';
const FALLBACK='https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/tagit-top50-audit.json';
const $=id=>document.getElementById(id);
const pct=v=>v==null?'—':`${Number(v).toFixed(1)}%`;
const num=v=>v==null?'—':Number(v).toFixed(2).replace(/\.00$/,'');
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const fmtTs=v=>{if(!v)return'—';try{return new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(v))}catch{return v}};
function isAfterCloseBenchmark(r){
  if(r.reportStatus==='FINAL') return true;
  const ts=r?.benchmark?.timestampUTC; if(!ts)return false;
  try{
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour12:false,hour:'2-digit',minute:'2-digit'}).formatToParts(new Date(ts));
    const h=+parts.find(x=>x.type==='hour').value,m=+parts.find(x=>x.type==='minute').value;
    return h>16 || (h===16 && m>=15);
  }catch{return false}
}
async function fetchJson(url){const r=await fetch(`${url}?t=${Date.now()}`,{cache:'no-store'});if(!r.ok)throw new Error(`${r.status}`);return r.json()}
function verdict(m){
  const e=Number(m.earlyTop50RecallPct||0), r=Number(m.top50RecallPct||0), p=Number(m.precisionVsTop50Pct||0);
  if(e>=20&&r>=50&&p>=15)return ['جلسة قوية نسبيًا','حقق النظام تغطية جيدة مع اكتشاف مبكر ملموس. الأولوية الآن لرفع الدقة دون خفض Early Recall.'];
  if(r>=35&&e<10)return ['الرصد موجود، لكن متأخر','TAGit التقط عددًا معقولًا من الرابحين، إلا أن معظم الاكتشاف حدث بعد بدء الحركة. الأولوية التالية هي Volume Expansion + Price Compression قبل +10%.'];
  if(r<35)return ['التغطية دون المستوى','النظام فوّت نسبة كبيرة من كبار الرابحين. يجب توسيع الاكتشاف المبكر وتحسين universe coverage قبل تشديد التأكيد.'];
  return ['أداء متوسط','التغطية مقبولة جزئيًا، لكن Early Recall وPrecision يحتاجان تحسنًا قبل اعتبار الإشارة قابلة للاعتماد.'];
}
function renderRows(rows,miss=false){
  const head='<div class="report-row header"><span>#</span><span>السهم</span><span>عند القياس</span><span>'+(miss?'الحالة':'أول رصد')+'</span><span>المسار</span></div>';
  return head+rows.slice(0,10).map((r,i)=>{
    const rank=r.benchmarkRank??r.rank??(i+1),sym=r.symbol||'—',bench=r.benchmarkChangePct;
    if(miss)return `<div class="report-row"><span>${rank}</span><b>${esc(sym)}</b><span class="bad">+${num(bench)}%</span><span class="bad">MISSED</span><span>—</span></div>`;
    const first=r.firstDetectedChangePct, cls=first!=null&&first<5?'good':first!=null&&first<10?'warn':'';
    return `<div class="report-row"><span>${rank}</span><b>${esc(sym)}</b><span class="good">+${num(bench)}%</span><span class="${cls}">${first==null?'—':`+${num(first)}%`}</span><span>${esc(r.firstChannel||'—')}</span></div>`;
  }).join('');
}
function render(r,source){
 const m=r.metrics||{}, final=isAfterCloseBenchmark(r);
 $('reportStatus').textContent=final?'FINAL · AFTER CLOSE':'PROVISIONAL'; $('reportStatus').dataset.state=final?'FINAL':'PROVISIONAL';
 $('benchmarkTime').textContent=fmtTs(r?.benchmark?.timestampUTC);
 $('recall').textContent=pct(m.top50RecallPct); $('precision').textContent=pct(m.precisionVsTop50Pct); $('earlyRecall').textContent=pct(m.earlyTop50RecallPct); $('pre5Recall').textContent=pct(m.pre5Top50RecallPct); $('missed').textContent=m.missedTop50Count??'—';
 const [vt,vd]=verdict(m); $('verdictTitle').textContent=vt; $('verdictText').textContent=vd;
 $('reportMeta').innerHTML=`<span>Snapshots ${m.top50Count?esc(r.snapshotsUsed):'—'}</span><span>Benchmark ${esc(r?.benchmark?.source||'—')}</span><span>Universe ${esc(r?.benchmark?.universeRows||'—')}</span><span>${source==='final'?'Frozen report':'Live audit fallback'}</span>`;
 const hits=r.detectedTop50||[], misses=r.missedTop50||[]; $('hitCount').textContent=hits.length; $('missCount').textContent=misses.length; $('hitsTable').innerHTML=renderRows(hits); $('missedTable').innerHTML=renderRows(misses,true);
 const early=Number(m.earlyTop50RecallPct||0),pre5=Number(m.pre5Top50RecallPct||0),precision=Number(m.precisionVsTop50Pct||0),recall=Number(m.top50RecallPct||0);
 $('learning').innerHTML=`
 <div class="learning-card"><b>${pct(early)}</b><p>Early Recall تحت +10%. ${early<10?'هذه هي الفجوة الأساسية: الرصد يحدث بعد بدء الحركة في أغلب الحالات.':'هناك تحسن ملموس في الاكتشاف قبل الانفجار.'}</p></div>
 <div class="learning-card"><b>${pct(pre5)}</b><p>الرصد قبل +5%. هذا هو المقياس الأكثر صرامة لاكتشاف دخول السيولة قبل الحركة السعرية.</p></div>
 <div class="learning-card"><b>${pct(precision)}</b><p>Precision مقابل Top 50. ${precision<10?'عدد المرشحين الزائد ما زال مرتفعًا ويحتاج فلترة أفضل.':'الفلترة بدأت تحقق قيمة أفضل.'}</p></div>
 <div class="learning-card"><b>${pct(recall)}</b><p>Coverage لأعلى 50. ${recall<50?'لا يزال هناك عدد كبير من الرابحين خارج الرادار.':'التغطية أصبحت معقولة ويجب الحفاظ عليها أثناء تحسين الدقة.'}</p></div>
 <div class="learning-card"><b>${m.missedTop50Count??'—'}</b><p>رابحًا ضمن أعلى 50 لم يظهر في مسارات EARLY / EMERGING / ACCUMULATION.</p></div>
 <div class="learning-card"><b>${m.earlyLaneDetectedTop50Count??0}</b><p>إصابات مسار EARLY المخصص. يجب أن يرتفع هذا الرقم من دون استخدام حركة سعرية مستقبلية في التدريب.</p></div>`;
}
async function load(){
 $('reportStatus').textContent='LOADING'; $('reportStatus').dataset.state='DELAYED';
 try{render(await fetchJson(URL),'final')}catch(e){try{render(await fetchJson(FALLBACK),'fallback')}catch(err){$('reportStatus').textContent='REPORT UNAVAILABLE';$('reportStatus').dataset.state='OFFLINE';$('verdictTitle').textContent='تعذر تحميل التقرير';$('verdictText').textContent='لم يصل ملف قياس صالح بعد. لن يتم عرض أرقام قديمة على أنها تقرير إغلاق نهائي.'}}
}
$('reloadReport')?.addEventListener('click',load); load(); setInterval(load,60000);
})();
