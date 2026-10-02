// Research evidence is separate from live prices; this module cannot create signals.
// It only links the methodology section to the evidence page. It used to append the phase-1 figure
// (84 of 322 signals, −1.43%), which outcome-relabel-1 superseded and which contradicted the corrected
// numbers rendered right above it (src/views/evidence.js); that figure now lives in the page's archive.
const method = document.querySelector('.method details');
if (method) {
  const p = document.createElement('p');
  p.id = 'phase1-evidence';
  const a = document.createElement('a');
  a.href = 'performance.html';
  a.textContent = 'سجل الأداء: كل الدراسات بأرقامها، مع أرشيف المراحل السابقة';
  p.append(a);
  method.append(p);
}
