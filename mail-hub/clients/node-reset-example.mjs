// Minimal integration for a Node project (Node 18+, no dependencies).
// Env: MAIL_HUB_URL=https://mailer.tryn.cc  MAIL_HUB_KEY=mh_<project>_...
const BASE = process.env.MAIL_HUB_URL;
const KEY = process.env.MAIL_HUB_KEY;

async function call(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

// 1) "Forgot password" form handler. Always answer the visitor with the same neutral message.
export async function forgotPassword(email, findUserByEmail) {
  const user = await findUserByEmail(email);
  if (user) await call('/v1/password-reset', { email: user.email, user_id: String(user.id), name: user.name, locale: user.locale || 'ar' });
  return 'إن كان البريد مسجّلًا لدينا فستصلك رسالة خلال دقائق.';
}

// 2) Reset page opened from the email (…/reset?token=…): check the link before showing the form.
export async function checkResetLink(token) {
  const { status, data } = await call('/v1/password-reset/verify', { token });
  return status === 200 ? data : null; // { email, user_id, expires_at } or null = expired/used
}

// 3) New password submitted: consume the token (single use), then save the password yourself.
export async function completeReset(token, newPassword, setPassword) {
  const { status, data } = await call('/v1/password-reset/consume', { token });
  if (status !== 200) return false; // expired, already used or forged
  await setPassword(data.user_id, newPassword); // hash it (argon2/bcrypt) and sign out other sessions
  await call('/v1/notify/password-changed', { email: data.email });
  return true;
}

// Any other one-to-one transactional email (welcome, receipt, verification code…)
export async function sendEmail(to, subject, html, text) {
  return call('/v1/send', { to, subject, html, text });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const email = process.argv[2];
  if (!BASE || !KEY || !email) { console.error('usage: MAIL_HUB_URL=… MAIL_HUB_KEY=… node node-reset-example.mjs you@example.com'); process.exit(1); }
  console.log(await call('/v1/password-reset', { email, locale: 'ar' }));
}
