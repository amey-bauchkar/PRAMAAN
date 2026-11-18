import { describe, it, expect, beforeAll } from 'vitest';
import { createDemoApp, DemoApp } from '../src/v2/demo.js';

/**
 * End-to-end through the real HTTP API on the offline demo database (PGlite, RLS on as app_api):
 * Rahul's journey from the problem statement, the placement office, the recruiter, the university, and
 * cross-college / cross-role isolation checks.
 */
let demo: DemoApp;
const tokens: Record<string, string> = {};

async function call(persona: string, method: 'GET' | 'POST', url: string, body?: unknown) {
  const res = await demo.app.inject({ method, url, headers: { authorization: `Bearer ${tokens[persona]}` }, payload: body as any });
  let json: any;
  try { json = JSON.parse(res.payload); } catch { json = res.payload; }
  return { status: res.statusCode, body: json };
}

beforeAll(async () => {
  demo = await createDemoApp();
  for (const p of ['rahul', 'minor', 'tpo', 'coord', 'mentor', 'recruiter', 'university', 'tpo-poly']) tokens[p] = await demo.tokenFor(p);
}, 300_000);

describe('Student journey (Rahul)', () => {
  it('profile: SQL is only Claimed, Python Verified with a proof level', async () => {
    const r = await call('rahul', 'GET', '/api/v2/student/profile');
    expect(r.status).toBe(200);
    expect(r.body.student.name).toBe('Rahul Deshmukh');
    const sql = r.body.skills.find((s: any) => s.slug === 'sql');
    expect(sql.state).toBe('claimed');
    expect(r.body.skills.find((s: any) => s.slug === 'python')).toMatchObject({ state: 'verified', proofLevel: 'L1_code_backed' });
  });

  it('drives: Backend Developer is published and blocked by SQL; Proof Path ranks SQL first', async () => {
    const r = await call('rahul', 'GET', '/api/v2/student/drives');
    const backend = r.body.drives.find((d: any) => d.title === 'Backend Developer');
    expect(backend.decision.result).toBe('ineligible');
    expect(backend.decision.checks.some((c: any) => c.passed === false && /SQL/.test(c.message))).toBe(true);
    expect(r.body.proofPath.actions[0].name).toBe('SQL');
    // Deadline-aware recourse: each action says how long it takes and whether it lands before each drive.
    const t = r.body.proofPath.actions[0].timing;
    expect(t.estHours).toBeGreaterThan(0);
    expect(t.drives.length).toBe(r.body.proofPath.actions[0].unlocksCount);
    for (const d of t.drives) expect(['in_time', 'tight', 'next_drives']).toContain(d.horizon);
  });

  it('links LeetCode by ownership token: Problem Solving becomes Observed, not Verified', async () => {
    const link = await call('rahul', 'POST', '/api/v2/student/external-profiles', { provider: 'leetcode', handle: 'rahul-deshmukh-demo' });
    expect(link.body.token).toMatch(/^PRAMAAN-/);
    const v = await call('rahul', 'POST', '/api/v2/student/external-profiles/leetcode/verify');
    expect(v.body.verified).toBe(true);
    expect(v.body.stats.solved).toBe(200);
    const p = await call('rahul', 'GET', '/api/v2/student/profile');
    expect(p.body.skills.find((s: any) => s.slug === 'problem-solving').state).toBe('observed');
  });

  it('mock drive: three rounds, a report, and passing the SQL problem makes SQL Verified (L2) and the drive eligible', async () => {
    const start = await call('rahul', 'POST', '/api/v2/student/mock/attempts', { role: 'Backend Developer' });
    expect(start.status).toBe(200);
    const id = start.body.id;
    const att = await call('rahul', 'GET', `/api/v2/student/mock/attempts/${id}`);
    expect(att.body.aptitude).toHaveLength(30);
    expect(att.body.machine).toHaveLength(2);
    expect(att.body.interview).toHaveLength(3);
    expect(JSON.stringify(att.body)).not.toMatch(/answer_index|reference_solution|hidden_tests/);

    const admin = demo.db.admin;
    const keys = (await admin.query<any>(`SELECT id, answer_index FROM aptitude_questions WHERE id = ANY($1)`, [att.body.aptitude.map((q: any) => q.id)])).rows;
    const answers = Object.fromEntries(keys.map((k: any, i: number) => [k.id, i < 21 ? k.answer_index : (k.answer_index + 1) % 4]));
    const apt = await call('rahul', 'POST', `/api/v2/student/mock/attempts/${id}/aptitude`, { answers });
    expect(apt.body.result.score).toBe(21);

    const refs = (await admin.query<any>(`SELECT id, reference_solution FROM coding_problems WHERE id = ANY($1)`, [att.body.machine.map((p: any) => p.id)])).rows;
    const solutions = Object.fromEntries(refs.map((p: any) => [p.id, p.reference_solution]));
    const mach = await call('rahul', 'POST', `/api/v2/student/mock/attempts/${id}/machine/submit`, { solutions });
    expect(mach.status).toBe(200);
    expect(mach.body.result.score).toBe(20);

    const iq = att.body.interview;
    const iv = await call('rahul', 'POST', `/api/v2/student/mock/attempts/${id}/interview`, {
      answers: Object.fromEntries(iq.map((q: any) => [q.id, 'An index speeds up lookups with a B-tree but slows down writes and uses storage. Inner join returns only matching rows; a left join keeps all rows from the left table with NULL.'])),
    });
    expect(iv.body.report).not.toBeNull();
    expect(iv.body.report.rounds.map((x: any) => x.round)).toEqual(['aptitude', 'machine_test', 'interview']);
    expect(iv.body.report.awarded.join(' ')).toMatch(/SQL is now Verified \(L2 assessed\)/);

    const drives = await call('rahul', 'GET', '/api/v2/student/drives');
    expect(drives.body.drives.find((d: any) => d.title === 'Backend Developer').decision.result).toBe('eligible');
  }, 120_000);

  it('Live Mutation Probe: anchor is hash-verified, prediction then mutation passes → JavaScript Verified (L3 defended)', async () => {
    const list = await call('rahul', 'GET', '/api/v2/student/probes');
    const probe = await call('rahul', 'GET', `/api/v2/student/probes/${list.body[0].id}`);
    expect(probe.body.anchor.hashVerified).toBe(true);
    expect(probe.body.provenance).toBe('preloaded_demo_snapshot');

    const early = await call('rahul', 'POST', `/api/v2/student/probes/${list.body[0].id}/mutate`, { code: 'function finalAmount(){return 0}' });
    expect(early.status).toBe(409);

    const pred = await call('rahul', 'POST', `/api/v2/student/probes/${list.body[0].id}/predict`, {
      answer: 'An empty cart returns 0. With a 120% discount the taxable amount becomes negative, so the total is negative; we should validate the discount between 0 and 100.',
    });
    expect(pred.body.passed).toBe(true);

    const wrong = await call('rahul', 'POST', `/api/v2/student/probes/${list.body[0].id}/mutate`, { code: probe.body.code });
    expect(wrong.body.passed).toBe(false);

    const fixed = `function finalAmount(items, discountPercent) {
  if (discountPercent < 0 || discountPercent > 100) throw new RangeError('bad discount');
  let subtotal = 0;
  for (const item of items) { if (item.qty <= 0) continue; subtotal += item.pricePaise * item.qty; }
  const discount = Math.round(subtotal * discountPercent / 100);
  const taxable = subtotal - discount;
  return taxable + Math.round(taxable * 5 / 100);
}`;
    const ok = await call('rahul', 'POST', `/api/v2/student/probes/${list.body[0].id}/mutate`, { code: fixed });
    expect(ok.body.passed).toBe(true);
    const p = await call('rahul', 'GET', '/api/v2/student/profile');
    expect(p.body.skills.find((s: any) => s.slug === 'javascript')).toMatchObject({ state: 'verified', proofLevel: 'L3_defended' });
  }, 60_000);

  it('learning path is generated with reasons, and the Skill Passport verifies publicly', async () => {
    const lp = await call('rahul', 'POST', '/api/v2/student/learning-path/generate', {});
    expect(lp.status).toBe(200);
    expect(lp.body.path.items.length).toBeGreaterThan(0);
    expect(lp.body.path.items[0].reason.length).toBeGreaterThan(10);

    const prof = await call('rahul', 'GET', '/api/v2/student/profile');
    const sqlSkill = prof.body.skills.find((s: any) => s.slug === 'sql');
    const cred = await call('rahul', 'POST', '/api/v2/student/credentials', { studentSkillId: sqlSkill.id });
    expect(cred.body.credential.type).toContain('OpenBadgeCredential');
    const pub = await demo.app.inject({ method: 'GET', url: `/api/public/credentials/${cred.body.id}` });
    expect(JSON.parse(pub.payload).check.valid).toBe(true);
  });

  it('applies to the drive and shares with recruiters', async () => {
    const drives = await call('rahul', 'GET', '/api/v2/student/drives');
    const backend = drives.body.drives.find((d: any) => d.title === 'Backend Developer');
    expect((await call('rahul', 'POST', `/api/v2/student/drives/${backend.id}/apply`)).status).toBe(200);
    expect((await call('rahul', 'POST', '/api/v2/student/consents', { purpose: 'recruiter_sharing', action: 'grant' })).status).toBe(200);
  });

  it('a minor without verified parental consent cannot turn on recruiter sharing', async () => {
    const r = await call('minor', 'POST', '/api/v2/student/consents', { purpose: 'recruiter_sharing', action: 'grant' });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/parental consent/);
  });
});

describe('Recruiter and placement office', () => {
  it('recruiter finds Rahul by verified SQL ≥ L2 with reasons, then requests a shortlist that an officer approves', async () => {
    const drives = await call('recruiter', 'GET', '/api/v2/recruiter/drives');
    const backend = drives.body.drives.find((d: any) => d.title === 'Backend Developer');
    const s = await call('recruiter', 'GET', `/api/v2/recruiter/search?driveId=${backend.id}&skills=sql:L2`);
    expect(s.status).toBe(200);
    const rahul = s.body.results.find((x: any) => x.displayName === 'Rahul Deshmukh');
    expect(rahul.matched[0].reason).toMatch(/SQL Verified \(L2 assessed\)/);
    const card = await call('recruiter', 'GET', `/api/v2/recruiter/candidates/${rahul.studentId}?driveId=${backend.id}`);
    expect(card.body.skills.length).toBeGreaterThan(2);
    expect(JSON.stringify(card.body)).not.toMatch(/gender|category|date_of_birth/i);

    const sl = await call('recruiter', 'POST', '/api/v2/recruiter/shortlist', { driveId: backend.id, studentIds: [rahul.studentId] });
    expect(sl.status).toBe(200);
    const dec = await call('tpo', 'POST', `/api/v2/tpo/proposals/${sl.body.proposalId}/decide`, { decision: 'approve' });
    expect(dec.body.effect).toMatch(/1 student\(s\) shortlisted/);
  });

  it('recruiter cannot open a drive without a grant', async () => {
    const tpoDrives = await call('tpo', 'GET', '/api/v2/tpo/drives');
    const sde = tpoDrives.body.drives.find((d: any) => d.title === 'Software Engineer Trainee');
    expect((await call('recruiter', 'GET', `/api/v2/recruiter/search?driveId=${sde.id}&skills=java:L1`)).status).toBe(403);
  });

  it('officer dashboards respond: cohort KPIs with formulas, SQL workshop before/after, demand alerts, readiness range, fairness, accreditation', async () => {
    const c = await call('tpo', 'GET', '/api/v2/tpo/cohort');
    expect(c.body.kpis).toHaveLength(6);
    expect(c.body.kpis[0].formula).toBeTruthy();
    expect(c.body.beforeAfter.before.weakPercent).toBeGreaterThan(c.body.beforeAfter.after.weakPercent);

    const scan = await call('tpo', 'POST', '/api/v2/tpo/demand/scan');
    expect(scan.body.scanned).toBeGreaterThan(30);
    const d = await call('tpo', 'GET', '/api/v2/tpo/demand');
    expect(d.body.sampleSize).toBeGreaterThan(30);
    expect(d.body.alerts.length).toBeGreaterThan(0);

    const r = await call('tpo', 'GET', '/api/v2/tpo/readiness');
    expect(r.body.forecast.lowPercent).toBeLessThanOrEqual(r.body.forecast.estimatePercent);

    const drives = await call('tpo', 'GET', '/api/v2/tpo/drives');
    const past = drives.body.drives.find((x: any) => x.status === 'completed');
    const f = await call('tpo', 'GET', `/api/v2/tpo/fairness?driveId=${past.id}&dimension=gender`);
    expect(f.status).toBe(200);
    expect(f.body.report.shortlist.stage).toBe('shortlist');

    const a = await call('tpo', 'GET', '/api/v2/tpo/accreditation');
    expect(a.body.total.placed).toBeGreaterThan(0);
    const csv = await demo.app.inject({ method: 'GET', url: '/api/v2/tpo/accreditation/export.csv', headers: { authorization: `Bearer ${tokens.tpo}` } });
    expect(csv.payload.split('\n')[0]).toMatch(/^Branch,Students graduating/);
  }, 120_000);

  it('rule what-if shows who gains and loses with fairness by group, then publishes an immutable new version', async () => {
    const drives = await call('tpo', 'GET', '/api/v2/tpo/drives');
    const backend = drives.body.drives.find((d: any) => d.title === 'Backend Developer');
    const rules = await call('tpo', 'GET', `/api/v2/tpo/drives/${backend.id}/rules`);
    const current = rules.body.versions[0].rules;
    const draft = { ...current, academics: { ...current.academics, minCgpa: 8.5 } };
    const prev = await call('tpo', 'POST', `/api/v2/tpo/drives/${backend.id}/rules/preview`, { rules: draft });
    expect(prev.body.lost).toBeGreaterThan(0);
    // Branch is restricted on purpose for this drive, so fairness is compared within allowed branches only.
    expect(prev.body.fairness.gender.groups).toBeTruthy();
    expect(prev.body.fairness.branch).toBeUndefined();
    expect(prev.body.populationNote).toMatch(/allowed branches/);
    const pub = await call('tpo', 'POST', `/api/v2/tpo/drives/${backend.id}/rules/publish`, { rules: draft, rationale: 'Raise CGPA floor for the company request' });
    expect(pub.body.versionNo).toBe(2);
    await expect(demo.db.admin.query(`UPDATE eligibility_rule_versions SET rationale = 'x' WHERE id = $1`, [pub.body.versionId])).rejects.toThrow(/immutable/);
  }, 120_000);

  it('appeal: student appeals a failed rule, officer overturns with a recorded reason', async () => {
    const drives = await call('rahul', 'GET', '/api/v2/student/drives');
    const failing = drives.body.drives.find((d: any) => d.decision?.result === 'ineligible');
    const ap = await call('rahul', 'POST', '/api/v2/student/appeals', { decisionId: failing.decision.id, reason: 'My Docker certificate was submitted last week and is pending review.' });
    expect(ap.status).toBe(200);
    const list = await call('tpo', 'GET', '/api/v2/tpo/appeals');
    const mine = list.body.find((x: any) => x.id === ap.body.id);
    expect(mine.status).toBe('pending');
    const d = await call('tpo', 'POST', `/api/v2/tpo/appeals/${ap.body.id}/decide`, { status: 'overturned', note: 'Certificate verified with the issuer offline.' });
    expect(d.status).toBe(200);
  });

  it('company email becomes a slot proposal; approval adds rounds; a double-booked room is refused by the database', async () => {
    const dr = await call('tpo', 'GET', '/api/v2/tpo/drives');
    const msg = dr.body.inbound[0];
    const p = await call('tpo', 'POST', `/api/v2/tpo/inbound/${msg.id}/propose`);
    expect(p.body.parsed.date).toBe('2026-12-21');
    expect(p.body.allocations.length).toBe(3);
    const ok = await call('tpo', 'POST', `/api/v2/tpo/proposals/${p.body.proposalId}/decide`, { decision: 'approve' });
    expect(ok.body.effect).toMatch(/3 round/);
    const round = (await call('tpo', 'GET', '/api/v2/tpo/drives')).body.rounds.find((r: any) => r.title.includes('Linux practical') && r.startsAt.startsWith('2026-12-21'));
    const roomId = dr.body.rooms.find((x: any) => x.name === round.room).id;
    const clash = await call('tpo', 'POST', `/api/v2/tpo/drives/${round.driveId}/rounds`, { title: 'Clashing test', kind: 'technical_test', startsAt: round.startsAt, endsAt: round.endsAt, roomId });
    expect(clash.status).toBe(409);
    expect(clash.body.error).toMatch(/Time clash/);
  });
});

describe('Isolation (Phase 3)', () => {
  it('students cannot call placement-office or recruiter endpoints', async () => {
    expect((await call('rahul', 'GET', '/api/v2/tpo/cohort')).status).toBe(403);
    expect((await call('rahul', 'GET', '/api/v2/recruiter/drives')).status).toBe(403);
  });

  it('another college sees none of the first college\'s appeals, drives or students', async () => {
    const appeals = await call('tpo-poly', 'GET', '/api/v2/tpo/appeals');
    expect(appeals.body.every((a: any) => a.enrollmentNo.startsWith('KGP-'))).toBe(true);
    const drives = await call('tpo-poly', 'GET', '/api/v2/tpo/drives');
    expect(drives.body.drives.map((d: any) => d.title).sort()).toEqual(['Junior Site Engineer', 'Solar Installation Technician']);
    const cohort = await call('tpo-poly', 'GET', '/api/v2/tpo/cohort');
    expect(cohort.body.branches.sort()).toEqual(['DCE', 'DEE']);
  });

  it('a department coordinator sees only their department', async () => {
    const c = await call('coord', 'GET', '/api/v2/tpo/cohort');
    expect(c.body.branches).toEqual(['CSE']);
  });

  it('the university sees per-college aggregates only, and no college endpoints', async () => {
    const u = await call('university', 'GET', '/api/v2/university/outcomes');
    expect(u.body.colleges).toHaveLength(2);
    expect(JSON.stringify(u.body)).not.toMatch(/Rahul|enrollment/i);
    expect((await call('university', 'GET', '/api/v2/tpo/cohort')).status).toBe(403);
  });

  it('demographics are never readable through the application role', async () => {
    const leak = demo.db.withTenant({ userId: '00000000-0000-0000-0000-000000000000', orgId: (await demo.db.admin.query<any>(`SELECT id FROM organizations WHERE kind = 'college' AND name LIKE '%Sahyadri%'`)).rows[0].id, role: 'officer' },
      async sql => (await sql.query<any>(`SELECT count(*)::int AS n FROM student_group_attributes`)).rows[0].n);
    await expect(leak).rejects.toThrow(/permission denied/);
  });
});
