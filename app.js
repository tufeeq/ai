import * as webllm from "https://esm.run/@mlc-ai/web-llm";

const $ = (id) => document.getElementById(id);
const els = {
  welcome: $("welcome"), messages: $("messages"), load: $("loadModelBtn"), progressWrap: $("progressWrap"),
  progressBar: $("progressBar"), progressLabel: $("progressLabel"), status: $("statusText"), input: $("promptInput"),
  send: $("sendBtn"), form: $("chatForm"), model: $("modelSelect"), settings: $("settingsDialog"),
  system: $("systemPrompt"), temperature: $("temperature"), tempValue: $("temperatureValue")
};

let engine = null;
let isGenerating = false;
let chat = JSON.parse(localStorage.getItem("myai-chat") || "[]");
const settings = JSON.parse(localStorage.getItem("myai-settings") || "{}");

const supported = webllm.prebuiltAppConfig.model_list;
const preferred = supported.filter(x => /Qwen.*(0\.5B|1\.5B).*Instruct/i.test(x.model_id));
const fallback = supported.filter(x => /(Phi|Qwen|Llama).*Instruct/i.test(x.model_id));
const choices = [...preferred, ...fallback].filter((x, i, a) => a.findIndex(y => y.model_id === x.model_id) === i).slice(0, 12);
choices.forEach(item => {
  const option = document.createElement("option");
  option.value = item.model_id;
  option.textContent = item.model_id.replace(/-MLC$/, "");
  els.model.append(option);
});
if (settings.model && choices.some(x => x.model_id === settings.model)) els.model.value = settings.model;
if (settings.system) els.system.value = settings.system;
if (settings.temperature !== undefined) els.temperature.value = settings.temperature;
els.tempValue.textContent = els.temperature.value;

function saveChat(){ localStorage.setItem("myai-chat", JSON.stringify(chat)); }
function renderMessage(role, content){
  els.welcome.classList.add("hidden"); els.messages.classList.remove("hidden");
  const node = document.createElement("article"); node.className = `message ${role}`;
  node.innerHTML = `<div class="avatar">${role === "user" ? "You" : "✦"}</div><div class="bubble"></div>`;
  node.querySelector(".bubble").textContent = content;
  els.messages.append(node); els.messages.scrollTop = els.messages.scrollHeight;
  return node.querySelector(".bubble");
}
chat.forEach(m => renderMessage(m.role, m.content));

async function loadModel(){
  if (!navigator.gpu) {
    alert("This browser does not support WebGPU. Use a recent version of Chrome or Edge on a device with a supported GPU.");
    return;
  }
  els.load.disabled = true; els.progressWrap.classList.remove("hidden"); els.status.textContent = "Loading the local model…";
  try {
    engine = await webllm.CreateMLCEngine(els.model.value, {
      initProgressCallback: (p) => {
        const value = Math.max(0, Math.min(100, Math.round((p.progress || 0) * 100)));
        els.progressBar.style.width = `${value}%`; els.progressLabel.textContent = p.text || `Loading ${value}%`;
      }
    });
    els.status.textContent = "Ready — running privately on this device";
    els.progressLabel.textContent = "Ready"; els.input.disabled = false; els.send.disabled = false; els.input.focus();
  } catch (error) {
    console.error(error); els.load.disabled = false; els.status.textContent = "Model failed to load";
    els.progressLabel.textContent = "Try another smaller model in Settings.";
  }
}

async function submitPrompt(text){
  if (!engine || isGenerating || !text.trim()) return;
  isGenerating = true; els.send.disabled = true; els.input.value = ""; autoResize();
  chat.push({role:"user",content:text.trim()}); renderMessage("user", text.trim());
  const output = renderMessage("assistant", "");
  try {
    const messages = [{role:"system",content:els.system.value.trim()}, ...chat];
    const stream = await engine.chat.completions.create({ messages, temperature:Number(els.temperature.value), stream:true });
    let answer = "";
    for await (const chunk of stream) {
      answer += chunk.choices?.[0]?.delta?.content || "";
      output.textContent = answer; els.messages.scrollTop = els.messages.scrollHeight;
    }
    chat.push({role:"assistant",content:answer}); saveChat();
  } catch (error) {
    console.error(error); output.textContent = "Something went wrong while generating. Try a shorter message or reload the model.";
  } finally { isGenerating = false; els.send.disabled = false; els.input.focus(); }
}

function autoResize(){ els.input.style.height = "auto"; els.input.style.height = `${Math.min(els.input.scrollHeight,180)}px`; }
els.load.addEventListener("click", loadModel);
els.form.addEventListener("submit", e => { e.preventDefault(); submitPrompt(els.input.value); });
els.input.addEventListener("input", autoResize);
els.input.addEventListener("keydown", e => { if(e.key === "Enter" && !e.shiftKey){ e.preventDefault(); els.form.requestSubmit(); }});
document.querySelectorAll(".suggestion").forEach(b => b.addEventListener("click", () => { els.input.value = b.textContent; els.input.focus(); autoResize(); }));
$("settingsBtn").addEventListener("click", () => els.settings.showModal());
els.temperature.addEventListener("input", () => els.tempValue.textContent = els.temperature.value);
$("saveSettingsBtn").addEventListener("click", () => {
  localStorage.setItem("myai-settings", JSON.stringify({model:els.model.value,system:els.system.value,temperature:els.temperature.value}));
  if(engine) els.status.textContent = "Settings saved. Reload the page to change models.";
});
$("clearDataBtn").addEventListener("click", () => { chat=[]; saveChat(); els.messages.innerHTML=""; els.messages.classList.add("hidden"); els.welcome.classList.remove("hidden"); });
$("newChatBtn").addEventListener("click", () => { chat=[]; saveChat(); els.messages.innerHTML=""; els.messages.classList.add("hidden"); els.welcome.classList.remove("hidden"); });
