import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

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
