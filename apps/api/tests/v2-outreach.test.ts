import { describe, it, expect, beforeAll } from 'vitest';
import nodemailer from 'nodemailer';
import { createDemoApp, DemoApp } from '../src/v2/demo.js';
import { fromTransporter } from '../src/v2/mailer.js';

/** Bulk mail: a message is 'sent' only when the mail transport accepted it, and the per-minute limit holds. */
let demo: DemoApp;
let token: string;
const delivered: { to: string; subject: string }[] = [];

async function call(method: 'GET' | 'POST', url: string, body?: unknown) {
  const res = await demo.app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload: body as any });
  return { status: res.statusCode, body: res.payload ? JSON.parse(res.payload) : null };
}

describe('Bulk mailing (AD-05)', () => {
  beforeAll(async () => {
    // A real nodemailer transport that records instead of opening a network connection; one address is rejected.
    const transporter = nodemailer.createTransport({ jsonTransport: true });
    const base = transporter.sendMail.bind(transporter);
    (transporter as any).sendMail = async (m: any) => {
      if (String(m.to).startsWith('bounce')) throw new Error('550 mailbox unavailable');
      delivered.push({ to: m.to, subject: m.subject });
      return base(m);
    };
    demo = await createDemoApp({ mailer: fromTransporter(transporter, 'placements@sahyadri.invalid', 3) });
    token = await demo.tokenFor('tpo');
  }, 300_000);

  it('sends at most the per-minute limit, marks sent only after acceptance, and leaves the rest waiting', async () => {
    const before = await call('GET', '/api/v2/tpo/outreach');
    expect(before.body.transport).toBe('smtp');
    const t = before.body.templates[0];
    const r = await call('POST', '/api/v2/tpo/outreach/send', { templateId: t.id });
    expect(r.status).toBe(200);
    expect(r.body.sent).toBe(3);
    expect(r.body.remaining).toBe(r.body.recipients - 3);
    expect(delivered).toHaveLength(3);
    const list = (await call('GET', '/api/v2/tpo/outreach')).body.messages;
    expect(list.filter((m: any) => m.status === 'sent')).toHaveLength(3);
    expect(list.filter((m: any) => m.status === 'queued').length).toBe(r.body.recipients - 3);
    const d = await call('POST', '/api/v2/tpo/outreach/dispatch');
    expect(d.body.sent).toBe(3);
  });
});

describe('Bulk mailing without a mail server', () => {
  it('saves messages in the outbox and never reports them as sent', async () => {
    const d2 = await createDemoApp();
    const tk = await d2.tokenFor('tpo');
    const get = async (url: string, method: 'GET' | 'POST' = 'GET', body?: unknown) => {
      const res = await d2.app.inject({ method, url, headers: { authorization: `Bearer ${tk}` }, payload: body as any });
      return JSON.parse(res.payload);
    };
    const o = await get('/api/v2/tpo/outreach');
    expect(o.transport).toBe('outbox');
    const r = await get('/api/v2/tpo/outreach/send', 'POST', { templateId: o.templates[0].id });
    expect(r.sent).toBe(0);
    expect(r.note).toMatch(/NOT been sent/);
    const after = await get('/api/v2/tpo/outreach');
    expect(after.messages.every((m: any) => m.status === 'queued' && m.sentAt === null)).toBe(true);
  }, 300_000);
});
