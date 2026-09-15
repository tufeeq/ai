'use strict';
const labels = {
  TARGET: 'بلوغ الهدف', STOP: 'بلوغ الوقف', TIMEOUT: 'انتهاء المدة',
  UNSCORABLE_GAP: 'فجوات في مسار السعر', ENTRY_NOT_AVAILABLE: 'دخول غير متاح',
  NO_NEXT_MINUTE: 'شمعة الدخول مفقودة', UNRESOLVED: 'مسار غير محسوم',
  UNKNOWN_TIMEOUT_QUOTE: 'سعر الخروج غير محسوم'
};
const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('en-US');
const timeFormat = new Intl.DateTimeFormat('en-GB', {timeZone: 'America/New_York', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'});
const price = (n) => Number.isFinite(n) ? '$' + n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') : 'غير متاح';
const net = (n) => Number.isFinite(n) ? (n > 0 ? '+' : '') + n.toFixed(2) + '%' : 'غير محسوم';
const when = (s) => s ? timeFormat.format(new Date(s)) : 'غير متاح';
let data, active = 'study', page = 0;
const pageSize = 20;
function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function signals() { return active === 'study' ? data.study.signals : data.exit.signals; }
function showDetail(row) {
  $('detail-title').textContent = row.symbol + ' · ' + (labels[row.outcome] || row.outcome);
  const entry = active === 'study' ? row.entry : row.entry_ask;
  const pairs = [
    ['وقت الإشارة · نيويورك', when(row.at || row.id.split(/:(.*)/s)[1])],
    ['الدخول المفترض', price(entry)], ['الوقف في المحاكاة', price(row.stop)],
    ['الهدف في المحاكاة', price(row.target)], ['وقت الخروج · نيويورك', when(row.exit_at)],
    ['العائد بعد التكلفة', net(row.net_pct)]
  ];
  if (active === 'exit') {
    pairs.push(['سعر الخروج المرصود', price(row.exit_bid)], ['عدد تحديثات الأسعار', nf.format(row.quotes)]);
    const later = data.timing.results.find(r => r.id === row.id);
    if (later?.first_valid) pairs.push(['تأخر أول تحديث لاحق', later.first_valid.delay_seconds.toFixed(3) + ' s']);
  }
  $('detail-values').replaceChildren(...pairs.flatMap(([key,value]) => [node('dt',key), node('dd',value)]));
  $('detail-note').textContent = active === 'study'
    ? 'هذه محاكاة شموع: دخول عند افتتاح الدقيقة التالية، مع تكلفة 0.25٪ لكل جانب. القيم السوقية مأخوذة من لقطة لاحقة؛ تحيز البقاء ونقص البيانات ما زالا قائمين.'
    : 'عينة تطوير بتاريخ 24 أغسطس، وليست اختبارًا مستقلًا لدقة التداول. دخول عند سعر عرض مرصود وخروج عند سعر طلب مرصود مع تكلفة 0.25٪ لكل جانب، دون إثبات تنفيذ فعلي.';
  if (active === 'exit' && row.outcome === 'UNKNOWN_TIMEOUT_QUOTE') $('detail-note').textContent += ' السعر اللاحق خارج مهلة الخروج؛ لذلك لم يُستخدم لإعادة تصنيف النتيجة.';
  if (active === 'exit' && row.limit_reached) $('detail-note').textContent += ' وصلت نافذة البيانات إلى حد الطلب؛ حدث الخروج المرصود داخل الجزء المتاح فقط.';
  $('detail').showModal();
}
function renderRows() {
  const query = $('search').value.trim().toUpperCase();
  const outcome = $('outcome-filter').value;
  const filtered = signals().filter(row => row.symbol.includes(query) && (!outcome || row.outcome === outcome));
  const pages = Math.max(1,Math.ceil(filtered.length/pageSize));
  page = Math.min(page,pages-1);
  $('page-count').textContent = (page+1)+' / '+pages;
  $('previous').disabled = page === 0;
  $('next').disabled = page === pages-1;
  $('rows').replaceChildren(...filtered.slice(page*pageSize,(page+1)*pageSize).map(row => {
    const tr = node('tr');
    const symbol = node('td',row.symbol); symbol.dir = 'ltr';
    const at = node('td',when(row.at || row.entry_at),'num');
    const status = node('td'); status.append(node('span',labels[row.outcome] || row.outcome,'badge '+row.outcome));
    const pnl = node('td',net(row.net_pct),'num '+(Number.isFinite(row.net_pct) ? row.net_pct>0?'positive':'negative' : ''));
    const detail = node('td'); const button = node('button','التفاصيل');
    button.type='button'; button.setAttribute('aria-label','تفاصيل '+row.symbol+' '+when(row.at || row.entry_at));
    button.addEventListener('click',()=>showDetail(row)); detail.append(button);
    tr.append(symbol,at,status,pnl,detail); return tr;
  }));
  $('row-count').textContent = filtered.length + ' من ' + signals().length + ' حالة';
  $('empty').hidden = filtered.length !== 0;
}
function chooseSample(sample) {
  active = sample;
  page = 0;
  for (const key of ['study','exit']) {
    $(key+'-tab').classList.toggle('active',key===sample);
    $(key+'-tab').setAttribute('aria-pressed',String(key===sample));
  }
  $('search').value='';
  const all = node('option','جميع النتائج'); all.value='';
  const options = [...new Set(signals().map(row=>row.outcome))].map(outcome=>{const o=node('option',labels[outcome]||outcome);o.value=outcome;return o;});
  $('outcome-filter').replaceChildren(all,...options);
  $('sample-note').textContent = sample==='study'
    ? '2–4 سبتمبر 2026 · 125 إشارة؛ 26 نتيجة محسومة، و99 حالة تعذّر دخولها أو استكمال تقييمها. أسعار مشتقة من الشموع وليست تنفيذات فعلية.'
    : '24 أغسطس 2026 · عينة تطوير: 10 مداخل مفترضة، 5 نتائج محسومة و5 غير محسومة. لا يُعرض متوسط المجموعة المحسومة كربحية للعينة.';
  renderRows();
}
async function init() {
  try {
    const response = await fetch('snapshot.json', {cache:'no-cache'});
    if (!response.ok) throw new Error('HTTP '+response.status);
    const payload = await response.json();
    if (payload.schema_version!==1 || payload.approved_for_live!==false || payload.live_connected!==false || !Array.isArray(payload.study?.signals) || !Array.isArray(payload.exit?.signals)) throw new Error('Invalid research snapshot');
    if (payload.study.signals.length!==payload.study.summary.setups || payload.exit.signals.length!==payload.exit.entries) throw new Error('Incomplete snapshot');
    data = payload;
    $('symbols').textContent=nf.format(data.universe.symbols);
    $('bars').textContent=nf.format(data.universe.bars);
    $('setups').textContent=nf.format(data.study.summary.setups);
    $('resolved').textContent=data.study.summary.resolved+' / '+data.study.summary.setups;
    const outcomes=Object.entries(data.study.summary.outcomes).sort((a,b)=>b[1]-a[1]);
    $('outcomes').replaceChildren(...outcomes.map(([key,count])=>{
      const row=node('div',undefined,'outcome-row'), track=node('div',undefined,'bar-track'),fill=node('div',undefined,'bar-fill '+key);
      fill.style.width=(count/data.study.summary.setups*100)+'%';track.append(fill);track.setAttribute('aria-hidden','true');
      row.append(node('span',labels[key]||key),track,node('b',String(count),'num'));return row;
    }));
    $('study-tab').addEventListener('click',()=>chooseSample('study'));
    $('exit-tab').addEventListener('click',()=>chooseSample('exit'));
    $('search').addEventListener('input',()=>{page=0;renderRows();});
    $('outcome-filter').addEventListener('change',()=>{page=0;renderRows();});
    $('previous').addEventListener('click',()=>{page--;renderRows();});
    $('next').addEventListener('click',()=>{page++;renderRows();});
    chooseSample('study');
    $('load-status').textContent='';
  } catch(error) {
    $('load-status').textContent='تعذّر تحميل سجل البحث. أعد فتح الصفحة أو استخدم رابط الدراسة. لا توجد بيانات لحظية بديلة في هذه الواجهة.';
    $('load-status').setAttribute('role','alert');
    for(const id of ['study-tab','exit-tab','search','outcome-filter','previous','next']) $(id).disabled=true;
    console.error('Research snapshot unavailable:',error.message);
  }
}
$('close-detail').addEventListener('click',()=>$('detail').close());
$('detail').addEventListener('click',(e)=>{if(e.target===$('detail')){const r=$('detail').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('detail').close();}});
init();
