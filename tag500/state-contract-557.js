'use strict';
(function(){
  const BUILD='TAG557';
  const baseAnalyze=window.analyze;
  const baseRender=window.render;
  if(typeof baseAnalyze!=='function'||typeof baseRender!=='function'){
    window.TAG500StateContract={build:BUILD,ready:false,error:'CORE_ANALYZE_OR_RENDER_MISSING'};
    return;
  }
  let capturing=false;
  let generation=0;
  function reset(){
    window.rows=[];
    window.analyzed=[];
  }
  window.analyze=function(){
    const input=arguments[0];
    const result=baseAnalyze.apply(this,arguments);
    if(capturing){
      window.rows.push(input);
      window.analyzed.push(result);
    }
    return result;
  };
  window.render=function(){
    reset();
    capturing=true;
    let result;
    try{
      result=baseRender.apply(this,arguments);
    }finally{
      capturing=false;
      generation+=1;
      window.TAG500State={
        build:BUILD,
        generation,
        rows:window.rows,
        analyzed:window.analyzed,
        analyzedCount:window.analyzed.length,
        renderedAt:new Date().toISOString()
      };
      window.dispatchEvent(new CustomEvent('tag500:state-ready',{detail:{build:BUILD,generation,analyzedCount:window.analyzed.length}}));
    }
    return result;
  };
  window.TAG500StateContract={build:BUILD,ready:true,source:'canonical-render-capture'};
})();
