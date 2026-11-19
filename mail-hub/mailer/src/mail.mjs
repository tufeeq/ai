// SMTP transport to the self-hosted Stalwart server (submission port, authenticated, TLS required).
import nodemailer from 'nodemailer';

export function createMailer(smtp) {
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS: !smtp.secure, // STARTTLS is mandatory on 587: never send credentials in clear
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    pool: true,
    maxConnections: 3,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    tls: { rejectUnauthorized: smtp.verifyTls, minVersion: 'TLSv1.2' },
  });

  return {
    async send({ from, to, replyTo, subject, html, text, headers }) {
      const info = await transport.sendMail({ from, to, replyTo, subject, html, text, headers });
      return { messageId: info.messageId, accepted: info.accepted?.length ?? 0 };
    },
    async verify() {
      try { await transport.verify(); return { ok: true }; } catch (e) { return { ok: false, error: e.code || e.message }; }
    },
    close() { transport.close(); },
  };
}
