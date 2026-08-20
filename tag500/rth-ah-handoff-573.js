'use strict';
(function(){
  const BUILD='TAG573';
  const MAIN='https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/snapshots.json';
  const LOCAL='./data/snapshots.json';
  let baseline={ready:false,date:null,timestamp:null,rows:new Map(),origin:'unavailable',error:null};
  function etDate(ts){const d=new Date(ts||Date.now());if(!Number.isFinite(d.getTime()))return null;const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;}
  function n(v){if(v===null||v===undefined||v==='')return null;const x=Number(String(v).replace(/[$,%\s,]/g,''));return Number.isFinite(x)?x:null;}
  async function json(url){const r=await fetch(url+(url.includes('?')?'&':'?')+'ts='+Date.now(),{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}
  function snaps(payload){if(Array.isArray(payload))return payload;for(const k of ['snapshots','history','items','records'])if(Array.isArray(payload?.[k]))return payload[k];return [];}
  function rowsOf(s){for(const k of ['topMovers','rows','data','movers'])if(Array.isArray(s?.[k]))return s[k];return [];}
  function ticker(r){return String(r?.Ticker||r?.ticker||r?.Symbol||r?.symbol||'').toUpperCase();}
  function volume(r){return n(r?.Volume??r?.volume??r?.['Current Volume']);}
  function build(payload,origin){
    const today=etDate(Date.now());
    const candidates=snaps(payload).filter(s=>{const ts=s.timestampET||s.snapshotTimestampET||s.timestampUTC||s.snapshotTimestampUTC||s.updatedAt;const ses=String(s.session||'').toLowerCase();const bucket=String(s.sessionBucket||s.bucket||'').toUpperCase();return etDate(ts)===today&&(ses==='regular'||ses.includes('regular')||bucket==='R15')&&bucket==='R15';}).sort((a,b)=>Date.parse(a.timestampUTC||a.timestampET||a.updatedAt||0)-Date.parse(b.timestampUTC||b.timestampET||b.updatedAt||0));
    const s=candidates.at(-1);if(!s)return{ready:false,date:today,timestamp:null,rows:new Map(),origin,error:'R15_BASELINE_NOT_FOUND'};
    const map=new Map();for(const r of rowsOf(s)){const t=ticker(r),v=volume(r);if(t&&Number.isFinite(v)&&v>=0)map.set(t,{volume:v,price:n(r?.Price??r?.price),change:n(r?.Change??r?.change),timestamp:s.timestampET||s.timestampUTC||null});}
    return{ready:map.size>0,date:today,timestamp:s.timestampET||s.timestampUTC||null,rows:map,origin,error:map.size?null:'R15_ROWS_EMPTY'};
  }
  async function load(){let err=null;try{baseline=build(await json(MAIN),'main-live');if(baseline.ready)return baseline;}catch(e){err=e;}try{baseline=build(await json(LOCAL),'published-fallback');if(baseline.ready)return baseline;}catch(e){err=e;}baseline={ready:false,date:etDate(Date.now()),timestamp:null,rows:new Map(),origin:'unavailable',error:baseline.error||err?.message||'BASELINE_UNAVAILABLE'};return baseline;}
  function derive(z){
    const session=window.TAG500SessionClock?.state?.(Date.now())?.code||'UNKNOWN';if(session!=='AH')return{eligible:false,state:'NOT_AH'};
    if(!baseline.ready||baseline.date!==etDate(Date.now()))return{eligible:false,state:'R15_BASELINE_UNAVAILABLE'};
    const t=String(z?.ticker||'').toUpperCase(),b=baseline.rows.get(t);if(!b)return{eligible:false,state:'TICKER_NOT_IN_R15_BASELINE',baselineTimestamp:baseline.timestamp};
    const raw=z?.raw||{},frozen=raw._volumeFieldFrozen===true||String(raw._volumeFieldFrozen).toLowerCase()==='true',integrity=String(raw._extendedHoursFieldIntegrity||'').toUpperCase();
    if(frozen||integrity!=='CROSS_SNAPSHOT_FIELDS_MOVING')return{eligible:false,state:frozen?'AH_VOLUME_FIELD_FROZEN':'AH_FIELD_INTEGRITY_UNVERIFIED',baselineTimestamp:baseline.timestamp};
    const total=n(z?.volume);if(!Number.isFinite(total))return{eligible:false,state:'CURRENT_TOTAL_VOLUME_MISSING',baselineTimestamp:baseline.timestamp};
    if(total<b.volume)return{eligible:false,state:'TOTAL_VOLUME_BELOW_R15_BASELINE',baselineVolume:b.volume,totalVolume:total,baselineTimestamp:baseline.timestamp};
    const ahVolume=total-b.volume,participation=total>0?ahVolume/total:0,takeover=b.volume>0?ahVolume/b.volume:null;
    return{eligible:true,state:'CENTRAL_R15_HANDOFF',baselineVolume:b.volume,totalVolume:total,ahVolume,regularVolume:b.volume,participation,takeover,takeoverActive:Number.isFinite(takeover)&&takeover>1,baselineTimestamp:baseline.timestamp,baselineOrigin:baseline.origin};
  }
  const ready=load().then(()=>{window.dispatchEvent(new CustomEvent('tag500:rth-ah-handoff-ready',{detail:{build:BUILD,ready:baseline.ready,origin:baseline.origin,timestamp:baseline.timestamp}}));try{window.render?.();}catch(_){}});
  window.TAG500RTHAHHandoff={build:BUILD,load,ready,derive,getState:()=>({ready:baseline.ready,date:baseline.date,timestamp:baseline.timestamp,count:baseline.rows.size,origin:baseline.origin,error:baseline.error})};
})();