// Email templates (Arabic RTL and English). Table layout + inline styles so they render in Gmail/Outlook.
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const STRINGS = {
  ar: {
    dir: 'rtl', align: 'right', font: "Tahoma, 'Segoe UI', Arial, sans-serif",
    resetSubject: (p) => `إعادة تعيين كلمة المرور — ${p}`,
    resetPreheader: 'رابط آمن لإعادة تعيين كلمة المرور، صالح لمدة محدودة.',
    hello: (n) => (n ? `مرحبًا ${n}،` : 'مرحبًا،'),
    resetIntro: (p) => `تلقّينا طلبًا لإعادة تعيين كلمة المرور لحسابك في ${p}.`,
    resetButton: 'تعيين كلمة مرور جديدة',
    resetExpiry: (m) => `الرابط صالح لمدة ${m} دقيقة، ويُستخدم مرة واحدة فقط.`,
    resetIgnore: 'إن لم تطلب ذلك فتجاهل هذه الرسالة؛ كلمة مرورك الحالية لن تتغير.',
    resetFallback: 'إن لم يعمل الزر، انسخ هذا الرابط في المتصفح:',
    changedSubject: (p) => `تم تغيير كلمة المرور — ${p}`,
    changedPreheader: 'تأكيد تغيير كلمة المرور لحسابك.',
    changedBody: (p) => `تم تغيير كلمة المرور لحسابك في ${p} بنجاح.`,
    changedWarn: 'إن لم تكن أنت من غيّرها، فأعد تعيين كلمة المرور فورًا وتواصل مع الدعم.',
    footer: (p) => `أُرسلت هذه الرسالة تلقائيًا من ${p}. لا ترسل كلمة مرورك لأي أحد، ولن نطلبها منك أبدًا.`,
  },
  en: {
    dir: 'ltr', align: 'left', font: "'Segoe UI', Helvetica, Arial, sans-serif",
    resetSubject: (p) => `Reset your password — ${p}`,
    resetPreheader: 'A secure, time-limited link to reset your password.',
    hello: (n) => (n ? `Hello ${n},` : 'Hello,'),
    resetIntro: (p) => `We received a request to reset the password for your ${p} account.`,
    resetButton: 'Set a new password',
    resetExpiry: (m) => `This link expires in ${m} minutes and can be used once.`,
    resetIgnore: "If you didn't ask for this, ignore this email — your current password stays the same.",
    resetFallback: "If the button doesn't work, paste this link into your browser:",
    changedSubject: (p) => `Your password was changed — ${p}`,
    changedPreheader: 'Confirmation that your password was changed.',
    changedBody: (p) => `The password for your ${p} account was changed successfully.`,
    changedWarn: "If this wasn't you, reset your password right away and contact support.",
    footer: (p) => `This message was sent automatically by ${p}. Never share your password; we will never ask for it.`,
  },
};

export const pickLocale = (l) => (String(l || '').toLowerCase().startsWith('en') ? 'en' : 'ar');

function layout({ t, project, color, preheader, bodyHtml }) {
  const name = escapeHtml(project);
  return `<!doctype html>
<html lang="${t === STRINGS.ar ? 'ar' : 'en'}" dir="${t.dir}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${name}</title></head>
<body style="margin:0;padding:0;background:#EEF0F7;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF0F7;padding:32px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:14px;overflow:hidden;font-family:${t.font};direction:${t.dir};text-align:${t.align};">
    <tr><td style="background:${color};padding:22px 28px;color:#FFFFFF;font-size:20px;font-weight:700;">${name}</td></tr>
    <tr><td style="padding:28px;color:#1F2433;font-size:16px;line-height:1.75;">${bodyHtml}</td></tr>
    <tr><td style="padding:18px 28px;background:#F6F7FB;color:#6B7183;font-size:12px;line-height:1.6;">${escapeHtml(t.footer(project))}</td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

export function resetEmail({ locale, project, color, link, ttlMinutes, name }) {
  const t = STRINGS[pickLocale(locale)];
  const safeLink = escapeHtml(link);
  const bodyHtml = `
    <p style="margin:0 0 12px;">${escapeHtml(t.hello(name))}</p>
    <p style="margin:0 0 22px;">${escapeHtml(t.resetIntro(project))}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px;"><tr>
      <td style="background:${color};border-radius:10px;">
        <a href="${safeLink}" style="display:inline-block;padding:14px 26px;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:16px;">${escapeHtml(t.resetButton)}</a>
      </td></tr></table>
    <p style="margin:0 0 8px;color:#4A5064;font-size:14px;">${escapeHtml(t.resetExpiry(ttlMinutes))}</p>
    <p style="margin:0 0 20px;color:#4A5064;font-size:14px;">${escapeHtml(t.resetIgnore)}</p>
    <p style="margin:0 0 6px;color:#6B7183;font-size:12px;">${escapeHtml(t.resetFallback)}</p>
    <p style="margin:0;font-size:12px;word-break:break-all;direction:ltr;text-align:left;"><a href="${safeLink}" style="color:${color};">${safeLink}</a></p>`;
  const text = [t.hello(name), '', t.resetIntro(project), '', `${t.resetButton}:`, link, '',
    t.resetExpiry(ttlMinutes), t.resetIgnore, '', t.footer(project)].join('\n');
  return { subject: t.resetSubject(project), html: layout({ t, project, color, preheader: t.resetPreheader, bodyHtml }), text };
}

export function passwordChangedEmail({ locale, project, color, name }) {
  const t = STRINGS[pickLocale(locale)];
  const bodyHtml = `
    <p style="margin:0 0 12px;">${escapeHtml(t.hello(name))}</p>
    <p style="margin:0 0 16px;">${escapeHtml(t.changedBody(project))}</p>
    <p style="margin:0;padding:12px 14px;background:#FFF4F0;border-radius:8px;color:#9A3412;font-size:14px;">${escapeHtml(t.changedWarn)}</p>`;
  const text = [t.hello(name), '', t.changedBody(project), t.changedWarn, '', t.footer(project)].join('\n');
  return { subject: t.changedSubject(project), html: layout({ t, project, color, preheader: t.changedPreheader, bodyHtml }), text };
}
