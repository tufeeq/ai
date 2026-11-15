# نقل مشروع يستخدم OpenAI SDK إلى AI Hub

إذا كان مشروعك يتصل اليوم بـ OpenAI عبر المكتبة الرسمية (أو أي مكتبة متوافقة معها)، فالنقل تغيير في الإعدادات لا في الكود: عنوان الخدمة والمفتاح فقط.

## التغيير المطلوب

| الإعداد | قبل | بعد |
|---|---|---|
| عنوان الخدمة (base URL) | `https://api.openai.com/v1` | `https://<عنوان-الـhub>/v1` — مثال: `https://ai.tryn.cc/v1` |
| المفتاح | مفتاح OpenAI | مفتاح المشروع من صفحة `/admin` (يبدأ بـ `hub_`) |
| اسم النموذج | `gpt-4o-mini` مثلًا | اتركه كما هو — أي اسم لا يعرفه الـhub يُحوَّل إلى نموذجه |

أغلب المشاريع تقرأ هذين المتغيرين من البيئة، فيكفي تعديلهما في إعدادات المشروع:

```bash
OPENAI_BASE_URL=https://ai.tryn.cc/v1
OPENAI_API_KEY=hub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

لا تضع المفتاح في الكود ولا في المستودع؛ ضعه في متغيرات البيئة أو في Secrets.

### Python (مكتبة openai)

```python
import os
from openai import OpenAI

client = OpenAI(
    base_url=os.environ["AI_HUB_URL"].rstrip("/") + "/v1",
    api_key=os.environ["AI_HUB_KEY"],
    timeout=240,          # النموذج يعمل على المعالج؛ امنحه وقتًا
)

res = client.chat.completions.create(
    model="gpt-4o-mini",  # يبقى كما هو
    messages=[{"role": "user", "content": "لخّص هذا النص في سطرين: ..."}],
    max_tokens=300,
)
print(res.choices[0].message.content)
```

### Node.js (مكتبة openai)

```js
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: `${process.env.AI_HUB_URL.replace(/\/+$/, '')}/v1`,
  apiKey: process.env.AI_HUB_KEY,
  timeout: 240_000,
});

const res = await client.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Summarise this in two lines: ...' }],
  max_tokens: 300,
});
console.log(res.choices[0].message.content);
```

إن لم تكن تستخدم المكتبة أصلًا، فالأمثلة الجاهزة في هذا المجلد (`python_example.py`، `node_example.mjs`، `curl_examples.sh`) تعمل دون تثبيت أي شيء.

## ما هو مدعوم في الإصدار الأول

- `POST /v1/chat/completions` و `GET /v1/models`.
- الحقول: `model`، `messages`، `temperature`، `max_tokens` أو `max_completion_tokens`، `stream`، و `response_format: {"type": "json_object"}`.
- الأدوار: `system` و `user` و `assistant`. المحتوى نص، أو مصفوفة أجزاء من نوع `text` فقط.
- البث (`stream: true`) بصيغة OpenAI نفسها وينتهي بـ `data: [DONE]`.
- حقل `usage` في الرد (عدد الرموز تقديري عند الحاجة).
- الأخطاء بصيغة OpenAI: `{ "error": { "message", "type", "code" } }`.

## ما هو غير مدعوم

| الميزة | الحالة | ماذا تفعل |
|---|---|---|
| الأدوات واستدعاء الدوال (`tools`، `tool_calls`، رسائل بدور `tool` أو `function`) | غير مدعومة | اطلب من النموذج JSON عبر `response_format` ونفّذ المنطق في كودك |
| الصور والرؤية (`image_url`) | غير مدعومة — الطلب يُرفض بخطأ 400 | أرسل نصًا فقط |
| التضمينات (`/v1/embeddings`) | غير موجودة | أبقِها على مزوّدك الحالي أو أجّلها |
| الصوت، توليد الصور، الملفات، Assistants، Responses API، Batch | غير موجودة | — |
| أكثر من إجابة للطلب الواحد (`n` أكبر من 1) | مرفوض | أرسل طلبات متتالية |
| `response_format` بنوع `json_schema` (المخرجات المقيّدة بمخطط) | غير مضمون | استخدم `json_object` وتحقق من النتيجة في كودك |

## فروق يجب أن تحسب حسابها

1. **السرعة.** النموذج صغير ويعمل على معالج الخادم. الإجابة قد تأخذ من ثوانٍ إلى دقيقة أو أكثر. ارفع مهلة الانتظار في العميل (240 ثانية اقتراح معقول) واستخدم البث في الواجهات التي ينتظر أمامها إنسان.
2. **الجودة.** النموذج أضعف من النماذج المدفوعة الكبيرة في الاستدلال الطويل والكتابة المصقولة والتعليمات المعقّدة. اكتب تعليمات قصيرة ومحددة، وقسّم المهمة الكبيرة إلى خطوات.
3. **نافذة السياق.** الافتراضي 4096 رمزًا للمدخل والمخرج معًا (`AI_NUM_CTX`). النصوص الطويلة يجب تقطيعها.
4. **JSON.** مع `json_object` يعيد النموذج JSON في الغالب، لكن تحقق دائمًا من الحقول قبل الاعتماد عليها.
5. **طلب واحد في كل مرة.** الخادم يعالج الطلبات بالتتابع؛ الطلبات المتزامنة تنتظر دورها. الحد الافتراضي 60 طلبًا في الدقيقة لكل مفتاح، وعند تجاوزه يعود الخطأ 429 مع ترويسة `Retry-After`.

## خطة نقل آمنة

1. أنشئ مفتاحًا خاصًا بالمشروع من `/admin`.
2. جرّب أهم ثلاث تعليمات في مشروعك عبر `curl_examples.sh` أو واجهة المحادثة، وقارن النتيجة بما تحصل عليه اليوم.
3. انقل أولًا المهام البسيطة (تلخيص، تصنيف، صياغة قصيرة، استخراج حقول). أبقِ المهام التي تحتاج أدوات أو صورًا أو استدلالًا عميقًا على مزوّدها الحالي إلى أن تتأكد.
4. راقب الاستخدام ونسبة الأخطاء في `/admin` أسبوعًا قبل إلغاء المفتاح المدفوع.

---

## المشاريع المبنية على Claude (Anthropic SDK)

المركز يقبل أيضًا صيغة Claude على `POST /v1/messages`، فيعمل معه Anthropic SDK كما هو.

```bash
# عنوان المركز دون ‎/v1 — المكتبة تضيفه بنفسها
ANTHROPIC_BASE_URL=https://ai.example.com
ANTHROPIC_API_KEY=hub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

مكتبتا Python و Node تقرآن `ANTHROPIC_BASE_URL` تلقائيًا. المشروع الذي يتصل بـ `https://api.anthropic.com/v1/messages` مباشرة (بلا المكتبة) يحتاج أن يقرأ العنوان من متغير بيئة.

**مهم:** لا توجّه المشروع كله إلى المركز. اجعل في طبقة الاتصال عميلين: عميل Claude للمهام الثقيلة، وعميل المركز للمهام الخفيفة فقط، مع الرجوع إلى Claude إذا ردّ المركز بخطأ.

| | |
|---|---|
| مدعوم | `system` (نص أو كتل نصية)، رسائل نصية، `temperature`، `max_tokens` (حتى 4096)، `stream`، `stop_sequences` (دون بث) |
| مخرجات منظمة | `output_config.format` من نوع `json_schema`، أو **أداة واحدة** مخصّصة: يعود الجواب ككتلة `tool_use` مطابقة لمخططها. JSON غير صالح مرتين = خطأ 502 صريح، لا كائن مختلق |
| يُقبل ويُتجاهل | `thinking`، `output_config.effort`، `cache_control`، `metadata` |
| يُرفض بخطأ 400 واضح | الصور والمستندات (PDF)، البحث في الويب وأدوات الخادم، عدة أدوات يختار بينها النموذج، جولات `tool_result`، الدفعات (batches)، وأي طلب أطول من نافذة سياق النموذج (`AI_NUM_CTX`، الافتراضي 4096 رمزًا) |

أسماء نماذج Claude (`claude-haiku-…` وغيرها) تُحوَّل إلى نموذج المركز، ويعود اسم النموذج الفعلي في الرد.

---

# Migrating an OpenAI-SDK project to AI Hub (English)

It is a configuration change, not a code change.

- **Base URL:** `https://<your-hub>/v1` (for example `https://ai.tryn.cc/v1`).
- **API key:** a project key created in `/admin` (starts with `hub_`).
- **Model name:** leave it. Names the hub does not know, including `gpt-*`, map to the hub's configured model.

```bash
OPENAI_BASE_URL=https://ai.tryn.cc/v1
OPENAI_API_KEY=hub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Keep the key in environment variables or secrets, never in the repository.

**Supported in v1:** `POST /v1/chat/completions`, `GET /v1/models`; fields `model`, `messages`, `temperature`, `max_tokens` / `max_completion_tokens`, `stream`, `response_format: {"type":"json_object"}`; roles `system`, `user`, `assistant`; text content (string or `text` parts); OpenAI-style streaming and error objects; a `usage` block.

**Not supported in v1:** tools / function calling (including `tool` and `function` role messages), vision / image input (rejected with 400), embeddings, audio, image generation, files, Assistants, the Responses API, batch, `n` greater than 1, and schema-constrained output (`json_schema`).

**Plan for:** slower answers (set client timeouts to about 240 s and prefer streaming for interactive screens), lower quality than large paid models on long reasoning, a 4096-token default context (`AI_NUM_CTX`), one request processed at a time, and a default limit of 60 requests per minute per key (429 with `Retry-After`).

**Suggested order:** create a dedicated key, test your three most important prompts, move simple tasks first (summaries, classification, short drafting, field extraction), watch usage and errors in `/admin` for a week, then retire the paid key.

## Projects built on Claude (Anthropic SDK)

The hub also accepts the Claude format at `POST /v1/messages`, so the Anthropic SDK works unchanged: set `ANTHROPIC_BASE_URL` to the hub origin (no `/v1` suffix; both the Python and Node SDKs read it) and use a hub key as `ANTHROPIC_API_KEY`. Code that calls `https://api.anthropic.com/v1/messages` directly must read the URL from an environment variable instead.

Do not point a whole project at the hub. Keep two clients in the project's AI wrapper: Claude for heavy work, the hub for light tasks only, falling back to Claude when the hub returns an error.

- **Supported:** `system` (string or text blocks), text messages, `temperature`, `max_tokens` (capped at 4096), `stream`, `stop_sequences` (non-stream).
- **Structured output:** `output_config.format` of type `json_schema`, or **one** custom tool, answered as a `tool_use` block matching its schema. Invalid JSON twice is an explicit 502, never an invented object.
- **Accepted and ignored:** `thinking`, `output_config.effort`, `cache_control`, `metadata`.
- **Refused with a clear 400:** images and documents (PDF), web search and other server tools, several tools chosen by the model, `tool_result` turns, batches, and any prompt longer than the model's context window (`AI_NUM_CTX`, default 4096 tokens).

Claude model names map to the hub's model; the response reports the model actually used.
