import { describe, it, expect, beforeAll } from 'vitest';
import { createDemoApp, DemoApp } from '../src/v2/demo.js';

let demo: DemoApp;
const tokens: Record<string, string> = {};
const call = async (who: string, method: 'GET' | 'POST', url: string, body?: unknown) => {
  const res = await demo.app.inject({ method, url, headers: { authorization: `Bearer ${tokens[who]}` }, payload: body as any });
  return { status: res.statusCode, body: res.payload ? JSON.parse(res.payload) : null };
};

describe('Audit log (BR-16)', () => {
  beforeAll(async () => { demo = await createDemoApp(); for (const p of ['rahul', 'tpo']) tokens[p] = await demo.tokenFor(p); }, 300_000);

  it('records student actions that change data and the chain verifies', async () => {
    const before = (await call('tpo', 'GET', '/api/v2/tpo/audit/verify')).body;
    expect(before.valid).toBe(true);
    const hits = (await call('rahul', 'GET', '/api/v2/catalog/skills?q=docker')).body;
    expect((await call('rahul', 'POST', '/api/v2/student/skills/claim', { skillSlug: hits[0].slug })).status).toBe(200);
    const after = (await call('tpo', 'GET', '/api/v2/tpo/audit/verify')).body;
    expect(after.valid).toBe(true);
    expect(after.events).toBe(before.events + 1);
    const log = (await call('tpo', 'GET', '/api/v2/tpo/audit')).body;
    expect(log[0].action).toBe('SKILL_CLAIMED');
    expect((await call('rahul', 'GET', '/api/v2/tpo/audit/verify')).status).toBe(403);
  });
});
