# نشر AI Hub على Dokploy — خطوة بخطوة

هذا الدليل مكتوب لصاحب الخادم لا للمطوّر. اتبع الخطوات بالترتيب. الوقت المتوقع: نحو نصف ساعة، أغلبه انتظار تنزيل النموذج.

**ما تحتاجه قبل البدء**

- لوحة Dokploy على خادم Contabo، وعنوان IP العام للخادم.
- صلاحية الدخول إلى Namecheap للنطاق `tryn.cc`.
- صلاحية الدخول إلى مستودع GitHub `tufeeq/ai`.

أسماء الأزرار والحقول بالإنجليزية كما تظهر في لوحة Dokploy. قد يختلف موضع زر بين إصدار وآخر؛ الأسماء هنا مأخوذة من وثائق Dokploy المذكورة آخر الملف.

---

## 1) إنشاء الخدمة في Dokploy

**أ. ربط GitHub (مرة واحدة فقط — تجاوزها إن كان Dokploy مربوطًا بحسابك من قبل)**

1. في Dokploy افتح قسم **Git** واختر GitHub.
2. اضغط **Create Github App**، سمِّ التطبيق أي اسم، ثم أكمل الإنشاء.
3. بعد العودة إلى Dokploy اضغط **Install**، واختر المستودع `tufeeq/ai` (أو كل المستودعات)، ثم **Install & Authorize**.

**ب. إنشاء المشروع والخدمة**

1. **Projects ← Create Project** وسمِّه `ai-hub`.
2. داخل المشروع: **Create Service ← Compose**. الاسم `ai-hub`.
3. في **Compose Type** اختر **Docker Compose**. لا تختر Stack؛ وثائق Dokploy تذكر أنه لا يدعم البناء (`build`) والخدمة تحتاجه.
4. في تبويب **General** املأ المصدر:

| الحقل | القيمة |
|---|---|
| Provider | GitHub |
| Repository | `tufeeq/ai` |
| Branch | `claude/ai-hub` الآن، ثم `main` بعد الدمج (انظر الخطوة 8) |
| Compose Path | `./ai-hub/docker-compose.yml` |

5. اضغط **Save**. لا تضغط Deploy بعد.

---

## 2) متغيّرات البيئة

افتح تبويب **Environment** في الخدمة والصق الآتي، ثم احفظ. Dokploy يكتب هذه القيم في ملف `.env` بجانب ملف الـcompose، والملف يقرؤها من هناك.

```env
ADMIN_KEY=ضع-هنا-الناتج-من-الأمر-أدناه
AI_MODEL=gemma3:4b
AI_NUM_CTX=4096
LLM_TIMEOUT_MS=180000
AUTO_PULL_MODEL=true
RATE_LIMIT_RPM=60
REF_PRICE_IN_PER_M=2.5
REF_PRICE_OUT_PER_M=10
```

**مفتاح المدير (`ADMIN_KEY`)** تولّده أنت، ولا يراه أحد غيرك. افتح الطرفية (Terminal) على جهازك أو على الخادم ونفّذ:

```bash
openssl rand -base64 32
```

انسخ الناتج إلى `ADMIN_KEY`، واحفظه في مدير كلمات السر. لا تضعه في أي ملف داخل المستودع ولا ترسله في محادثة.
إن تركت `ADMIN_KEY` فارغًا يولّد الـhub مفتاحًا عند أول تشغيل ويطبعه مرة واحدة في سجلّ الحاوية بعبارة `ADMIN KEY (save it): ...`.

**معنى كل متغيّر**

| المتغيّر | الافتراضي | معناه |
|---|---|---|
| `ADMIN_KEY` | فارغ | مفتاح لوحة الإدارة وإنشاء المفاتيح |
| `AI_MODEL` | `gemma3:4b` | النموذج المستخدم — اختره من جدول المقاسات أدناه |
| `AI_NUM_CTX` | `4096` | نافذة السياق بالرموز. الأكبر يحتاج ذاكرة أكثر ويبطئ الإجابة |
| `LLM_TIMEOUT_MS` | `180000` | أقصى مدة لطلب واحد (3 دقائق) |
| `AUTO_PULL_MODEL` | `true` | تنزيل النموذج تلقائيًا عند أول تشغيل |
| `RATE_LIMIT_RPM` | `60` | الحد الأقصى للطلبات في الدقيقة لكل مفتاح |
| `MAX_BODY_BYTES` | `1000000` | أقصى حجم للطلب الواحد |
| `REF_PRICE_IN_PER_M` | `2.5` | السعر المرجعي لمليون رمز مدخل (لحساب التوفير التقديري فقط) |
| `REF_PRICE_OUT_PER_M` | `10` | السعر المرجعي لمليون رمز مخرج (لحساب التوفير التقديري فقط) |
| `OLLAMA_KEEP_ALIVE` | `30m` | مدة بقاء النموذج في الذاكرة بعد آخر طلب |

المتغيّرات `PORT` و `DATA_DIR` و `OLLAMA_URL` مضبوطة داخل ملف الـcompose؛ لا تغيّرها.

### اختيار النموذج حسب ذاكرة الخادم

الأحجام مأخوذة من صفحات مكتبة Ollama (روابطها آخر الملف). القاعدة العملية: يحتاج النموذج ذاكرة بحجم ملفه مضافًا إليه نحو 1 إلى 2 غيغابايت، ويجب أن يبقى في الخادم متّسع لباقي مشاريعك.

| ذاكرة الخادم | النموذج المقترح | حجم التنزيل | ملاحظات |
|---|---|---|---|
| 8 GB (أخف) | `qwen2.5:3b` | 1.9 GB | العربية ضمن اللغات المذكورة في صفحته. ترخيصه بحثي (Qwen) لا Apache 2.0، فلا يصلح افتراضيًا لمشاريع تجارية |
| 8 GB | `gemma3:4b` (الافتراضي) | 3.4 GB | صفحته تذكر دعم أكثر من 140 لغة. شروط استخدام Gemma (راجعها لمشروعك). يضيّق الذاكرة إن كانت على الخادم مشاريع أخرى |
| 16 GB | `qwen2.5:7b` | 4.7 GB | أفضل توازن بين الجودة والسرعة. ترخيص Apache 2.0 |
| 24 GB فأكثر | `qwen2.5:14b` أو `gemma3:12b` | 9.0 GB / 8.2 GB | جودة أعلى لكنه بطيء على المعالج؛ يناسب المهام المجدولة لا المحادثة الحية |

ملاحظات صريحة:

- `llama3.2:3b` (2.0 GB) موجود وسريع، لكن العربية ليست ضمن لغاته المدعومة رسميًا في صفحته، فلا أنصح به للعمل بالعربية.
- للمقارنة فقط: `qwen2.5:1.5b` (986 MB) و `gemma3:1b` (806 MB) أسرع بكثير وأضعف بوضوح؛ يصلحان عند ضيق الذاكرة لا لتحليل TAGit.
- توجد إصدارات أحدث من هذه العائلات (مثل Qwen 3)، لكني لم أتمكن من فتح صفحاتها في مكتبة Ollama للتحقق من الوسوم والأحجام، فلم أُدرجها. تحقّق من `ollama.com/library` قبل تجربة أي وسم غير مذكور هنا؛ الوسم الخاطئ يُفشل التنزيل.
- مسألة الترخيص: صفحة Ollama تنص على أن مقاسَي 3B و 72B من Qwen2.5 بترخيص Qwen وباقي المقاسات Apache 2.0. لهذا جُعل الافتراضي `gemma3:4b` لا `qwen2.5:3b`. إن أردت ترخيص Apache 2.0 صريحًا فاختر `qwen2.5:7b` (يحتاج 16 GB). هذه ملاحظة لا استشارة قانونية.

### السرعة المتوقعة على خادم بلا بطاقة رسوميات

هذه أرقام تقريبية من الخبرة العامة مع هذا الصنف من النماذج، **لا قياسات على خادمك**. السرعة الفعلية تتبع عدد أنوية المعالج وهل هي مشتركة مع عملاء آخرين (كما في أغلب خطط VPS). قِسها بنفسك بعد النشر من واجهة المحادثة.

| حجم النموذج | السرعة التقريبية | ما يعنيه عمليًا |
|---|---|---|
| 3B – 4B | 5 إلى 12 رمزًا في الثانية | فقرة قصيرة خلال 15 إلى 40 ثانية |
| 7B | 2 إلى 5 رموز في الثانية | فقرة قصيرة خلال دقيقة تقريبًا |
| 12B – 14B | 1 إلى 2 رمز في الثانية | عدة دقائق للإجابة؛ قد تتجاوز المهلة الافتراضية |

الكلمة العربية تساوي في الغالب رمزين إلى ثلاثة. أول طلب بعد توقف أبطأ لأن النموذج يُحمَّل في الذاكرة. تحليل TAGit لثمانية أسهم يجري بالتتابع وقد يأخذ عدة دقائق.

---

## 3) النطاق و HTTPS

**أ. سجل DNS في Namecheap (ابدأ به لأن انتشاره يأخذ وقتًا)**

1. Namecheap ← **Domain List** ← **Manage** بجانب `tryn.cc` ← تبويب **Advanced DNS**.
2. في قسم **Host Records** اضغط **Add New Record** واملأ:

| Type | Host | Value | TTL |
|---|---|---|---|
| A Record | `ai` | عنوان IP العام لخادم Contabo | Automatic |

3. احفظ. في خانة Host اكتب `ai` فقط دون `tryn.cc`. الانتشار يأخذ عادة حتى 30 دقيقة.

إن لم يظهر تبويب Advanced DNS فالنطاق يستخدم خوادم أسماء خارج Namecheap، ويُضاف السجل عند مزوّد الـDNS الفعلي.

**ب. النطاق في Dokploy**

1. في الخدمة افتح تبويب **Domains** ← **Add Domain**.
2. املأ:

| الحقل | القيمة |
|---|---|
| Service Name | `hub` |
| Host | `ai.tryn.cc` |
| Path | `/` |
| Container Port | `8080` |
| HTTPS | مفعّل |
| Certificate | `letsencrypt` |

3. احفظ. في خدمات Compose لا يُطبَّق النطاق إلا عند النشر التالي، لأن Dokploy يضيف إعدادات التوجيه إلى الحاوية وقت النشر. لذلك أضف النطاق قبل الخطوة 4، وإن عدّلته لاحقًا فأعد النشر.

فعّل HTTPS بعد أن يصبح سجل DNS يشير إلى الخادم؛ شهادة Let's Encrypt لا تصدر قبل ذلك.

---

## 4) النشر وانتظار تنزيل النموذج

1. في تبويب **General** اضغط **Deploy**، وتابع التقدّم في تبويب **Deployments**.
2. بعد اكتمال النشر يبدأ الـhub تنزيل النموذج في الخلفية (1.9 GB للنموذج الافتراضي). يأخذ ذلك دقائق حسب سرعة الخادم، ومرة واحدة فقط؛ الملف يبقى محفوظًا بعد إعادة النشر.
3. افتح `https://ai.tryn.cc/health` في المتصفح:
   - `"pulling": true` أو `"defaultModelReady": false` ← التنزيل جارٍ، انتظر وحدّث الصفحة.
   - `"defaultModelReady": true` ← الخدمة جاهزة.
4. الحالة نفسها تظهر في بطاقة الحالة في `/admin` وفي مؤشر النموذج أعلى واجهة المحادثة.

إن ظهر تحذير شهادة في الدقيقة الأولى فانتظر قليلًا؛ Traefik يحتاج ثوانيَ لإصدار الشهادة.

---

## 5) لوحة الإدارة: مفتاح لكل مشروع

1. افتح `https://ai.tryn.cc/admin` وأدخل `ADMIN_KEY`.
2. أنشئ مفتاحًا مستقلًا لكل مشروع، واختر المشروع الصحيح من القائمة (`tagit`، `operon`، `marginos`، `myai`، `dont-chaos`، أو `general`).
3. المفتاح يظهر **مرة واحدة فقط**. انسخه فورًا إلى مكانه (الخطوتان 6 و 7). إن ضاع فألغِه وأنشئ غيره.

لماذا مفتاح لكل مشروع: لترى استخدام كل مشروع على حدة، ولتلغي مفتاحًا تسرّب دون أن تتوقف بقية المشاريع. لا تستخدم مفتاح المدير داخل أي مشروع.

---

## 6) ربط TAGit

1. في GitHub افتح المستودع `tufeeq/ai` ← **Settings** ← **Secrets and variables** ← **Actions**.
2. تبويب **Variables** ← **New repository variable**:
   - Name: `AI_HUB_URL` — Value: `https://ai.tryn.cc` (دون شرطة مائلة في الآخر)
3. تبويب **Secrets** ← **New repository secret**:
   - Name: `AI_HUB_KEY` — Secret: مفتاح المشروع `tagit` الذي أنشأته في الخطوة 5
4. افتح تبويب **Actions**، واختر من القائمة **TAGit Self-Hosted AI Stock Analysis (no API cost)**، ثم **Run workflow** لتشغيله يدويًا مرة واحدة.
5. تحقّق من نجاح التشغيل ومن تحديث الملف `tag/data/ai-stock-analysis.json` (الحقل `provider` يصبح `SELF_HOSTED_OLLAMA`).

ملاحظة: GitHub لا يعرض زر التشغيل اليدوي إلا إذا كان ملف الـworkflow موجودًا في الفرع الافتراضي (`main`). إن لم تجد الاسم في القائمة فادمج الفرع أولًا.

---

## 7) ربط بقية المشاريع

أي مشروع يستخدم مكتبة OpenAI أو صيغتها يحتاج تغيير إعدادين فقط:

```env
OPENAI_BASE_URL=https://ai.tryn.cc/v1
OPENAI_API_KEY=مفتاح-المشروع-من-لوحة-الإدارة
```

اسم النموذج في الكود يبقى كما هو؛ أي اسم لا يعرفه الـhub يُحوَّل إلى نموذجه. ما هو مدعوم وغير مدعوم مفصّل في [clients/MIGRATE.md](clients/MIGRATE.md)، والأمثلة الجاهزة في مجلد [clients/](clients/).

---

## 8) التحديث والنسخ الاحتياطي وحل المشكلات

### التحديث

- **تلقائي:** عند الربط عبر تطبيق GitHub، ينشر Dokploy تلقائيًا كل دفع (push) إلى الفرع المحدّد في الخدمة. الدفع إلى فرع آخر لا ينشر شيئًا.
- **يدوي:** زر **Deploy** في تبويب General.
- **بعد دمج `claude/ai-hub` في `main`:** غيّر حقل Branch إلى `main`، احفظ، ثم Deploy. إن لم تفعل فلن تصل التحديثات الجديدة إلى الخادم.
- **تغيير النموذج:** عدّل `AI_MODEL` في Environment ثم Deploy. يُنزَّل النموذج الجديد عند التشغيل، والقديم يبقى على القرص إلى أن تحذفه.
- المفاتيح وسجل الاستخدام والنماذج لا تتأثر بإعادة النشر.

### النسخ الاحتياطي

البيانات في مجلّدين دائمين (named volumes):

| المجلّد | محتواه | هل يُنسخ؟ |
|---|---|---|
| `hub-data` | بصمات المفاتيح، سجل الاستخدام، مفتاح المدير المولَّد | نعم — صغير ومهم |
| `ollama-models` | ملفات النماذج (عدة غيغابايت) | لا حاجة — يُعاد تنزيلها |

- من Dokploy: ميزة **Volume Backups** تعمل مع هذا النوع من المجلّدات.
- يدويًا من طرفية الخادم (اعرف الاسم الكامل للمجلّد أولًا، فـDocker يضيف إليه اسم المشروع):

```bash
docker volume ls | grep hub-data
docker run --rm -v الاسم-الكامل-للمجلّد:/data:ro -v "$PWD":/backup alpine \
  tar czf /backup/hub-data-backup.tgz -C /data .
```

إن فُقد `hub-data` لا تضيع المشاريع، لكن تحتاج إنشاء المفاتيح من جديد وتوزيعها.

### حل المشكلات

| العَرَض | السبب المرجّح | الحل |
|---|---|---|
| «النموذج غير جاهز» أو `defaultModelReady: false` | التنزيل الأول لم يكتمل، أو وسم النموذج خاطئ | انتظر وراقب `/health`. إن طال الأمر افتح سجلّ حاوية `ollama` و `hub` من تبويب Logs وتأكد من كتابة `AI_MODEL` ومن وجود مساحة على القرص |
| الحاوية تُعاد تشغيلها أو الإجابة تنقطع فجأة (نفاد الذاكرة) | النموذج أكبر من الذاكرة المتاحة | اختر نموذجًا أصغر في `AI_MODEL`، أو خفّض `AI_NUM_CTX` إلى 2048، ثم Deploy |
| خطأ 401 | المفتاح ناقص أو خاطئ أو ملغى، أو أُرسل دون `Bearer` | تأكد من الترويسة `Authorization: Bearer hub_...`. أنشئ مفتاحًا جديدًا إن لزم. تأكد أن `ADMIN_KEY` في Dokploy هو ما تكتبه بلا مسافات |
| خطأ 403 | مفتاح مشروع يحاول دخول لوحة الإدارة | استخدم مفتاح المدير |
| خطأ 429 | تجاوز حد الطلبات في الدقيقة | انتظر المدة المذكورة في `Retry-After`، أو ارفع `RATE_LIMIT_RPM` |
| إجابات بطيئة | طبيعي على المعالج؛ أو النموذج أُخرج من الذاكرة؛ أو الخادم مشغول | اطلب إجابات أقصر (`max_tokens`)، استخدم البث، ارفع `OLLAMA_KEEP_ALIVE`، أو اختر نموذجًا أصغر |
| خطأ 504 أو انقطاع من الوسيط (Traefik) | الطلب غير المبثوث تجاوز مهلة الوسيط قبل أن يردّ النموذج | استخدم `stream: true` ليصل الرد تباعًا، وقلّل `max_tokens`، أو اختر نموذجًا أصغر. رفع مهلة Traefik نفسها إعداد متقدّم لم أتحقق من خطواته في Dokploy |
| النطاق لا يفتح أو الشهادة لا تصدر | سجل DNS لم ينتشر، أو أُضيف النطاق دون إعادة نشر | تحقّق من سجل A في Namecheap، انتظر، ثم Deploy من جديد |
| الـworkflow لا يظهر في Actions | الملف غير موجود في الفرع الافتراضي | ادمج الفرع في `main` |
| TAGit يعيد `MODEL_UNAVAILABLE` أو `INSUFFICIENT_EVIDENCE` | النموذج غير جاهز أو لم يُخرج JSON صالحًا | تأكد من `/health` ثم أعد التشغيل. إن تكرر فجرّب `qwen2.5:7b` إن سمحت الذاكرة |

---

# Deploying AI Hub on Dokploy (English)

For the server owner. About half an hour, mostly waiting for the model download. UI labels are as documented by Dokploy (links below); placement can differ slightly between versions.

1. **Create the service.** If GitHub is not connected yet: **Git → GitHub → Create Github App → Install**, granting access to `tufeeq/ai`. Then **Create Project** (`ai-hub`) → **Create Service → Compose**, Compose Type **Docker Compose** (not Stack, which cannot `build`). In **General**: Provider GitHub, Repository `tufeeq/ai`, Branch `claude/ai-hub` (switch to `main` after the merge), Compose Path `./ai-hub/docker-compose.yml`. Save.
2. **Environment tab.** Paste `ADMIN_KEY`, `AI_MODEL=gemma3:4b`, `AI_NUM_CTX=4096`, `LLM_TIMEOUT_MS=180000`, `AUTO_PULL_MODEL=true`, `RATE_LIMIT_RPM=60`, `REF_PRICE_IN_PER_M=2.5`, `REF_PRICE_OUT_PER_M=10`. Generate the admin key yourself with `openssl rand -base64 32` and keep it in a password manager; never commit it. Left empty, the hub generates one and prints it once in the logs.
3. **Domain.** Namecheap → Domain List → Manage → Advanced DNS → Add New Record: type A, host `ai`, value = the VPS public IP. In Dokploy **Domains → Add Domain**: service `hub`, host `ai.tryn.cc`, path `/`, container port `8080`, HTTPS on, certificate `letsencrypt`. Compose services pick up domain changes only on the next deploy.
4. **Deploy** and wait for the first model download (1.9 GB by default, a few minutes, once). Watch `https://ai.tryn.cc/health` until `defaultModelReady` is `true`; the admin status card shows the same.
5. **Open `/admin`** with the admin key and create one key per project. Each key is shown once.
6. **Connect TAGit.** GitHub repo → Settings → Secrets and variables → Actions: variable `AI_HUB_URL` = `https://ai.tryn.cc`, secret `AI_HUB_KEY` = the `tagit` project key. Then Actions → **TAGit Self-Hosted AI Stock Analysis (no API cost)** → Run workflow. The workflow must exist on the default branch for the manual run button to appear.
7. **Connect other projects** with `OPENAI_BASE_URL=https://ai.tryn.cc/v1` and the project key as `OPENAI_API_KEY`. See [clients/MIGRATE.md](clients/MIGRATE.md).
8. **Operate.** Pushes to the configured branch deploy automatically when GitHub is connected through the Dokploy GitHub App. Back up the `hub-data` volume (key hashes, usage log); `ollama-models` can be re-downloaded.

**Model sizing (sizes from the Ollama library pages)**

| VPS RAM | Model | Download | Notes |
|---|---|---|---|
| 8 GB (lighter) | `qwen2.5:3b` | 1.9 GB | Arabic listed among its languages; Qwen research licence, not Apache 2.0, so not the default |
| 8 GB | `gemma3:4b` (default) | 3.4 GB | 140+ languages per its page; Gemma terms of use (review for your project); tight if other apps share the server |
| 16 GB | `qwen2.5:7b` | 4.7 GB | Best balance; Apache 2.0 |
| 24 GB+ | `qwen2.5:14b` / `gemma3:12b` | 9.0 GB / 8.2 GB | Better quality, slow on CPU; batch jobs only |

`llama3.2:3b` (2.0 GB) does not list Arabic among its officially supported languages. Newer families such as Qwen 3 exist, but their Ollama pages could not be opened for verification, so no tags are given here.

**Speed on CPU only** — rough expectations, not measurements on this server: 3B–4B about 5–12 tokens/s, 7B about 2–5, 12B–14B about 1–2. One request runs at a time and the first request after idle is slower.

**Troubleshooting**

| Symptom | Fix |
|---|---|
| Model not ready | Wait; watch `/health`; check the `ollama` and `hub` logs, the `AI_MODEL` spelling and free disk space |
| Out of memory, container restarts | Use a smaller model or lower `AI_NUM_CTX` to 2048, redeploy |
| 401 | Send `Authorization: Bearer hub_...`; the key may be wrong or revoked |
| 429 | Wait for `Retry-After` or raise `RATE_LIMIT_RPM` |
| Slow answers | Lower `max_tokens`, use streaming, raise `OLLAMA_KEEP_ALIVE`, or use a smaller model |
| 504 at the proxy | Use `stream: true`, shorten the answer, or use a smaller model. Raising Traefik's own timeout in Dokploy was not verified for this guide |
| Domain or certificate not working | Check the A record, wait for DNS, redeploy |

---

## المراجع التي جرى التحقق منها · Verified references

Dokploy

- Docker Compose (النوع، Environment، المجلّدات): https://docs.dokploy.com/docs/core/docker-compose
- مثال Compose (Provider / Repository / Branch / Compose Path): https://docs.dokploy.com/docs/core/docker-compose/example
- نطاقات خدمات Compose: https://docs.dokploy.com/docs/core/docker-compose/domains
- حقول النطاق وإعادة النشر في Compose: https://docs.dokploy.com/docs/core/domains
- النشر التلقائي: https://docs.dokploy.com/docs/core/auto-deploy
- ربط GitHub: https://docs.dokploy.com/docs/core/github

Ollama

- qwen2.5 (الوسوم والأحجام والتراخيص): https://registry.ollama.ai/library/qwen2.5
- qwen2.5:3b: https://registry.ollama.ai/library/qwen2.5:3b
- gemma3: https://registry.ollama.ai/library/gemma3
- llama3.2: https://registry.ollama.ai/library/llama3.2

Namecheap

- إضافة سجلات DNS: https://www.namecheap.com/support/knowledgebase/article.aspx/434/2237/how-do-i-set-up-host-records-for-a-domain

**ما لم يمكن التحقق منه · Not verified**

- اسم حقل «Service Name» في نموذج إضافة النطاق لخدمات Compose: الوثائق تذكر Host و Path و Container Port و HTTPS و Certificate، ولم يرد فيها اسم حقل اختيار الخدمة نصًا. اختر الخدمة `hub` أيًّا كان اسم الحقل.
- وسوم وأحجام العائلات الأحدث (مثل Qwen 3) في مكتبة Ollama.
- أرقام السرعة: تقديرات عامة لا قياسات على خادم Contabo هذا.
- طريقة رفع مهلة Traefik داخل Dokploy.
