import { describe, it, expect, beforeAll } from 'vitest';
import { createDemoApp, DemoApp } from '../src/v2/demo.js';

let demo: DemoApp;
const tokens: Record<string, string> = {};
async function call(who: string, method: 'GET' | 'POST', url: string, body?: unknown) {
  const res = await demo.app.inject({ method, url, headers: { authorization: `Bearer ${tokens[who]}` }, payload: body as any });
  return { status: res.statusCode, body: res.payload ? JSON.parse(res.payload) : null };
}
beforeAll(async () => {
  demo = await createDemoApp();
  for (const p of ['rahul', 'minor']) tokens[p] = await demo.tokenFor(p);
  tokens.second = await demo.tokenForSubject('demo|student:cse:1');
}, 300_000);

describe('Practice drive proctoring', () => {
  it('locks questions until a camera-on session starts, rejects bad events, and never leaks to another student', async () => {
    const id = (await call('rahul', 'POST', '/api/v2/student/mock/attempts', { role: 'Backend Developer' })).body.id;
    const base = `/api/v2/student/mock/attempts/${id}`;
    const locked = (await call('rahul', 'GET', base)).body;
    expect(locked.questionsLocked).toBe(true);
    expect(locked.aptitude).toBeUndefined();
    // Running code is also blocked before the session starts.
    expect((await call('rahul', 'POST', `${base}/machine/run`, { problemId: '00000000-0000-0000-0000-000000000000', code: 'x' })).status).toBe(403);
    expect((await call('rahul', 'POST', `${base}/proctor`, { events: [{ kind: 'made_up' }] })).status).toBe(400);
    expect((await call('rahul', 'POST', `${base}/proctor`, { events: [] })).status).toBe(400);

    // Camera off: still locked.
    await call('rahul', 'POST', `${base}/proctor`, { events: [{ kind: 'session_started', detail: { camera: false } }] });
    expect((await call('rahul', 'GET', base)).body.questionsLocked).toBe(true);
    await call('rahul', 'POST', `${base}/proctor`, { events: [{ kind: 'session_started', detail: { camera: true, injected: 'x' } }] });
    const open = (await call('rahul', 'GET', base)).body;
    expect(open.questionsLocked).toBe(false);
    expect(open.aptitude).toHaveLength(30);

    const r = await call('rahul', 'POST', `${base}/proctor`, { events: [{ kind: 'tab_hidden', seconds: 12 }, { kind: 'looking_away', seconds: 5, detail: { why: 'head turned sideways' } }] });
    expect(r.body.integrity).toMatchObject({ major: 1, minor: 1 });
    const after = (await call('rahul', 'GET', base)).body;
    expect(after.proctorEvents.map((e: any) => e.kind)).toContain('tab_hidden');
    // Another student cannot read or write this attempt.
    expect((await call('second', 'GET', base)).status).toBe(404);
    expect((await call('second', 'POST', `${base}/proctor`, { events: [{ kind: 'tab_hidden' }] })).status).toBe(404);
  }, 120_000);

  it('a flagged drive finishes with a report but adds no proof', async () => {
    const id = (await call('second', 'POST', '/api/v2/student/mock/attempts', { role: 'Backend Developer' })).body.id;
    const base = `/api/v2/student/mock/attempts/${id}`;
    await call('second', 'POST', `${base}/proctor`, { events: [{ kind: 'session_started', detail: { camera: true } }, { kind: 'tab_hidden' }, { kind: 'fullscreen_exit' }, { kind: 'phone_detected' }] });
    const att = (await call('second', 'GET', base)).body;
    expect(att.integrity.status).toBe('flagged');
    const admin = demo.db.admin;
    const refs = (await admin.query<any>(`SELECT id, reference_solution FROM coding_problems WHERE id = ANY($1)`, [att.machine.map((p: any) => p.id)])).rows;
    const keys = (await admin.query<any>(`SELECT id, answer_index FROM aptitude_questions WHERE id = ANY($1)`, [att.aptitude.map((q: any) => q.id)])).rows;
    await call('second', 'POST', `${base}/aptitude`, { answers: Object.fromEntries(keys.map((k: any) => [k.id, k.answer_index])) });
    await call('second', 'POST', `${base}/machine/submit`, { solutions: Object.fromEntries(refs.map((p: any) => [p.id, p.reference_solution])) });
    await call('second', 'POST', `${base}/interview`, { answers: Object.fromEntries(att.interview.map((q: any) => [q.id, 'index join'])) });
    const exp = (await admin.query<any>(`SELECT id, expected FROM mock_defence_checks WHERE attempt_id = $1`, [id])).rows;
    const iv = await call('second', 'POST', `${base}/defence`, { answers: Object.fromEntries(exp.map((e: any) => [e.id, JSON.stringify(e.expected)])) });
    expect(iv.body.report.integrity.status).toBe('flagged');
    expect(iv.body.report.awarded).toEqual([]);
    expect(iv.body.report.withheld[0].what).toMatch(/All proof/);
  }, 120_000);
});

describe('Code checks: follow-up question, similarity, and students under 18', () => {
  const finish = async (who: string, base: string, att: any, answerDefence: (rows: any[]) => Record<string, string>) => {
    const admin = demo.db.admin;
    const refs = (await admin.query<any>(`SELECT id, reference_solution FROM coding_problems WHERE id = ANY($1)`, [att.machine.map((p: any) => p.id)])).rows;
    const keys = (await admin.query<any>(`SELECT id, answer_index FROM aptitude_questions WHERE id = ANY($1)`, [att.aptitude.map((q: any) => q.id)])).rows;
    await call(who, 'POST', `${base}/aptitude`, { answers: Object.fromEntries(keys.map((k: any) => [k.id, k.answer_index])) });
    await call(who, 'POST', `${base}/machine/submit`, { solutions: Object.fromEntries(refs.map((p: any) => [p.id, p.reference_solution])) });
    const iv = await call(who, 'POST', `${base}/interview`, { answers: Object.fromEntries(att.interview.map((q: any) => [q.id, 'An index speeds up lookups. A join combines rows.'])) });
    const rows = (await admin.query<any>(`SELECT id, expected FROM mock_defence_checks WHERE attempt_id = $1`, [base.split('/').pop()])).rows;
    // With nothing to ask (no passed problem had a suitable hidden test) the drive finishes at the last round.
    if (rows.length === 0) return { rows, done: iv };
    return { rows, done: await call(who, 'POST', `${base}/defence`, { answers: answerDefence(rows) }) };
  };

  it('a wrong follow-up answer withholds that problem\'s proof, and the right answer is never sent to the browser', async () => {
    const id = (await call('second', 'POST', '/api/v2/student/mock/attempts', { role: 'Backend Developer' })).body.id;
    const base = `/api/v2/student/mock/attempts/${id}`;
    await call('second', 'POST', `${base}/proctor`, { events: [{ kind: 'session_started', detail: { camera: true } }] });
    const att = (await call('second', 'GET', base)).body;
    const { rows, done } = await finish('second', base, att, rs => Object.fromEntries(rs.map(r => [r.id, '"definitely wrong"'])));
    expect(rows.length).toBeGreaterThan(0);
    expect(done.status).toBe(200);
    expect(done.body.report.defence.every((d: any) => d.correct === false)).toBe(true);
    expect(done.body.report.awarded.filter((m: string) => /machine/i.test(m))).toEqual([]);
    expect(done.body.report.withheld.some((w: any) => /follow-up/.test(w.reason))).toBe(true);
  }, 120_000);

  it('an answer that arrives after the deadline counts as wrong', async () => {
    const id = (await call('rahul', 'POST', '/api/v2/student/mock/attempts', { role: 'Backend Developer' })).body.id;
    const base = `/api/v2/student/mock/attempts/${id}`;
    await call('rahul', 'POST', `${base}/proctor`, { events: [{ kind: 'session_started', detail: { camera: true } }] });
    const att = (await call('rahul', 'GET', base)).body;
    const admin = demo.db.admin;
    const refs = (await admin.query<any>(`SELECT id, reference_solution FROM coding_problems WHERE id = ANY($1)`, [att.machine.map((p: any) => p.id)])).rows;
    const keys = (await admin.query<any>(`SELECT id, answer_index FROM aptitude_questions WHERE id = ANY($1)`, [att.aptitude.map((q: any) => q.id)])).rows;
    await call('rahul', 'POST', `${base}/aptitude`, { answers: Object.fromEntries(keys.map((k: any) => [k.id, k.answer_index])) });
    await call('rahul', 'POST', `${base}/machine/submit`, { solutions: Object.fromEntries(refs.map((p: any) => [p.id, p.reference_solution])) });
    await call('rahul', 'POST', `${base}/interview`, { answers: Object.fromEntries(att.interview.map((q: any) => [q.id, 'An index speeds up lookups.'])) });
    expect((await call('rahul', 'GET', base)).body.defence.length).toBeGreaterThan(0);
    await admin.query(`UPDATE mock_defence_checks SET deadline_at = now() - interval '1 minute' WHERE attempt_id = $1`, [id]);
    expect((await call('rahul', 'GET', base)).body.defence[0].expired).toBe(true);
    const rows = (await admin.query<any>(`SELECT id, expected FROM mock_defence_checks WHERE attempt_id = $1`, [id])).rows;
    const late = await call('rahul', 'POST', `${base}/defence`, { answers: Object.fromEntries(rows.map((r: any) => [r.id, JSON.stringify(r.expected)])) });
    expect(late.body.report.defence.every((d: any) => d.correct === false)).toBe(true);
    expect((await call('rahul', 'POST', `${base}/defence`, { answers: {} })).status).toBe(409);
  }, 120_000);

  it('flags code that matches another student\'s answer but not the reference solution', async () => {
    const id = (await call('second', 'POST', '/api/v2/student/mock/attempts', { role: 'Backend Developer' })).body.id;
    const base = `/api/v2/student/mock/attempts/${id}`;
    await call('second', 'POST', `${base}/proctor`, { events: [{ kind: 'session_started', detail: { camera: true } }] });
    const att = (await call('second', 'GET', base)).body;
    const js = att.machine.find((p: any) => p.language !== 'sql');
    const sibling = `function ${js.entry}(a, b) {\n  const out = [];\n  for (let i = 0; i < a.length; i++) {\n    for (let j = 0; j < a.length; j++) {\n      if (a[i] !== a[j] && String(a[i]).length + String(a[j]).length > String(b).length) out.push([a[i], a[j], i * j]);\n    }\n  }\n  return out.sort((x, y) => x[2] - y[2]).slice(0, 3);\n}`;
    const admin = demo.db.admin;
    const peer = (await admin.query<any>(`SELECT s.id FROM students s JOIN users u ON u.id = s.user_id WHERE u.auth_subject = 'demo|student:cse:0'`)).rows[0].id;
    await admin.query(`INSERT INTO judge_runs (student_id, purpose, ref_id, problem_id, language, code, passed, total, results, runner) VALUES ($1,'mock',$2,$3,'javascript',$4,0,1,'[]','test')`, [peer, '00000000-0000-0000-0000-000000000001', js.id, sibling]);
    const renamed = sibling.replace(/\ba\b/g, 'items').replace(/\bb\b/g, 'limit').replace(/\bout\b/g, 'found');
    const res = await call('second', 'POST', `${base}/machine/submit`, { solutions: { [js.id]: renamed } });
    const p = res.body.result.problems.find((x: any) => x.problemId === js.id);
    expect(p.similarity.flagged).toBe(true);
    const audit = (await admin.query<any>(`SELECT metadata FROM audit_events WHERE action = 'MOCK_SIMILARITY_FLAGGED' ORDER BY seq DESC LIMIT 1`)).rows[0];
    expect(audit.metadata.otherAttemptId).toBe('00000000-0000-0000-0000-000000000001');
    expect(JSON.stringify(res.body)).not.toContain('00000000-0000-0000-0000-000000000001');
  }, 120_000);

  it('students under 18 get no camera or test-window rules, but still get the follow-up and can earn proof', async () => {
    // A student of the main college, made 16 by date of birth (the diploma demo college has no interview bank to finish a drive with).
    tokens.minor16 = await demo.tokenForSubject('demo|student:cse:2');
    await demo.db.admin.query(`UPDATE students SET date_of_birth = (CURRENT_DATE - INTERVAL '16 years')::date WHERE user_id = (SELECT id FROM users WHERE auth_subject = 'demo|student:cse:2')`);
    const id = (await call('minor16', 'POST', '/api/v2/student/mock/attempts', { role: 'Backend Developer' })).body.id;
    const base = `/api/v2/student/mock/attempts/${id}`;
    const att = (await call('minor16', 'GET', base)).body;
    expect(att.proctorRequired).toBe(false);
    expect(att.questionsLocked).toBe(false);
    expect(att.aptitude).toHaveLength(30);
    expect((await call('minor16', 'POST', `${base}/proctor`, { events: [{ kind: 'session_started', detail: { camera: true } }] })).status).toBe(403);
    const { done } = await finish('minor16', base, att, rs => Object.fromEntries(rs.map(r => [r.id, JSON.stringify(r.expected)])));
    expect(done.body.report.integrity.status).toBe('exempt');
    expect(done.body.report.awarded.length).toBeGreaterThan(0);
        const stored = (await demo.db.admin.query<any>(`SELECT count(*)::int AS n FROM mock_proctor_events WHERE attempt_id = $1`, [id])).rows[0].n;
    expect(stored).toBe(0);
  }, 120_000);
});

describe('Typing observations', () => {
  // Each test uses a student who has no attempt yet, so starting one never resumes an earlier, half-finished drive.
  const fresh = async (key: string, n: number) => { tokens[key] = await demo.tokenForSubject(`demo|student:cse:${n}`); return key; };
  const setup = async (who: string, camera = true) => {
    const id = (await call(who, 'POST', '/api/v2/student/mock/attempts', { role: 'Backend Developer' })).body.id;
    const base = `/api/v2/student/mock/attempts/${id}`;
    if (camera) await call(who, 'POST', `${base}/proctor`, { events: [{ kind: 'session_started', detail: { camera: true } }] });
    return { id, base, att: (await call(who, 'GET', base)).body };
  };
  const human = { keystrokes: 150, finalChars: 200, baseChars: 40, maxJump: 2, gaps: 140, medianGapMs: 180, gapCv: 0.7 };
  const code = (n: number) => `function f(a) { return a; }${' '.repeat(n)}`;

  it('are recorded as facts for review, with a reason, and never withhold proof', async () => {
    const who = await fresh('typ1', 4);
    const { id, base, att } = await setup(who);
    const js = att.machine.find((p: any) => p.language !== 'sql');
    const res = await call(who, 'POST', `${base}/machine/submit`, { solutions: { [js.id]: code(200) }, typing: { [js.id]: { ...human, maxJump: 300, keystrokes: 5 } } });
    expect(res.status).toBe(200);
    const events = (await call(who, 'GET', base)).body.proctorEvents.filter((e: any) => e.kind.startsWith('code_'));
    expect(events.map((e: any) => e.kind).sort()).toEqual(['code_bulk_insert', 'code_little_typing']);
    expect(events.every((e: any) => e.severity === 'review' && /character|keystroke/.test(e.why))).toBe(true);
    const integ = (await call(who, 'GET', base)).body.integrity;
    expect(integ.status).toBe('review');
    expect(integ.major).toBe(0);
    expect(id).toBeTruthy();
  }, 120_000);

  it('ordinary typing records nothing, and a missing typing record is itself reported', async () => {
    const w2 = await fresh('typ2', 5);
    const a = await setup(w2);
    const js = a.att.machine.find((p: any) => p.language !== 'sql');
    await call(w2, 'POST', `${a.base}/machine/submit`, { solutions: { [js.id]: code(200) }, typing: { [js.id]: human } });
    expect((await call(w2, 'GET', a.base)).body.proctorEvents.filter((e: any) => e.kind.startsWith('code_'))).toEqual([]);
    const w3 = await fresh('typ3', 6);
    const b = await setup(w3);
    const js2 = b.att.machine.find((p: any) => p.language !== 'sql');
    await call(w3, 'POST', `${b.base}/machine/submit`, { solutions: { [js2.id]: code(200) } });
    const ev = (await call(w3, 'GET', b.base)).body.proctorEvents.filter((e: any) => e.kind.startsWith('code_'));
    expect(ev.map((e: any) => e.kind)).toEqual(['code_little_typing']);
  }, 120_000);

  it('the browser cannot create these events directly, and under-18 students are never analysed', async () => {
    const w4 = await fresh('typ4', 7);
    const a = await setup(w4);
    expect((await call(w4, 'POST', `${a.base}/proctor`, { events: [{ kind: 'code_bulk_insert' }] })).status).toBe(400);
    tokens.minor17 = await demo.tokenForSubject('demo|student:cse:3');
    await demo.db.admin.query(`UPDATE students SET date_of_birth = (CURRENT_DATE - INTERVAL '17 years')::date WHERE user_id = (SELECT id FROM users WHERE auth_subject = 'demo|student:cse:3')`);
    const m = await setup('minor17', false);
    const js = m.att.machine.find((p: any) => p.language !== 'sql');
    await call('minor17', 'POST', `${m.base}/machine/submit`, { solutions: { [js.id]: code(200) }, typing: { [js.id]: { ...human, maxJump: 900 } } });
    const n = (await demo.db.admin.query<any>(`SELECT count(*)::int AS n FROM mock_proctor_events WHERE attempt_id = $1`, [m.id])).rows[0].n;
    expect(n).toBe(0);
  }, 120_000);
});
