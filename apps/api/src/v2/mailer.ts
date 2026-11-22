import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

/** A single bare address: no display name, quotes, angle brackets, commas, spaces or line breaks. */
const SAFE_ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export interface MailMessage { to: string; subject: string; text: string }
export type MailResult = { ok: true; messageId: string } | { ok: false; error: string };

/** Outgoing mail. `transport` is what a message will really do: 'smtp' delivers it, 'outbox' only stores it. */
export interface Mailer {
  transport: 'smtp' | 'outbox';
  from: string;
  /** Maximum messages sent per minute; the caller spaces sends accordingly. */
  perMinute: number;
  send(msg: MailMessage): Promise<MailResult>;
}

/** Builds a mailer from SMTP_* environment variables. Without SMTP_HOST nothing is ever sent. */
export function createMailerFromEnv(env: NodeJS.ProcessEnv = process.env): Mailer {
  const perMinute = Math.max(1, Number(env.MAIL_RATE_PER_MINUTE ?? 30) || 30);
  if (!env.SMTP_HOST) {
    return { transport: 'outbox', from: '', perMinute, send: async () => ({ ok: false, error: 'No mail server is configured.' }) };
  }
  const port = Number(env.SMTP_PORT ?? 587);
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST, port, secure: port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } : undefined,
  });
  return fromTransporter(transporter, env.MAIL_FROM || env.SMTP_USER || 'placements@localhost', perMinute);
}

/** Wraps any nodemailer transporter. Used by createMailerFromEnv and by tests (with an in-memory transport). */
export function fromTransporter(transporter: Transporter, from: string, perMinute = 30): Mailer {
  return {
    transport: 'smtp', from, perMinute,
    async send(msg) {
      // One plain address and a one-line subject. Blocks header and SMTP command injection (nodemailer advisories on crafted
      // addresses and unsanitised envelope values) whatever the caller passes.
      const to = String(msg.to ?? '').trim();
      if (!SAFE_ADDRESS.test(to)) return { ok: false, error: 'Invalid recipient address.' };
      msg = { ...msg, to, subject: String(msg.subject ?? '').replace(/[\r\n]+/g, ' ').slice(0, 300) };
      try {
        const info = await transporter.sendMail({ from, to: msg.to, subject: msg.subject, text: msg.text });
        const rejected = (info.rejected ?? []) as unknown[];
        if (rejected.length > 0) return { ok: false, error: `Recipient rejected: ${rejected.join(', ')}` };
        return { ok: true, messageId: String(info.messageId ?? '') };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : 'Send failed.' };
      }
    },
  };
}
