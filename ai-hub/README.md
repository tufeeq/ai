# AI Hub — مركز الذكاء الاصطناعي الخاص بمشاريعك

خدمة ذكاء اصطناعي تعمل على خادمك أنت (Contabo + Dokploy)، وتشغّل نموذجًا مفتوح المصدر عبر Ollama على المعالج دون بطاقة رسوميات. لا يوجد فيها أي اتصال بخدمة ذكاء اصطناعي مدفوعة، فلا فاتورة على عدد الرموز. التكلفة الوحيدة هي الخادم الذي تدفع إيجاره أصلًا.

خطوات النشر كاملة في [DEPLOY.md](DEPLOY.md).

## ماذا تفعل

1. **بوابة متوافقة مع OpenAI** — العنوان `/v1/chat/completions`. أي مشروع يتصل اليوم بـ OpenAI يغيّر عنوان الخدمة والمفتاح فقط ويتوقف عن الدفع لكل رمز. التفاصيل في [clients/MIGRATE.md](clients/MIGRATE.md).
2. **مساعد محادثة** — واجهة ويب بالعربية والإنجليزية (من اليمين إلى اليسار)، مع معرفة خاصة بكل مشروع تُستخرج من ملفات المستودع.
3. **تحليل أسهم TAGit** — نقطة اتصال تنتج ملف JSON بالشكل نفسه الذي يقرؤه TAGit (`tag/data/ai-stock-analysis.json`، الإصدار 4 من المخطط)، وتعتمد على مصادر أخبار وإفصاحات عامة مجانية.

## البنية باختصار

```
متصفحك / مشاريعك / GitHub Actions
            │  HTTPS  (ai.tryn.cc)
            ▼
   Traefik داخل Dokploy
            │
            ▼
   حاوية hub  (Node.js 22، المنفذ 8080)
   المفاتيح · حدّ الطلبات · المعرفة · سجل الاستخدام · الواجهات
            │  شبكة داخلية خاصة
            ▼
   حاوية ollama  (النموذج، المنفذ 11434 — غير مكشوف للإنترنت)
```

- حاويتان فقط في ملف `docker-compose.yml` واحد. Ollama لا يُنشر على الإنترنت؛ الـhub وحده يكلّمه.
- الـhub مكتوب بـ Node.js دون أي مكتبة خارجية، فلا توجد خطوة تثبيت ولا تبعيات تحتاج تحديثًا.
- البيانات في مجلّدين دائمين: `ollama-models` (ملفات النموذج) و `hub-data` (بصمات المفاتيح وسجل الاستخدام).
- لا يُخزَّن من كل مفتاح إلا بصمته (SHA-256)؛ المفتاح نفسه يظهر مرة واحدة عند إنشائه.
- المشاريع المعرّفة مسبقًا: `general`، `tagit`، `operon`، `marginos`، `myai`، `dont-chaos`.

## نقاط الاتصال

كل النقاط عدا `/health` والصفحات الثابتة تحتاج مفتاحًا في الترويسة `Authorization: Bearer <المفتاح>` (أو `x-api-key`).

| الطريقة والمسار | الصلاحية | الوظيفة |
|---|---|---|
| `GET /health` | عامة | حالة الخدمة والنموذج (جاهز / قيد التنزيل) |
| `GET /` | صفحة عامة، تطلب مفتاحًا | واجهة المحادثة |
| `GET /admin` | صفحة عامة، تطلب مفتاح المدير | لوحة الإدارة |
| `GET /v1/models` | مفتاح مشروع | النماذج المتاحة بصيغة OpenAI |
| `POST /v1/chat/completions` | مفتاح مشروع | إكمال المحادثة بصيغة OpenAI (عادي أو بث) |
| `GET /api/me` | مفتاح مشروع | هوية المفتاح: الدور والمشروع والاسم |
| `GET /api/projects` | مفتاح مشروع | قائمة المشاريع (مفتاح المشروع يرى مشروعه و `general`) |
| `POST /api/chat` | مفتاح مشروع | محادثة مع معرفة المشروع وقائمة المصادر |
| `POST /api/tagit/analyze` | مفتاح مشروع | تحليل حتى 8 أسهم وإرجاع JSON بمخطط TAGit |
| `GET /api/admin/keys` | مدير | عرض المفاتيح (دون القيم) |
| `POST /api/admin/keys` | مدير | إنشاء مفتاح `{ name, project }` — يظهر مرة واحدة |
| `DELETE /api/admin/keys/:id` | مدير | إلغاء مفتاح |
| `GET /api/admin/usage?days=30` | مدير | ملخص الاستخدام والتوفير التقديري |
| `GET /api/admin/status` | مدير | الإصدار، مدة التشغيل، حالة النموذج والمعرفة |

أمثلة جاهزة للتشغيل في مجلد [clients/](clients/): Python و Node.js و curl.

## كيف يُحسب «التوفير التقديري»

لوحة الإدارة تعرض رقمًا بعنوان «التوفير التقديري بالدولار». طريقة حسابه:

```
التوفير = (رموز المدخلات ÷ 1,000,000 × REF_PRICE_IN_PER_M)
        + (رموز المخرجات ÷ 1,000,000 × REF_PRICE_OUT_PER_M)
```

- السعران المرجعيان الافتراضيان: 2.5 دولار لكل مليون رمز مدخل و 10 دولارات لكل مليون رمز مخرج. تغيّرهما من متغيّري البيئة ليطابقا الخدمة المدفوعة التي تقارن بها.
- عدد الرموز يأتي من النموذج عند توفره، وإلا فهو تقدير (نحو 4 أحرف للرمز في اللاتينية وحرفين في العربية).
- **هذا تقدير وليس فاتورة.** هو جواب عن سؤال: «كم كان سيكلّف هذا الحجم من الاستخدام لو أُرسل إلى خدمة مدفوعة بهذه الأسعار؟». لا يطرح تكلفة الخادم، ولا يعني أن النموذج المحلي يعطي جودة الخدمة المدفوعة نفسها.

## حدود يجب أن تعرفها قبل الاعتماد عليه

- **أبطأ وأقل قدرة من النماذج المدفوعة الكبيرة.** النموذج الافتراضي صغير (`gemma3:4b`) ويعمل على المعالج. يصلح للتلخيص والتصنيف والصياغة القصيرة واستخراج الحقول والأسئلة عن ملفات المشروع. يضعف في الاستدلال الطويل والتحليل العميق والكتابة المصقولة، وقد يخطئ بثقة. راجع مخرجاته قبل استخدامها في شيء مهم.
- **طلب واحد في كل مرة.** الطلبات المتزامنة تنتظر دورها. أول طلب بعد فترة توقف أبطأ لأن النموذج يُحمَّل في الذاكرة.
- **لا يتصفح الإنترنت.** لا يفتح صفحات ولا يبحث. تحليل TAGit يعتمد على المقاييس التي يرسلها TAGit نفسه، مضافًا إليها عناوين أخبار عامة مجانية (Google News و Yahoo Finance عبر RSS) وإفصاحات SEC EDGAR. يقرأ العناوين لا نصوص المقالات. إن تعذّر جلب الأخبار يعمل التحليل دونها ويذكر ذلك.
- **مخرجات TAGit سياق بحثي وليست نصيحة استثمارية.** لا توصية شراء أو بيع ولا ضمان ربح. وإذا فشل النموذج في تحليل سهم فالنتيجة تقول ذلك صراحة (`INSUFFICIENT_EVIDENCE` مع `aiStatus: MODEL_FAILED`)، ولا يُعرض نص آلي بديل على أنه تحليل ذكاء اصطناعي.
- **غير مدعوم في الإصدار الأول:** الأدوات واستدعاء الدوال، الصور، التضمينات (embeddings).
- **المستودع عام.** لا تضع أي مفتاح أو كلمة سر في أي ملف يُرفع إليه. المفاتيح مكانها تبويب Environment في Dokploy و Secrets في GitHub فقط. ملف `.env.example` يحتوي قيمًا افتراضية آمنة دون أسرار.
- **ترخيص النموذج.** الافتراضي `gemma3:4b` يخضع لشروط استخدام Gemma؛ راجعها لمشروعك. النموذج الأخف `qwen2.5:3b` صادر بترخيص Qwen البحثي لا Apache 2.0 بحسب صفحة Ollama، ولذلك لم يُجعل افتراضيًا. البدائل في جدول DEPLOY.md.

## التشغيل المحلي والاختبارات (للمطوّر)

```bash
cd ai-hub
cp .env.example .env
docker compose up -d --build     # ثم فعّل قسم ports في docker-compose.yml لفتح http://localhost:8080
node --test tests/               # الاختبارات لا تحتاج شبكة ولا Ollama
```

---

# AI Hub (English)

A self-hosted AI service for all of the owner's projects. It runs an open-source model through Ollama on the owner's own VPS (Dokploy, CPU only). No paid AI API is called anywhere, so there is no per-token bill; the only cost is the server already being rented. Deployment steps are in [DEPLOY.md](DEPLOY.md).

## Three jobs

1. **OpenAI-compatible gateway** at `/v1/chat/completions`: a project swaps its base URL and key and stops paying per token. See [clients/MIGRATE.md](clients/MIGRATE.md).
2. **Chat assistant**: Arabic and English web UI (RTL) with per-project knowledge built from the repository files.
3. **TAGit stock analysis**: an endpoint that returns the same JSON shape TAGit already reads (`tag/data/ai-stock-analysis.json`, schemaVersion 4), using free public news and filings.

## Architecture

Two containers in one `docker-compose.yml`: `hub` (Node.js 22, zero npm dependencies, port 8080) and `ollama` (the model, port 11434, private network only). Dokploy's Traefik terminates HTTPS and routes the domain to `hub:8080`. State lives in two named volumes: `ollama-models` and `hub-data` (key hashes, usage log). Keys are stored only as SHA-256 hashes.

## Endpoints

| Method and path | Access | Purpose |
|---|---|---|
| `GET /health` | public | Service and model status |
| `GET /`, `GET /admin` | public pages, key required inside | Chat UI, admin panel |
| `GET /v1/models` | project key | Model list, OpenAI shape |
| `POST /v1/chat/completions` | project key | OpenAI-compatible chat (stream or not) |
| `GET /api/me`, `GET /api/projects` | project key | Key identity, project list |
| `POST /api/chat` | project key | Chat with project knowledge and sources |
| `POST /api/tagit/analyze` | project key | Up to 8 tickers, TAGit schema JSON |
| `GET/POST /api/admin/keys`, `DELETE /api/admin/keys/:id` | admin | Manage keys |
| `GET /api/admin/usage?days=30`, `GET /api/admin/status` | admin | Usage summary, status |

Send the key as `Authorization: Bearer <key>` or `x-api-key`. Runnable examples are in [clients/](clients/).

## The "estimated saved" figure

`saved = input tokens / 1M × REF_PRICE_IN_PER_M + output tokens / 1M × REF_PRICE_OUT_PER_M` (defaults 2.5 and 10 USD). Token counts come from the model, or from a character-based estimate when it does not report them. It is an estimate of what the same volume would have cost on a paid API at those reference prices. It is not a bill, it does not subtract the server cost, and it does not imply equal quality.

## Honest limitations

- A small open-source model on CPU is slower and less capable than large paid models. Good for summaries, classification, short drafting, field extraction and questions about project files; weak at long reasoning. It can be confidently wrong.
- One request at a time; the first request after idle is slower while the model loads.
- No live web browsing. TAGit analysis uses the metrics TAGit supplies plus free public headlines (RSS) and SEC EDGAR filings, headlines only, not article bodies.
- TAGit output is research context, not investment advice. A model failure is reported as such, never replaced with rules-based text.
- No tools / function calling, vision or embeddings in v1.
- The repository is public: never commit keys. Secrets belong in Dokploy's Environment tab and GitHub Secrets only.
- The default `gemma3:4b` is covered by the Gemma terms of use; review them for your project. The lighter `qwen2.5:3b` is under the Qwen research licence rather than Apache 2.0 per its Ollama page, so it is not the default. Alternatives are in the DEPLOY.md table.
