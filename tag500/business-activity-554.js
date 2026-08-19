'use strict';
(function(){
  const BUILD='TAG554';
  const baseNormalize=window.normalizeRecord||normalizeRecord;
  const norm=s=>String(s??'').toLowerCase().replace(/\s+/g,' ').trim();
  const pick=(o,k)=>String(o?.[k]??o?.raw?.[k]??'');
  const EXCLUDED_PATTERNS=[
    ['ETF_OR_FUND',/\b(exchange traded fund|etf|leveraged etf|inverse etf|target 2x|target 3x|2x long|3x long|2x short|3x short)\b/i],
    ['BANKING',/\b(bank|banks|banking|savings institution|thrift)\b/i],
    ['CONVENTIONAL_INSURANCE',/\b(insurance|reinsurance|insurance brokers?)\b/i],
    ['GAMBLING',/\b(casino|gambling|gaming & leisure|sports betting|lottery)\b/i],
    ['ALCOHOL',/\b(alcoholic beverages?|brewers?|wineries|distillers?)\b/i],
    ['TOBACCO',/\b(tobacco|cigarettes?|nicotine products?)\b/i],
    ['CONVENTIONAL_CREDIT',/\b(consumer finance|credit services|mortgage finance|mortgage reit|payday|lending)\b/i],
    ['CONVENTIONAL_CAPITAL_MARKETS',/\b(asset management|investment banking|brokerage|capital markets)\b/i],
    ['ADULT_ENTERTAINMENT',/\b(adult entertainment|pornograph)\b/i]
  ];
  const STRUCTURAL_UNVERIFIED=[
    ['SHELL_OR_SPAC',/\b(shell compan(?:y|ies)|blank check|special purpose acquisition|spac)\b/i]
  ];
  function classify(x){
    const company=pick(x,'Company')||pick(x,'company');
    const sector=pick(x,'Sector')||pick(x,'sector');
    const industry=pick(x,'Industry')||pick(x,'industry');
    const hay=norm([company,sector,industry].join(' | '));
    for(const [code,re] of EXCLUDED_PATTERNS){
      if(re.test(hay)) return {state:'EXCLUDED',code,label:'نشاط/أداة مستبعدة',company,sector,industry};
    }
    for(const [code,re] of STRUCTURAL_UNVERIFIED){
      if(re.test(hay)) return {state:'UNVERIFIED',code,label:'هيكل يحتاج تحقق شرعي/مالي',company,sector,industry};
    }
    return {state:'UNVERIFIED',code:'NO_DETERMINISTIC_ACTIVITY_EXCLUSION',label:'لا يوجد استبعاد نشاطي حتمي',company,sector,industry};
  }
  function decorate(x){
    if(!x) return x;
    const gate=classify(x);
    x.company=gate.company||x.company||'';
    x.sector=gate.sector||x.sector||'';
    x.industry=gate.industry||x.industry||'';
    x.businessActivityGate=gate;
    if(gate.state==='EXCLUDED') x.sharia='EXCLUDED';
    return x;
  }
  const wrapped=function(o){return decorate(baseNormalize(o));};
  window.normalizeRecord=wrapped;
  try{ normalizeRecord=wrapped; }catch(_e){}
  window.TAG500BusinessActivity={build:BUILD,classify,decorate,deterministicOnly:true};
})();
