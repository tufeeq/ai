# نشر مركز البريد على Dokploy

الترتيب مهم: الشهادة تُصدر أولًا من Traefik، ثم يقرؤها Stalwart. الأمثلة بالنطاق `tryn.cc`؛ استبدله إن أردت نطاقًا آخر، ويمكن إضافة نطاقات مشاريعك لاحقًا من لوحة Stalwart.

## 1. قبل النشر (مرة واحدة)

**أ. سجل PTR في Contabo** — أهم خطوة لوصول الرسائل إلى الوارد لا المزعج.
لوحة Contabo ← Reverse DNS Management ← عنوان IPv4 للخادم ← `mail.tryn.cc`.

**ب. تأكد أن منفذ 25 مفتوح للخارج.** من Dokploy افتح Terminal على أي حاوية ونفّذ:
```
timeout 5 sh -c 'exec 3<>/dev/tcp/gmail-smtp-in.l.google.com/25' && echo OPEN || echo BLOCKED
```
إن ظهر BLOCKED فاطلب من دعم Contabo فتحه (أو نقلك إلى IP نظيف).

**ج. افحص سمعة عنوان الخادم** في https://mxtoolbox.com/blacklists.aspx — إن كان مدرجًا في Spamhaus فاطلب من Contabo عنوانًا آخر قبل البدء.

**د. سجلات DNS في Namecheap** (Advanced DNS لنطاق tryn.cc):

| النوع | المضيف | القيمة | ملاحظة |
|---|---|---|---|
| A | `mail` | عنوان IPv4 للخادم | السجل الشامل `*` يغطيه، لكن سجلًا صريحًا أوضح |
| MX | `@` | `mail.tryn.cc` أولوية 10 | من قسم Mail Settings اختر Custom MX |
| TXT | `@` | `v=spf1 mx -all` | |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:postmaster@tryn.cc` | بعد أسبوعين بلا مشاكل غيّر `p=none` إلى `p=quarantine` |
| TXT | (DKIM) | من لوحة Stalwart بعد الخطوة 4 | |

## 2. إنشاء الخدمة في Dokploy

1. مشروع جديد `mail-hub` ← Create Service ← **Compose** (النوع Docker Compose).
2. المصدر: GitHub، المستودع `tufeeq/ai`، الفرع `main`، مسار الملف `mail-hub/docker-compose.yml`.
3. **Watch Paths:** `mail-hub/**` حتى لا يُعاد النشر مع كل تحديث بيانات آلي في المستودع.
4. **Environment:** الصق محتوى `.env.example` واملأ:
   - اترك `MAILER_SMTP_PASS` فارغًا الآن، ويُملأ في الخطوة 5.
   - ضع مؤقتًا `STALWART_SETUP_BIND=0.0.0.0:18080` لمعالج الإعداد.
5. **Domains** (كلها HTTPS مع Let's Encrypt):

| المضيف | الخدمة | المنفذ |
|---|---|---|
| `mail.tryn.cc` | `stalwart` | 8080 |
| `webmail.tryn.cc` | `webmail` | 80 |
| `lists.tryn.cc` | `lists` | 9000 |
| `mailer.tryn.cc` | `mailer` | 8080 |

6. **Deploy.**

## 3. معالج إعداد Stalwart (مرة واحدة)

1. من Logs لخدمة `stalwart` ابحث عن `bootstrap mode` وانسخ كلمة المرور المؤقتة.
2. افتح `http://<IP الخادم>:18080/admin` وادخل باسم `admin`.
3. الشاشة الأولى: اسم الخادم `mail.tryn.cc`، النطاق `tryn.cc`. **أوقف ACME** (الشهادة تأتي من Traefik)، وأبقِ توليد DKIM مفعّلًا.
4. التخزين: الافتراضي (RocksDB). الدليل: الداخلي. السجلات: **Console** بلا ألوان. DNS: يدوي.
5. احفظ كلمة مرور `admin@tryn.cc` التي تظهر مرة واحدة في مدير كلمات المرور.
6. في Dokploy أعد `STALWART_SETUP_BIND=127.0.0.1:18080` ثم Deploy، فيُغلق المنفذ 18080 للعموم.

## 4. ضبط Stalwart من `https://mail.tryn.cc/admin`

1. **الشهادة:** Certificates ← إضافة من نوع File:
   `/data/certs/mail.tryn.cc/cert.pem` و`/data/certs/mail.tryn.cc/key.pem`، واجعلها الشهادة الافتراضية.
2. **عنوان الزائر الحقيقي:** إعدادات HTTP ← مصدر عنوان العميل `X-Forwarded-For` بعدد قفزات 1.
3. **قائمة السماح:** Security ← IP Allowlist ← أضف `10.0.0.0/8` و`172.16.0.0/12` (شبكات Docker) حتى لا يحظر Stalwart خادم Traefik بالخطأ.
4. **سجلات DNS:** من صفحة النطاق `tryn.cc` انسخ سجل DKIM (وأي سجل ناقص) إلى Namecheap.
5. **الحسابات:** أنشئ:
   - `no-reply@tryn.cc` لخدمة إعادة التعيين.
   - `news@tryn.cc` للحملات التسويقية.
   - صناديقك الشخصية (مثل `tufeeq@tryn.cc`).

## 5. ربط الخدمات

**خدمة إعادة التعيين:** في Dokploy ضع كلمة مرور `no-reply@tryn.cc` في `MAILER_SMTP_PASS` ثم Deploy. مفتاح الإدارة يظهر مرة واحدة في Logs لخدمة `mailer` بعد `ADMIN KEY (save it):` (أو `cat /data/admin.key` من Terminal الحاوية). افتح `https://mailer.tryn.cc/admin`، ادخل به، وأنشئ مشروعًا لكل تطبيق؛ المفتاح يظهر مرة واحدة ويوضع في التطبيق باسم `MAIL_HUB_KEY` مع `MAIL_HUB_URL=https://mailer.tryn.cc`.

**listmonk:** افتح `https://lists.tryn.cc` فورًا وأنشئ حساب المدير، ثم:
- Settings ← SMTP: المضيف `mail.tryn.cc`، المنفذ 587، TLS: STARTTLS، المستخدم `news@tryn.cc`.
- Settings ← General: Root URL `https://lists.tryn.cc`، والمرسل الافتراضي `اسمك <news@tryn.cc>`.
- Settings ← Performance: ابدأ بـ 2 رسالة في الثانية وسقف ساعة منخفض (انظر «التسخين» أدناه).

**البريد عبر المتصفح:** `https://webmail.tryn.cc` بالبريد الكامل وكلمة مروره. للجوال: IMAP `mail.tryn.cc:993` SSL، وSMTP `mail.tryn.cc:465` SSL.

## 6. تجديد الشهادة

Traefik يجدّد الشهادة تلقائيًا كل نحو 60 يومًا، والحاوية `certs` تنسخها فورًا، لكن Stalwart يقرؤها عند التشغيل فقط. أضف في Dokploy ← Schedules للخدمة `stalwart` مهمة أسبوعية (مثلًا الأحد 4:10 فجرًا، `10 4 * * 0`) بالأمر `kill 1`؛ تُعيد الحاوية التشغيل خلال ثوانٍ، والرسائل الواردة أثناءها يعيد مرسلها المحاولة تلقائيًا. بديل يدوي: زر إعادة تحميل الشهادات في لوحة Stalwart.

## 7. التحقق

- https://www.mail-tester.com — أرسل إليه رسالة من webmail، والهدف 9/10 فأعلى.
- https://mxtoolbox.com/SuperTool.aspx — افحص MX وSPF وDMARC وPTR.
- `https://mailer.tryn.cc/admin` — بطاقة «حالة الاتصال بخادم البريد» يجب أن تكون «متصل».

## تسخين عنوان الخادم للبريد التسويقي

عنوان IP جديد بلا سمعة؛ الإرسال الكثيف من اليوم الأول يذهب إلى المزعج أو يُحظر. ابدأ بنحو 50 رسالة يوميًا لمن اشتركوا فعلًا، وضاعف كل يومين إلى ثلاثة ما دامت نسبة الشكاوى منخفضة. Gmail وYahoo يشترطان لمن يرسل أكثر من 5000 رسالة يوميًا: SPF وDKIM وDMARC، وإلغاء اشتراك بنقرة واحدة (listmonk يضيفه تلقائيًا)، ونسبة إبلاغ عن الإزعاج أقل من 0.3%. رسائل إعادة التعيين قليلة وتصل جيدًا منذ البداية متى ضُبطت السجلات.

## حلّ المشكلات

| العرض | السبب والحل |
|---|---|
| لوحة Stalwart: 502 | حظر Stalwart عنوان Traefik؛ أزله من Blocked IPs وأكمل الخطوة 4-3 |
| `mailer`: SMTP not ready / CERT | الشهادة لم تُحمَّل بعد في Stalwart (الخطوة 4-1)، أو `MAILER_SMTP_PASS` خاطئة |
| لا يوجد `/data/certs/mail.tryn.cc` | Traefik لم يُصدر الشهادة بعد: تأكد من نطاق `mail.tryn.cc` في Domains ومن DNS |
| الرسائل تصل إلى المزعج | PTR غير مضبوط، أو DKIM ناقص، أو العنوان مدرج في قائمة سوداء |
| لا تصل الرسائل للخارج أبدًا | منفذ 25 مغلق (الخطوة 1-ب) |
