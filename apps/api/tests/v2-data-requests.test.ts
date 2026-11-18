import { describe, it, expect, beforeAll } from 'vitest';
import { createDemoApp, DemoApp } from '../src/v2/demo.js';

let demo: DemoApp;
const tokens: Record<string, string> = {};
const call = async (who: string, method: 'GET' | 'POST', url: string, body?: unknown) => {
  const res = await demo.app.inject({ method, url, headers: { authorization: `Bearer ${tokens[who]}` }, payload: body as any });
  return { status: res.statusCode, body: res.payload ? JSON.parse(res.payload) : null };
};

describe('Student data requests (DPDP rights)', () => {
  beforeAll(async () => { demo = await createDemoApp(); for (const p of ['minor', 'tpo', 'tpo-poly']) tokens[p] = await demo.tokenFor(p); }, 300_000);

  it('an erasure request is answered by the placement office and removes personal data', async () => {
    const made = await call('minor', 'POST', '/api/v2/student/data-requests', { type: 'erasure' });
    expect(made.status).toBe(200);
    const id = made.body.id;

    const seen = async (o: string) => (await call(o, 'GET', '/api/v2/tpo/data-requests')).body.find((x: any) => x.id === id);
    const officer = (await seen('tpo')) ? 'tpo' : 'tpo-poly';
    const other = officer === 'tpo' ? 'tpo-poly' : 'tpo';

    // The other college cannot see or close it.
    expect(await seen(other)).toBeUndefined();
    expect((await call(other, 'POST', `/api/v2/tpo/data-requests/${id}/decide`, { action: 'complete', note: 'trying from another college' })).status).toBe(404);

    const row = await seen(officer);
    expect(row.status).toBe('pending');
    expect((await call(officer, 'POST', `/api/v2/tpo/data-requests/${id}/decide`, { action: 'complete', note: 'ok' })).status).toBe(400);
    const done = await call(officer, 'POST', `/api/v2/tpo/data-requests/${id}/decide`, { action: 'complete', note: 'Personal data deleted as requested.' });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('completed');

    const erased = (await demo.db.admin.query<any>(`SELECT u.full_name, s.erased_at FROM students s JOIN users u ON u.id = s.user_id WHERE u.auth_subject LIKE 'erased|%'`)).rows;
    expect(erased).toHaveLength(1);
    expect(erased[0].full_name).toBe('Erased student');
    expect(erased[0].erased_at).not.toBeNull();

    expect((await call(officer, 'POST', `/api/v2/tpo/data-requests/${id}/decide`, { action: 'reject', note: 'again please' })).status).toBe(409);
    // The old identity no longer maps to a student.
    expect((await call('minor', 'GET', '/api/v2/student/profile')).status).toBeGreaterThanOrEqual(400);
  });
});
