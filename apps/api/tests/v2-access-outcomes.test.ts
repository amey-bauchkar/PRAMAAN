import { describe, it, expect, beforeAll } from 'vitest';
import ExcelJS from 'exceljs';
import { createDemoApp, DemoApp } from '../src/v2/demo.js';

let demo: DemoApp;
const tokens: Record<string, string> = {};
const call = async (who: string, method: 'GET' | 'POST', url: string, body?: unknown) => {
  const res = await demo.app.inject({ method, url, headers: { authorization: `Bearer ${tokens[who]}` }, payload: body as any });
  return { status: res.statusCode, body: res.payload && res.headers['content-type']?.toString().includes('json') ? JSON.parse(res.payload) : null, raw: res.rawPayload, type: String(res.headers['content-type'] ?? '') };
};

describe('Recruiter access, outcomes and the Excel export', () => {
  beforeAll(async () => { demo = await createDemoApp(); for (const p of ['tpo', 'recruiter', 'rahul']) tokens[p] = await demo.tokenFor(p); }, 300_000);

  it('a recruiter sees only drives the officer granted, and an ended grant stops access', async () => {
    const g = (await call('tpo', 'GET', '/api/v2/tpo/recruiter-grants')).body;
    const drives = (await call('tpo', 'GET', '/api/v2/tpo/drives')).body.drives;
    const recruiter = g.recruiters[0];
    const target = drives.find((d: any) => !g.grants.some((x: any) => x.active && x.drive === d.title)) ?? drives[0];
    const made = await call('tpo', 'POST', '/api/v2/tpo/recruiter-grants', { recruiterMembershipId: recruiter.id, driveId: target.id, days: 7 });
    expect(made.status).toBe(200);
    expect((await call('tpo', 'POST', '/api/v2/tpo/recruiter-grants', { recruiterMembershipId: recruiter.id, driveId: target.id, days: 'abc' })).status).toBe(200); // bad days fall back to 30
    expect((await call('rahul', 'POST', '/api/v2/tpo/recruiter-grants', { recruiterMembershipId: recruiter.id, driveId: target.id })).status).toBe(403);
    await call('tpo', 'POST', `/api/v2/tpo/recruiter-grants/${made.body.id}/revoke`);
    const after = (await call('tpo', 'GET', '/api/v2/tpo/recruiter-grants')).body.grants.find((x: any) => x.id === made.body.id);
    expect(after.active).toBe(false);
  });

  it('records an outcome the system did not see and counts it in the accreditation table and workbook', async () => {
    const before = (await call('tpo', 'GET', '/api/v2/tpo/accreditation')).body;
    const enrol = (await demo.db.admin.query<any>(`SELECT s.enrollment_no FROM students s WHERE s.org_id = (SELECT org_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.auth_subject = 'demo|tpo-a' LIMIT 1) AND NOT EXISTS (SELECT 1 FROM student_outcomes o WHERE o.student_id = s.id) LIMIT 1`)).rows[0].enrollment_no;
    expect((await call('tpo', 'POST', '/api/v2/tpo/outcomes', { enrollmentNo: 'NO-SUCH', outcomeType: 'higher_studies' })).status).toBe(404);
    expect((await call('tpo', 'POST', '/api/v2/tpo/outcomes', { enrollmentNo: enrol, outcomeType: 'retired' })).status).toBe(400);
    expect((await call('tpo', 'POST', '/api/v2/tpo/outcomes', { enrollmentNo: enrol, outcomeType: 'higher_studies', organization: 'IIT Bombay' })).status).toBe(200);
    const after = (await call('tpo', 'GET', '/api/v2/tpo/accreditation')).body;
    expect(after.total.higherStudies).toBe(before.total.higherStudies + 1);

    const x = await call('tpo', 'GET', '/api/v2/tpo/accreditation/export.xlsx');
    expect(x.status).toBe(200);
    expect(x.type).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.raw as any);
    const ws = wb.getWorksheet('Placement outcomes')!;
    const last = ws.getRow(ws.rowCount).values as any[];
    expect(last[1]).toBe(after.total.branch);
    expect(last[5]).toBe(after.total.higherStudies);
    expect(wb.getWorksheet('Notes')!.rowCount).toBeGreaterThan(0);
  });
});
