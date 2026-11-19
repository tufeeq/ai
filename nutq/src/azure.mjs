// Azure AI Speech — text to speech over REST (no SDK).
// https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech

export const VOICES = [
  { id: 'ar-SA-HamedNeural', label: 'Hamed', gender: 'male', locale: 'ar-SA', region: 'Saudi' },
  { id: 'ar-SA-ZariyahNeural', label: 'Zariyah', gender: 'female', locale: 'ar-SA', region: 'Saudi' },
  { id: 'ar-AE-HamdanNeural', label: 'Hamdan', gender: 'male', locale: 'ar-AE', region: 'Emirati' },
  { id: 'ar-AE-FatimaNeural', label: 'Fatima', gender: 'female', locale: 'ar-AE', region: 'Emirati' },
  { id: 'ar-EG-ShakirNeural', label: 'Shakir', gender: 'male', locale: 'ar-EG', region: 'Egyptian' },
  { id: 'ar-EG-SalmaNeural', label: 'Salma', gender: 'female', locale: 'ar-EG', region: 'Egyptian' },
];

export const SPEEDS = { normal: '0%', slow: '-30%' };

export function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

export function buildSsml(text, voiceId, speed) {
  const v = VOICES.find((x) => x.id === voiceId) || VOICES[0];
  const rate = SPEEDS[speed] ?? SPEEDS.normal;
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${v.locale}">` +
    `<voice name="${v.id}"><prosody rate="${rate}">${escapeXml(text)}</prosody></voice></speak>`
  );
}

export async function synthesize(text, voiceId, speed, cfg, fetchImpl = fetch) {
  const url = cfg.azureEndpoint
    ? cfg.azureEndpoint.replace(/\/+$/, '') + '/cognitiveservices/v1'
    : `https://${cfg.azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': cfg.azureKey,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'nutq',
    },
    body: buildSsml(text, voiceId, speed),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const err = new Error(`Azure Speech ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return Buffer.from(await res.arrayBuffer());
}
