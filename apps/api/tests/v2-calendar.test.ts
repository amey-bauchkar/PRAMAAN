import { describe, it, expect, beforeAll } from 'vitest';
import { createDemoApp, DemoApp } from '../src/v2/demo.js';

/** Drives, interview slots and clash refusal (AD-06, BR-09): the database refuses double-booked panels and students. */
let demo: DemoApp;
let token: string;
async function call(method: 'GET' | 'POST', url: string, body?: unknown) {
  const res = await demo.app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload: body as any });
  return { status: res.statusCode, body: res.payload ? JSON.parse(res.payload) : null };
}

describe('Drive creation and interview slots', () => {
  beforeAll(async () => { demo = await createDemoApp(); token = await demo.tokenFor('tpo'); }, 300_000);

  it('creates a company and a draft drive', async () => {
    const c = await call('POST', '/api/v2/tpo/companies', { name: 'Test Works Pvt Ltd', industry: 'Engineering', contactEmail: 'hr@testworks.invalid' });
    expect(c.status).toBe(200);
    const d = await call('POST', '/api/v2/tpo/drives', { companyId: c.body.id, title: 'Graduate Engineer Trainee', startsAt: '2026-12-20T04:00:00Z', endsAt: '2026-12-20T12:00:00Z', ctcInr: 450000 });
    expect(d.status).toBe(200);
    const list = (await call('GET', '/api/v2/tpo/drives')).body;
    expect(list.drives.find((x: any) => x.id === d.body.id).status).toBe('draft');
    expect((await call('POST', '/api/v2/tpo/drives', { companyId: c.body.id, title: 'X', startsAt: '2026-12-20T04:00:00Z', endsAt: '2026-12-19T04:00:00Z' })).status).toBe(400);
  });

  it('books consecutive slots and refuses a second booking of the same panel or student', async () => {
    const list = (await call('GET', '/api/v2/tpo/drives')).body;
    let driveId = '', apps: any[] = [];
    for (const d of list.drives) {
      const a = (await call('GET', `/api/v2/tpo/applications?driveId=${d.id}`)).body;
      if (a.length >= 2) { driveId = d.id; apps = a; break; }
    }
    expect(driveId).not.toBe('');
    const round = await call('POST', `/api/v2/tpo/drives/${driveId}/rounds`, { kind: 'interview', title: 'Technical interview', startsAt: '2026-12-22T04:00:00Z', endsAt: '2026-12-22T08:00:00Z' });
    const ok = await call('POST', `/api/v2/tpo/rounds/${round.body.id}/slots`, { applicationIds: [apps[0].id, apps[1].id], panel: 'Panel A', slotMinutes: 30 });
    expect(ok.status).toBe(200);
    expect(ok.body.created).toBe(2);
    const slots = (await call('GET', '/api/v2/tpo/drives')).body.slots.filter((s: any) => s.roundId === round.body.id);
    expect(slots.map((s: any) => s.startsAt)).toEqual(['2026-12-22T04:00:00.000Z', '2026-12-22T04:30:00.000Z']);
    // Same panel, same times: refused by the database.
    const clash = await call('POST', `/api/v2/tpo/rounds/${round.body.id}/slots`, { applicationIds: [apps[0].id], panel: 'Panel A', slotMinutes: 30 });
    expect(clash.status).toBe(409);
    // Different panel but the same student at the same time: also refused.
    const sameStudent = await call('POST', `/api/v2/tpo/rounds/${round.body.id}/slots`, { applicationIds: [apps[0].id], panel: 'Panel B', slotMinutes: 30 });
    expect(sameStudent.status).toBe(409);
    // Slots that do not fit inside the round are refused with a clear message.
    const short = await call('POST', `/api/v2/tpo/drives/${driveId}/rounds`, { kind: 'interview', title: 'Short round', startsAt: '2026-12-23T04:00:00Z', endsAt: '2026-12-23T05:00:00Z' });
    const tooMany = await call('POST', `/api/v2/tpo/rounds/${short.body.id}/slots`, { applicationIds: [apps[0].id, apps[1].id], panel: 'Panel C', slotMinutes: 45 });
    expect(tooMany.status).toBe(400);
  });
});
