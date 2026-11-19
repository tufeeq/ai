// Runtime configuration, read once from the environment.
const int = (name, fallback) => {
  const raw = process.env[name];
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const bool = (name, fallback) => {
  const raw = (process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
};

export const config = Object.freeze({
  port: int('PORT', 8080),
  dataDir: process.env.DATA_DIR || './data',
  adminKey: (process.env.ADMIN_KEY || '').trim(),
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),

  smtp: Object.freeze({
    host: process.env.SMTP_HOST || 'localhost',
    port: int('SMTP_PORT', 587),
    // 465 = implicit TLS; 587 = STARTTLS (required, never plain text).
    secure: int('SMTP_PORT', 587) === 465,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    // Leave true in production. Only for a first boot before the certificate exists.
    verifyTls: bool('SMTP_VERIFY_TLS', true),
  }),

  defaultFromEmail: process.env.DEFAULT_FROM_EMAIL || process.env.SMTP_USER || '',
  defaultFromName: process.env.DEFAULT_FROM_NAME || 'No Reply',

  // Password reset policy
  resetTtlMinutes: int('RESET_TTL_MINUTES', 30),
  resetMaxPerEmailWindow: int('RESET_MAX_PER_EMAIL', 3),
  resetWindowMinutes: int('RESET_WINDOW_MINUTES', 15),

  // Per-project request limits (all endpoints)
  projectRpm: int('PROJECT_RPM', 60),
  // Generic /v1/send limit per project per hour (stops a leaked key turning into a spam cannon)
  sendPerHour: int('SEND_PER_HOUR', 300),

  maxBodyBytes: int('MAX_BODY_BYTES', 64 * 1024),
  trustProxy: bool('TRUST_PROXY', true),
});
