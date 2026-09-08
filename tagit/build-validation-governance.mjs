import fs from 'node:fs';
import path from 'node:path';

const DATA='tag/data';
const OUT=process.argv[2]||path.join(DATA,'tagit-validation-governance.json');
const files=fs.readdirSync(DATA).filter(f=>/^tagit-v5\d+.*\.json$/i.test(f));
const reports=[];
for(const f of files){
  try{
    const x=JSON.parse(fs.readFileSync(path.join(DATA,f),'utf8'));
    if(x?.status!=='COMPLETE') continue;
    const m=String(x.schemaVersion||f).match(/5\.(\d+)/);
    reports.push({file:f,minor:m?+m[1]:-1,generatedAtUTC:x.generatedAtUTC||x.updatedAtUTC||null,report:x});
  }catch{}
}
reports.sort((a,b)=>b.minor-a.minor||String(b.generatedAtUTC||'').localeCompare(String(a.generatedAtUTC||'')));
const latest=reports[0]||null;
const r=latest?.report||{},h=r.researchHoldout||{},pi=r.providerIntegrity||{};
const independentCount=Number.isFinite(+h.count)?+h.count:null;
const activeDays=Number.isFinite(+h.activeDays)?+h.activeDays:null;
const precision=Number.isFinite(+h.precision20Pct)?+h.precision20Pct:null;
const wilson=Number.isFinite(+h.wilsonLower90Pct)?+h.wilsonLower90Pct:null;
const dayBlock=Number.isFinite(+h.dayBlockLower90Pct)?+h.dayBlockLower90Pct:null;
const real=Number.isFinite(+r.realDiscoveryPrecisionPct)?+r.realDiscoveryPrecisionPct:null;
const untouched=String(r.holdoutStatus||'').toUpperCase().includes('UNTOUCHED');
const pit=pi.historicalPointInTimeUniverse===true;
const survivorship=pi.survivorshipSafe===true;
const adequateSupport=(independentCount??0)>=100&&(activeDays??0)>=20;
const holdout90=precision!==null&&precision>=90&&wilson!==null&&wilson>=80&&dayBlock!==null&&dayBlock>=80;
const forwardConfirmed=real!==null&&real>=90;
const claim90Allowed=untouched&&adequateSupport&&pit&&survivorship&&holdout90&&forwardConfirmed;
const blockers=[];
if(!latest) blockers.push('NO_COMPLETED_V5_REPORT');
if(latest&&!untouched) blockers.push('HOLDOUT_NOT_UNTOUCHED');
if(latest&&!adequateSupport) blockers.push('INADEQUATE_INDEPENDENT_SUPPORT');
if(latest&&!pit) blockers.push('POINT_IN_TIME_UNIVERSE_NOT_PROVEN');
if(latest&&!survivorship) blockers.push('SURVIVORSHIP_SAFETY_NOT_PROVEN');
if(latest&&!holdout90) blockers.push('HOLDOUT_90_NOT_ESTABLISHED_WITH_UNCERTAINTY');
if(latest&&!forwardConfirmed) blockers.push('FORWARD_90_NOT_CONFIRMED');
const out={
  schemaVersion:1,
  generatedAtUTC:new Date().toISOString(),
  latestCompletedReport:latest?.file||null,
  latestSchemaVersion:r.schemaVersion||null,
  validationStatus:r.validationStatus||null,
  holdoutStatus:r.holdoutStatus||null,
  holdout:{precision20Pct:precision,independentSelections:independentCount,activeDays,wilsonLower90Pct:wilson,dayBlockLower90Pct:dayBlock},
  realDiscoveryPrecisionPct:real,
  universeIntegrity:{historicalPointInTimeUniverse:pit,survivorshipSafe:survivorship},
  claim90Allowed,
  blockers,
  policy:{minimumIndependentSelections:100,minimumActiveDays:20,requiresUntouchedChronologicalHoldout:true,requiresPointInTimeUniverse:true,requiresSurvivorshipSafeUniverse:true,requiresForwardConfirmation:true}
};
fs.writeFileSync(OUT,JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify(out,null,2));
if(claim90Allowed) console.log('90% claim gate: PASSED'); else console.log('90% claim gate: BLOCKED');
