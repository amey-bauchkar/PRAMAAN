import { describe, it, expect, beforeAll } from 'vitest';
import { createDemoApp, DemoApp } from '../src/v2/demo.js';

let demo: DemoApp; let token: string;
const call = async (method: 'GET' | 'POST', url: string) => {
  const res = await demo.app.inject({ method, url, headers: { authorization: `Bearer ${token}` } });
  return { status: res.statusCode, body: JSON.parse(res.payload) };
};

describe('Replay this decision', () => {
  beforeAll(async () => { demo = await createDemoApp(); token = await demo.tokenFor('rahul'); }, 300_000);

  it('reproduces every published decision from its saved inputs and rule version', async () => {
    const drives = (await call('GET', '/api/v2/student/drives')).body.drives.filter((d: any) => d.decision);
    expect(drives.length).toBeGreaterThan(3);
    for (const d of drives) {
      const r = (await call('POST', `/api/v2/student/decisions/${d.decision.id}/replay`)).body;
      expect(r.reproduced, d.title).toBe(true);
    }
  });

  it('detects a stored decision whose saved inputs were altered afterwards', async () => {
    const drives = (await call('GET', '/api/v2/student/drives')).body.drives.filter((d: any) => d.decision);
    const id = drives[0].decision.id;
    await demo.db.admin.query(`UPDATE eligibility_decisions SET input_snapshot = jsonb_set(input_snapshot, '{cgpa}', '9.9') WHERE id = $1`, [id]);
    const r = (await call('POST', `/api/v2/student/decisions/${id}/replay`)).body;
    expect(r.reproduced).toBe(false);
    expect(r.sameInputs).toBe(false);
    expect((await call('POST', '/api/v2/student/decisions/00000000-0000-4000-8000-000000000000/replay')).status).toBe(404);
  });
});
