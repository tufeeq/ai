const STORAGE_KEY = "nook-data-v2";
const defaults = {
  feeds: ["Watch later", "Long reads", "Recipes", "For the kids"],
  items: [
    {id:"memory",type:"Video",source:"YouTube",title:"Why we remember what we remember",summary:"A fascinating look at how memory shapes identity — and why forgetting can be a gift.",from:"Maya",feed:"Watch later",url:"https://www.youtube.com/",saved:false,created:3,visual:"linear-gradient(135deg,#c6bea5,#718172 55%,#34483d)"},
    {id:"joy",type:"Article",source:"The Atlantic",title:"The hidden joy of doing things badly",summary:"Why hobbies don’t need to become side hustles, and the case for being a beginner.",from:"Dad",feed:"Long reads",url:"https://www.theatlantic.com/",saved:true,created:2,visual:"linear-gradient(135deg,#8ca18f,#ddd1af 55%,#766a50)"},
    {id:"kyoto",type:"Video",source:"Vimeo",title:"A quiet morning in Kyoto",summary:"Ten calming minutes of early streets, small rituals, and the city waking up.",from:"Jamie",feed:"Watch later",url:"https://vimeo.com/",saved:false,created:1,visual:"linear-gradient(135deg,#3d5149,#b96b5d 55%,#edc27f)"},
    {id:"pasta",type:"Recipe",source:"YouTube",title:"The only pasta recipe you'll ever need",summary:"A weeknight technique for glossy, restaurant-style pasta with pantry ingredients.",from:"Alex",feed:"Recipes",url:"https://www.youtube.com/",saved:false,created:0,visual:"linear-gradient(135deg,#c44e35,#e9bd69)"}
  ]
};

const $ = id => document.getElementById(id);
let data;
try { data = JSON.parse(localStorage.getItem(STORAGE_KEY)) || structuredClone(defaults); }
catch { data = structuredClone(defaults); }
if (!Array.isArray(data.feeds) || !Array.isArray(data.items)) data = structuredClone(defaults);
let state = {view:"home", feed:null, query:"", sort:"newest"};

function save(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
function escapeHTML(value=""){ const node=document.createElement("div"); node.textContent=value; return node.innerHTML; }
function initials(name){ return name.split(/\s+/).map(word=>word[0]).join("").slice(0,2).toUpperCase(); }
function domain(url){ try{return new URL(url).hostname.replace(/^www\./,"");}catch{return "Link";} }
function showToast(message){ const toast=$("toast"); toast.textContent=message; toast.classList.add("show"); clearTimeout(window.toastTimer); window.toastTimer=setTimeout(()=>toast.classList.remove("show"),2200); }

function renderFeeds(){
  $("feedNav").innerHTML=data.feeds.map((feed,index)=>{
    const count=data.items.filter(item=>item.feed===feed).length;
    return `<button class="feed-link ${state.feed===feed?"active":""}" data-feed="${escapeHTML(feed)}"><i class="dot color-${index%4}"></i><span class="feed-name">${escapeHTML(feed)}</span><span>${count}</span></button>`;
  }).join("");
  $("feedSelect").innerHTML=data.feeds.map(feed=>`<option>${escapeHTML(feed)}</option>`).join("");
  document.querySelectorAll(".feed-link").forEach(button=>button.addEventListener("click",()=>setFeed(button.dataset.feed)));
}

function getVisibleItems(){
  let result=[...data.items];
  if(state.view==="saved") result=result.filter(item=>item.saved);
  if(state.feed) result=result.filter(item=>item.feed===state.feed);
  if(state.query){ const q=state.query.toLowerCase(); result=result.filter(item=>[item.title,item.summary,item.from,item.feed,item.type,item.source].join(" ").toLowerCase().includes(q)); }
  if(state.sort==="title") result.sort((a,b)=>a.title.localeCompare(b.title));
  else if(state.sort==="type") result.sort((a,b)=>a.type.localeCompare(b.type));
  else result.sort((a,b)=>b.created-a.created);
  return result;
}

function render(){
  renderFeeds();
  const items=getVisibleItems();
  $("itemCount").textContent=items.length;
  $("newCount").textContent=data.items.length;
  $("savedCount").textContent=data.items.filter(item=>item.saved).length;
  $("feedCount").textContent=data.feeds.length;
  $("dailyCard").hidden=state.view!=="home" || state.feed || state.query;
  $("continueSection").hidden=state.view!=="home" || state.feed || state.query;
  const heading=state.query?`Results for “${state.query}”`:state.feed||({saved:"Saved for later",all:"All your links",home:"Recently added"}[state.view]);
  $("sectionTitle").textContent=heading;
  $("sectionSubtitle").textContent=state.feed?`Everything filed in ${state.feed}`:state.view==="saved"?"The things you want to come back to":"Links from you and your favorite people";
  $("pageTitle").textContent=state.feed||({saved:"Saved for later",all:"Your whole collection",home:"Good morning, Alex."}[state.view]);
  $("pageSubtitle").textContent=state.feed?"A focused place for the things you care about.":"Everything worth your time, in one calm place.";
  $("cardGrid").innerHTML=items.map(item=>`<article class="content-card" data-id="${item.id}">
    <button class="card-link" data-action="open" aria-label="Open ${escapeHTML(item.title)}"><div class="thumb" style="background:${item.visual}"><span class="type-icon">${item.type==="Video"?"▶":"↗"}</span><span class="feed-pill">${escapeHTML(item.feed)}</span><span class="shared-by"><i class="mini-avatar">${initials(item.from)}</i> ${escapeHTML(item.from)}</span></div><div class="card-body"><span class="tag">${escapeHTML(item.type)} · ${escapeHTML(item.source||domain(item.url))}</span><h3>${escapeHTML(item.title)}</h3><p class="summary">${escapeHTML(item.summary||"Saved to read or watch later.")}</p></div></button>
    <div class="card-actions"><span>Added recently</span><button data-action="save" class="bookmark ${item.saved?"saved":""}" aria-label="${item.saved?"Unsave":"Save"} ${escapeHTML(item.title)}">${item.saved?"♥":"♡"}</button><button data-action="delete" class="delete-btn" aria-label="Delete ${escapeHTML(item.title)}">⋯</button></div></article>`).join("");
  $("emptyState").hidden=items.length>0;
  document.querySelectorAll(".content-card").forEach(card=>card.addEventListener("click",event=>handleCardAction(event,card.dataset.id)));
}

function handleCardAction(event,id){
  const action=event.target.closest("[data-action]")?.dataset.action;
  if(!action)return;
  const item=data.items.find(entry=>entry.id===id);
  if(action==="open") window.open(item.url,"_blank","noopener,noreferrer");
  if(action==="save"){ item.saved=!item.saved; save(); render(); showToast(item.saved?"Saved for later":"Removed from saved"); }
  if(action==="delete" && confirm(`Remove “${item.title}” from your Nook?`)){ data.items=data.items.filter(entry=>entry.id!==id); save(); render(); showToast("Link removed"); }
}

function selectView(view){
  state.view=view; state.feed=null; state.query=""; $("searchInput").value="";
  document.querySelectorAll(".nav-item").forEach(button=>button.classList.toggle("active",button.dataset.view===view));
  render(); window.scrollTo({top:0,behavior:"smooth"});
}
function setFeed(feed){ state.feed=feed; state.view="all"; document.querySelectorAll(".nav-item").forEach(button=>button.classList.remove("active")); render(); window.scrollTo({top:0,behavior:"smooth"}); }
function openDialog(dialog){ dialog.showModal(); setTimeout(()=>dialog.querySelector("input:not([readonly])")?.focus(),50); }

document.querySelectorAll(".nav-item").forEach(button=>button.addEventListener("click",()=>selectView(button.dataset.view)));
$("brandBtn").addEventListener("click",()=>selectView("home"));
$("addLinkBtn").addEventListener("click",()=>openDialog($("linkDialog")));
$("emptyAddBtn").addEventListener("click",()=>openDialog($("linkDialog")));
$("addFeedBtn").addEventListener("click",()=>openDialog($("feedDialog")));
$("inviteBtn").addEventListener("click",()=>openDialog($("inviteDialog")));
document.querySelectorAll("dialog").forEach(dialog=>{ dialog.querySelector(".modal-close").addEventListener("click",()=>dialog.close()); dialog.addEventListener("click",event=>{if(event.target===dialog)dialog.close();}); });
$("linkForm").addEventListener("submit",event=>{ event.preventDefault(); const url=$("urlInput").value; data.items.push({id:crypto.randomUUID?.()||String(Date.now()),type:$("typeSelect").value,source:domain(url),title:$("titleInput").value.trim(),summary:$("noteInput").value.trim(),from:"Alex",feed:$("feedSelect").value,url,saved:false,created:Date.now(),visual:"linear-gradient(135deg,#315f4a,#8fb99c)"}); save(); event.target.reset(); $("linkDialog").close(); selectView("all"); showToast("Link added to your Nook"); });
$("feedForm").addEventListener("submit",event=>{ event.preventDefault(); const name=$("feedNameInput").value.trim(); if(data.feeds.some(feed=>feed.toLowerCase()===name.toLowerCase())) return showToast("That feed already exists"); data.feeds.push(name); save(); event.target.reset(); $("feedDialog").close(); setFeed(name); showToast(`${name} created`); });
$("copyInvite").addEventListener("click",async()=>{ try{await navigator.clipboard.writeText($("inviteLink").value);showToast("Invite link copied");}catch{$("inviteLink").select();document.execCommand("copy");showToast("Invite link copied");} });
$("searchInput").addEventListener("input",event=>{state.query=event.target.value.trim();render();});
$("sortSelect").addEventListener("change",event=>{state.sort=event.target.value;render();});
$("startCatchup").addEventListener("click",()=>{$("sharedSection").scrollIntoView({behavior:"smooth"});showToast("Here are your newest links");});
document.addEventListener("keydown",event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="k"){event.preventDefault();$("searchInput").focus();}});
$("todayLabel").textContent=new Intl.DateTimeFormat("en-US",{weekday:"long",month:"long",day:"numeric"}).format(new Date()).toUpperCase();
render();
