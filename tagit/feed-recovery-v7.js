(() => {
  const API_URL='https://api.github.com/repos/tufeeq/ai/contents/tag/data/live-quotes.json?ref=main';
  const CHECK_MS=15000;
  const STALE_TRIGGER_MS=3*60*1000;
  const API_THROTTLE_MS=70000;
  let lastApiAt=0;
  let busy=false;

  const ts = x => {
    const t=Date.parse(x?.updatedAtUTC||x?.updatedAtET||'');
    return Number.isFinite(t)?t:0;
  };
  const decodeBase64Utf8 = s => {
    const bin=atob(String(s||'').replace(/\s/g,''));
    const bytes=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  };

  async function recover(force=false){
    if(typeof app==='undefined'||typeof render!=='function')return;
    const currentTs=ts(app.live), currentAge=currentTs?Date.now()-currentTs:Infinity;
    if(!force && currentAge<STALE_TRIGGER_MS && !app.fetchError)return;
    if(busy || (!force && Date.now()-lastApiAt<API_THROTTLE_MS))return;
    busy=true;lastApiAt=Date.now();
    try{
      const r=await fetch(`${API_URL}&recovery=${Date.now()}`,{cache:'no-store',headers:{Accept:'application/vnd.github+json'}});
      if(!r.ok)throw new Error(`GitHub API ${r.status}`);
      const meta=await r.json();
      if(!meta?.content)throw new Error('GitHub API returned no file content');
      const candidate=JSON.parse(decodeBase64Utf8(meta.content));
      if(ts(candidate)>currentTs){
        app.live=candidate;
        app.fetchError=null;
        app.lastGoodAt=Date.now();
        if(typeof updateMemory==='function')updateMemory(candidate);
        render();
        console.info('TAGit recovered newer feed through GitHub Contents API',candidate.updatedAtET||candidate.updatedAtUTC);
      }
    }catch(e){
      console.warn('TAGit feed recovery path',e);
    }finally{busy=false;}
  }

  setInterval(()=>recover(false),CHECK_MS);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)recover(true)});
  window.addEventListener('online',()=>recover(true));
  setTimeout(()=>recover(false),3500);
})();
