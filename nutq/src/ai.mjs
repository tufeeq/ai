// Translation through AI Hub (OpenAI-compatible /v1/chat/completions).
// Any other OpenAI-compatible service works by changing AI_BASE_URL / AI_API_KEY / AI_MODEL.

const SCHEMA = {
  type: 'object',
  properties: {
    arabic: { type: 'string' },
    translit: { type: 'string' },
    words: {
      type: 'array',
      items: {
        type: 'object',
        properties: { ar: { type: 'string' }, en: { type: 'string' } },
        required: ['ar', 'en'],
      },
    },
  },
  required: ['arabic', 'translit', 'words'],
};

const STYLE = {
  msa: {
    name: 'Modern Standard Arabic (fusha), simple and natural',
    example: {
      in: 'How are you?',
      out: { arabic: 'كَيْفَ حَالُكَ؟', translit: 'kayf Haaluk?', words: [{ ar: 'كَيْفَ', en: 'how' }, { ar: 'حَالُكَ', en: 'your condition' }] },
    },
  },
  saudi: {
    name: 'everyday spoken Saudi Arabic (urban, as said in Riyadh and Jeddah)',
    example: {
      in: 'How are you?',
      out: { arabic: 'كِيفْ حَالَكْ؟', translit: 'keef Haalak?', words: [{ ar: 'كِيفْ', en: 'how' }, { ar: 'حَالَكْ', en: 'your condition' }] },
    },
  },
};

export function buildMessages(text, dialect) {
  const s = STYLE[dialect] || STYLE.msa;
  const shots = [
    { in: 'Thank you very much', out: { arabic: 'شُكْرًا جَزِيلًا', translit: 'shukran jazeelan', words: [{ ar: 'شُكْرًا', en: 'thanks' }, { ar: 'جَزِيلًا', en: 'very much' }] } },
    s.example,
  ];
  const system =
    `You translate English into ${s.name} for people learning to pronounce Arabic.\n` +
    'Rules:\n' +
    '1. "arabic": the translation with FULL harakat (fatha, damma, kasra, sukun, shadda) on every letter, so it can be read aloud correctly.\n' +
    '2. "translit": how to say it in English letters. aa/ee/oo = long vowels, \' = hamza, 3 = ع, H = ح, kh = خ, gh = غ, q = ق, th = ث, dh = ذ, S D T Z = ص ض ط ظ.\n' +
    '3. "words": every Arabic word of the translation, in order, with its short English meaning.\n' +
    'Return JSON only.';
  const msgs = [{ role: 'system', content: system }];
  for (const ex of shots) {
    msgs.push({ role: 'user', content: ex.in });
    msgs.push({ role: 'assistant', content: JSON.stringify(ex.out) });
  }
  msgs.push({ role: 'user', content: text });
  return msgs;
}

export function parseModelJson(content) {
  if (content && typeof content === 'object') return content;
  const str = String(content ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    return JSON.parse(str);
  } catch {
    const m = str.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('model did not return JSON');
  }
}

export async function translate(text, dialect, cfg, fetchImpl = fetch) {
  const url = cfg.aiBaseUrl.replace(/\/+$/, '') + '/chat/completions';
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.aiApiKey}` },
    body: JSON.stringify({
      model: cfg.aiModel,
      messages: buildMessages(text, dialect),
      temperature: 0.2,
      max_tokens: 500,
      response_format: { type: 'json_schema', json_schema: { name: 'translation', schema: SCHEMA } },
    }),
    signal: AbortSignal.timeout(cfg.aiTimeoutMs),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`AI service ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const out = parseModelJson(data?.choices?.[0]?.message?.content);
  if (!out || typeof out.arabic !== 'string' || !/[ء-ي]/.test(out.arabic)) {
    throw new Error('model returned no Arabic text');
  }
  return {
    arabic: out.arabic.trim(),
    translit: typeof out.translit === 'string' ? out.translit.trim() : '',
    words: Array.isArray(out.words)
      ? out.words.filter((w) => w && typeof w.ar === 'string').map((w) => ({ ar: w.ar.trim(), en: String(w.en ?? '').trim() }))
      : [],
  };
}
