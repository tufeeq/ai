const fmt = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
export function nyParts(value) {const p=Object.fromEntries(fmt.formatToParts(new Date(value)).map(x=>[x.type,x.value]));return {date:`${p.year}-${p.month}-${p.day}`,minute:Number(p.hour)*60+Number(p.minute),second:Number(p.second)};}
export function nyUTC(date,time) {
  const [h,m]=time.slice(-8).split(':').map(Number); // callers use HH:mm:ss
  const base=Date.parse(`${date}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00Z`);
  let candidate=base;
  for(let i=0;i<3;i++) {const p=nyParts(candidate);const represented=Date.parse(`${p.date}T00:00:00Z`)+p.minute*60000;candidate+=base-represented;}
  return candidate;
}
export function createCalendar(rows,{source='Alpaca calendar',start,end}={}) {
  const sessions=new Map(rows.map(r=>{const date=r.date;const time=v=>v.includes('T')?v.split('T')[1].slice(0,8):v.length===5?v+':00':v;
    return [date,{date,open:nyUTC(date,time(r.open)),close:nyUTC(date,time(r.close)),pre:nyUTC(date,r.pre_open||'04:00:00'),post:r.post_close?nyUTC(date,r.post_close):null}];}));
  const dates=[...sessions.keys()].sort();const first=start||dates[0],last=end||dates.at(-1);
  return {source,first,last,session(date){return sessions.get(date)||null;},
    at(stamp,periods={openingMinutes:30,morningMinutes:150,finalMinutes:60}) {
      const t=typeof stamp==='number'?stamp:Date.parse(stamp),p=nyParts(t),s=sessions.get(p.date);
      if(!s)return {date:p.date,phase:p.date>=first&&p.date<=last?'CLOSED':'CALENDAR_UNKNOWN',source,valid:false};
      let phase=t<s.pre?'CLOSED':t<s.open?'PREMARKET':t<s.close?(t<s.open+periods.openingMinutes*60000?'OPENING':t>=s.close-periods.finalMinutes*60000?'FINAL':t<s.open+periods.morningMinutes*60000?'MORNING':'MIDDAY'):(s.post&&t<s.post?'AFTERHOURS':'CLOSED');
      return {...s,phase,source,valid:phase!=='CLOSED',minutesFromOpen:(t-s.open)/60000,remainingMinutes:Math.max(0,(s.close-t)/60000),shortened:s.close-s.open<390*60000,extendedCloseKnown:s.post!==null};
    }};
}
