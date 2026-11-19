// Mail Hub — mailer service entry point.
import http from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from './src/config.mjs';
import { openStore } from './src/store.mjs';
import { createMailer } from './src/mail.mjs';
import { createApp } from './src/app.mjs';

function resolveAdminKey() {
  if (config.adminKey) return config.adminKey;
  const file = join(config.dataDir, 'admin.key');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const key = `mha_${randomBytes(24).toString('hex')}`;
  writeFileSync(file, `${key}\n`, { mode: 0o600 });
  // Printed once, on the very first boot only. Copy it into your password manager.
  console.log(`ADMIN KEY (save it): ${key}`);
  return key;
}

const store = openStore(config.dataDir);
const adminKey = resolveAdminKey();
const mailer = createMailer(config.smtp);
const app = createApp({ config, store, mailer, adminKey });

store.housekeeping();
setInterval(() => store.housekeeping(), 6 * 3600 * 1000).unref();

const server = http.createServer(app);
server.requestTimeout = 60_000;
server.headersTimeout = 20_000;
server.listen(config.port, () => {
  console.log(`[mailer] listening on :${config.port} — SMTP ${config.smtp.host}:${config.smtp.port} as ${config.smtp.user || '(no auth)'}`);
  mailer.verify().then((r) => console.log(r.ok ? '[mailer] SMTP connection OK' : `[mailer] SMTP not ready yet: ${r.error}`));
});

const stop = () => { server.close(); mailer.close(); store.close(); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
