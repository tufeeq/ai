#!/usr/bin/env node
// AI Hub client example — Node.js 18+ (built-in fetch, no npm install).
//
// Usage:
//   export AI_HUB_URL="https://ai.example.com"
//   export AI_HUB_KEY="hub_..."          # a project key created in /admin
//   node node_example.mjs "Summarise the benefits of a weekly review in 3 bullets"
//
// Shows: 1) a normal completion, 2) a streamed completion with SSE parsing.

const HUB_URL = (process.env.AI_HUB_URL || '').trim().replace(/\/+$/, '');
const HUB_KEY = (process.env.AI_HUB_KEY || '').trim();

if (!HUB_URL || !HUB_KEY) {
  console.error('Set AI_HUB_URL and AI_HUB_KEY in the environment first.');
  process.exit(1);
}

// CPU inference is slow: keep this above the hub's LLM_TIMEOUT_MS (180 s).
const TIMEOUT_MS = 240_000;

async function post(body) {
  const res = await fetch(`${HUB_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${HUB_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    // Hub errors use the OpenAI shape: { error: { message, type, code } }.
    const text = await res.text();
    let message = text.slice(0, 300);
    try {
      message = JSON.parse(text).error.message;
    } catch { /* keep the raw text */ }
    throw new Error(`HTTP ${res.status}: ${message}`);
  }
  return res;
}

/** Non-stream call. Returns { text, usage }. */
export async function chat(messages, { maxTokens = 300 } = {}) {
  const res = await post({
    // Any name works: names the hub does not know map to the hub's own model.
    model: 'gpt-4o-mini',
    messages,
    temperature: 0.3,
    max_tokens: maxTokens,
  });
  const data = await res.json();
  return { text: data.choices[0].message.content, usage: data.usage };
}

/** Streamed call. Async generator yielding text pieces. */
export async function* chatStream(messages, { maxTokens = 300 } = {}) {
  const res = await post({
    model: 'gpt-4o-mini',
    messages,
    temperature: 0.3,
    max_tokens: maxTokens,
    stream: true,
  });

  const decoder = new TextDecoder();
  let buffer = '';

  for await (const bytes of res.body) {
    buffer += decoder.decode(bytes, { stream: true });

    // SSE events are separated by a blank line; a network chunk may hold
    // several events or only part of one, so keep the unfinished tail.
    let cut;
    while ((cut = buffer.indexOf('\n\n')) !== -1) {
      const event = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);

      for (const line of event.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;

        let chunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        if (chunk.error) throw new Error(chunk.error.message || 'stream error');
        const piece = chunk.choices?.[0]?.delta?.content;
        if (piece) yield piece;
      }
    }
  }
}

async function main() {
  const question = process.argv.slice(2).join(' ') || 'عرّف بنفسك في جملتين.';
  const messages = [
    { role: 'system', content: 'You are a concise, accurate assistant. Answer in the language of the question.' },
    { role: 'user', content: question },
  ];

  console.log('--- non-stream ---');
  const { text, usage } = await chat(messages);
  console.log(text);
  console.log('usage:', usage);

  console.log('\n--- stream ---');
  for await (const piece of chatStream(messages)) process.stdout.write(piece);
  process.stdout.write('\n');
}

main().catch((err) => {
  const hint = err.name === 'TimeoutError' ? ` (timed out — check ${HUB_URL}/health)` : '';
  console.error(`Request failed: ${err.message}${hint}`);
  process.exit(1);
});
