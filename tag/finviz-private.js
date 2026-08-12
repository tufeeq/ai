(()=>{
  const VERSION='7';
  function loadEnhanced(){
    if(window.__TAG_ENHANCED_BOOTSTRAP)return;
    window.__TAG_ENHANCED_BOOTSTRAP=true;
    if(!document.querySelector('link[data-tag-enhanced]')){
      const l=document.createElement('link');l.rel='stylesheet';l.href='./enhanced.css?v='+VERSION;l.dataset.tagEnhanced='1';document.head.appendChild(l);
    }
    if(!document.querySelector('script[data-tag-enhanced]')){
      const s=document.createElement('script');s.src='./enhanced.js?v='+VERSION;s.dataset.tagEnhanced='1';s.onload=()=>{
        if(typeof window.loadGitHubFinviz==='function')window.loadGitHubFinviz();
        else if(typeof window.render==='function')window.render();
      };document.head.appendChild(s);
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',loadEnhanced);else loadEnhanced();
})();