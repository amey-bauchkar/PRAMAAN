import { describe, it, expect, beforeAll } from 'vitest';
import { createDemoApp, DemoApp } from '../src/v2/demo.js';

/**
 * Real onboarding on the offline database (PGlite, row-level security on as app_api): invitation, claim, and every way to abuse it.
 */
let demo: DemoApp;
const tokens: Record<string, string> = {};
let deptId = '';

async function call(token: string | null, method: 'GET' | 'POST', url: string, body?: unknown) {
  const res = await demo.app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body as any });
  let json: any; try { json = JSON.parse(res.payload); } catch { json = res.payload; }
  return { status: res.statusCode, body: json };
}
const login = (sub: string, email: string, o: { provider?: string; verified?: boolean } = {}) =>
  demo.tokenWithClaims({ sub, email, user_metadata: { email_verified: o.verified ?? true }, app_metadata: { provider: o.provider ?? 'email' } });
const created = 'created';
const tokenOf = (url: string) => decodeURIComponent(url.split('#t=')[1]);
let n = 0;
const student = (over: Record<string, unknown> = {}) => {
  n++;
  return { fullName: `Test Student ${n}`, email: `student${n}@apex.test`, role: 'student', departmentId: deptId, enrollmentNo: `T-${1000 + n}`, graduatingYear: 2027, dateOfBirth: '2005-03-02', ...over };
};
const invite = async (who: string, entries: any[]) => (await call(tokens[who], 'POST', '/api/v2/tpo/invitations', { invitations: entries }));

beforeAll(async () => {
  demo = await createDemoApp();
  for (const p of ['tpo', 'tpo-poly', 'mentor', 'rahul', 'recruiter', 'coord', 'university']) tokens[p] = await demo.tokenFor(p);
  deptId = (await call(tokens.tpo, 'GET', '/api/v2/tpo/invitations')).body.departments[0].id;
}, 300_000);

describe('Invitations: who may send them', () => {
  it('only officer-level roles can invite; students, mentors, recruiters, coordinators and the university cannot', async () => {
    for (const who of ['rahul', 'mentor', 'recruiter', 'coord', 'university']) {
      expect((await call(tokens[who], 'POST', '/api/v2/tpo/invitations', { invitations: [student()] })).status, who).toBe(403);
      expect((await call(tokens[who], 'GET', '/api/v2/tpo/invitations')).status, who).toBe(403);
    }
    expect((await call(null, 'POST', '/api/v2/tpo/invitations', { invitations: [student()] })).status).toBe(401);
  });

  it('validates every entry, never invites a platform admin, and keeps one bad row from blocking the rest', async () => {
    const r = await invite('tpo', [student(), student({ role: 'platform_admin' }), student({ email: 'nope' }), student({ dateOfBirth: '' }), student({ departmentId: null }), student({ role: 'college_admin' })]);
    expect(r.status).toBe(200);
    expect(r.body.results.map((x: any) => x.status)).toEqual(['created', 'invalid', 'invalid', 'invalid', 'invalid', 'invalid']); // the last is a college admin, which an officer may not invite
  });

  it('refuses a department from another college and a duplicate waiting invitation', async () => {
    const other = (await call(tokens['tpo-poly'], 'GET', '/api/v2/tpo/invitations')).body.departments[0].id;
    expect((await invite('tpo', [student({ departmentId: other })])).body.results[0].status).toBe('invalid');
    const e = student();
    expect((await invite('tpo', [e])).body.results[0].status).toBe('created');
    expect((await invite('tpo', [e])).body.results[0].status).toBe('duplicate');
  });
});

describe('Claiming an invitation', () => {
  it('gives a signed-in new person exactly the invited role and college, and stores only a hash of the link', async () => {
    const e = student({ dateOfBirth: '2000-01-01' });
    const res = (await invite('tpo', [e])).body.results[0];
    expect(res.claimUrl).toMatch(/\/claim#t=[A-Za-z0-9_-]{40,}$/); // token is in the fragment, which is never sent to a server
    const tok = tokenOf(res.claimUrl);
    const stored = (await demo.db.admin.query<any>(`SELECT token_hash FROM pending_invites WHERE id = $1`, [res.id])).rows[0].token_hash;
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify((await demo.db.admin.query<any>(`SELECT * FROM pending_invites WHERE id = $1`, [res.id])).rows)).not.toContain(tok);

    const me0 = await call(await login('real|new-1', e.email), 'GET', '/api/me');
    expect(me0.status).toBe(403); // a genuine login with no record gets nothing
    const claim = await call(await login('real|new-1', e.email), 'POST', '/api/auth/claim', { token: tok });
    expect(claim.status).toBe(200);
    expect(claim.body).toMatchObject({ role: 'student', workspace: 'student' });
    const me = await call(await login('real|new-1', e.email), 'GET', '/api/me');
    expect(me.body).toMatchObject({ role: 'student', workspace: 'student' });
    expect((await call(await login('real|new-1', e.email), 'GET', '/api/v2/student/profile')).status).toBe(200);
    expect((await call(await login('real|new-1', e.email), 'GET', '/api/v2/tpo/invitations')).status).toBe(403); // and no more than that
    const audit = (await demo.db.admin.query<any>(`SELECT 1 FROM audit_events WHERE action = 'INVITATION_CLAIMED' AND metadata->>'role' = 'student'`)).rows;
    expect(audit.length).toBeGreaterThan(0);
  });

  it('sets age from the date of birth: a 16-year-old is a minor, so the camera rules do not apply to them', async () => {
    const e = student({ dateOfBirth: new Date(Date.now() - 16 * 365.25 * 864e5).toISOString().slice(0, 10) });
    const tok = tokenOf((await invite('tpo', [e])).body.results[0].claimUrl);
    const t = await login('real|minor-1', e.email);
    expect((await call(t, 'POST', '/api/auth/claim', { token: tok })).status).toBe(200);
    expect((await call(t, 'GET', '/api/v2/student/profile')).body.student.isMinor).toBe(true);
  });

  it('a link works once: a second person, or the same person, gets 409', async () => {
    const e = student();
    const tok = tokenOf((await invite('tpo', [e])).body.results[0].claimUrl);
    expect((await call(await login('real|a', e.email), 'POST', '/api/auth/claim', { token: tok })).status).toBe(200);
    expect((await call(await login('real|b', e.email), 'POST', '/api/auth/claim', { token: tok })).status).toBe(409);
    expect((await call(await login('real|a', e.email), 'POST', '/api/auth/claim', { token: tok })).status).toBe(409);
  });

  it('two people claiming at the same instant: exactly one wins', async () => {
    const e = student();
    const tok = tokenOf((await invite('tpo', [e])).body.results[0].claimUrl);
    const [x, y] = await Promise.all([
      login('real|race-1', e.email).then(t => call(t, 'POST', '/api/auth/claim', { token: tok })),
      login('real|race-2', e.email).then(t => call(t, 'POST', '/api/auth/claim', { token: tok })),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
  });

  it('rejects unknown, malformed, expired and revoked links', async () => {
    const t = await login('real|c', 'c@apex.test');
    expect((await call(t, 'POST', '/api/auth/claim', { token: 'x'.repeat(43) })).status).toBe(404);
    expect((await call(t, 'POST', '/api/auth/claim', { token: 'short' })).status).toBe(400);
    expect((await call(t, 'POST', '/api/auth/claim', {})).status).toBe(400);
    const e1 = student(); const r1 = (await invite('tpo', [e1])).body.results[0];
    await demo.db.admin.query(`UPDATE pending_invites SET expires_at = now() - interval '1 minute' WHERE id = $1`, [r1.id]);
    expect((await call(await login('real|d', e1.email), 'POST', '/api/auth/claim', { token: tokenOf(r1.claimUrl) })).status).toBe(410);
    const e2 = student(); const r2 = (await invite('tpo', [e2])).body.results[0];
    expect((await call(tokens.tpo, 'POST', `/api/v2/tpo/invitations/${r2.id}/revoke`)).status).toBe(200);
    expect((await call(await login('real|e', e2.email), 'POST', '/api/auth/claim', { token: tokenOf(r2.claimUrl) })).status).toBe(410);
  });

  it('needs a real, verified login: no token, a forged token, or an unverified email all fail', async () => {
    const e = student(); const tok = tokenOf((await invite('tpo', [e])).body.results[0].claimUrl);
    expect((await call(null, 'POST', '/api/auth/claim', { token: tok })).status).toBe(401);
    expect((await call('not.a.jwt', 'POST', '/api/auth/claim', { token: tok })).status).toBe(401);
    expect((await call(await login('real|f', e.email, { verified: false }), 'POST', '/api/auth/claim', { token: tok })).status).toBe(403);
    expect((await call(await login('real|g', 'someone.else@gmail.test'), 'POST', '/api/auth/claim', { token: tok })).status).toBe(403); // password login must be the invited address
    expect((await call(await login('real|h', e.email), 'POST', '/api/auth/claim', { token: tok })).status).toBe(200); // the link itself was not burned by the failures
  });

  it('GitHub sign-in can claim with a different email, because the one-time link proves the college inbox', async () => {
    const e = student(); const tok = tokenOf((await invite('tpo', [e])).body.results[0].claimUrl);
    const gh = await login('github|12345', 'private-github@users.noreply.test', { provider: 'github' });
    expect((await call(gh, 'POST', '/api/auth/claim', { token: tok })).status).toBe(200);
    expect((await call(gh, 'GET', '/api/me')).body.role).toBe('student');
  });

  it('refuses to merge two people: the college email already belongs to another login, and a second role in the same college', async () => {
    const e = student(); const tok = tokenOf((await invite('tpo', [e])).body.results[0].claimUrl);
    await demo.db.admin.query(`INSERT INTO users (auth_subject, email, full_name) VALUES ('other|owner', $1, 'Owner')`, [e.email]);
    expect((await call(await login('real|i', e.email), 'POST', '/api/auth/claim', { token: tok })).status).toBe(409);
    const s = student(); const st = tokenOf((await invite('tpo', [s])).body.results[0].claimUrl);
    expect((await call(await login('real|j', s.email), 'POST', '/api/auth/claim', { token: st })).status).toBe(200);
    const m = student({ role: 'mentor', email: s.email, enrollmentNo: undefined, dateOfBirth: undefined });
    const mt = tokenOf((await invite('tpo', [m])).body.results[0].claimUrl);
    expect((await call(await login('real|j', s.email), 'POST', '/api/auth/claim', { token: mt })).status).toBe(409);
  });

  it('a claimed officer invitation needs a college admin, and the new staff member gets only that role', async () => {
    const e = student({ role: 'mentor', departmentId: deptId });
    const tok = tokenOf((await invite('tpo', [e])).body.results[0].claimUrl);
    const t = await login('real|mentor-1', e.email);
    expect((await call(t, 'POST', '/api/auth/claim', { token: tok })).body.role).toBe('mentor');
    expect((await call(t, 'POST', '/api/v2/tpo/invitations', { invitations: [student()] })).status).toBe(403);
    expect((await call(t, 'GET', '/api/v2/student/profile')).status).toBe(403);
  });
});

describe('Recruiters', () => {
  it('can be invited, claim their link, and land in the recruiter workspace with recruiter access only', async () => {
    const e = { fullName: 'Rita Recruiter', email: `rita${Date.now()}@company.test`, role: 'recruiter' };
    const r = (await invite('tpo', [e])).body.results[0];
    expect(r.status).toBe(created);
    const t = await login('real|recruiter-1', e.email);
    const claim = await call(t, 'POST', '/api/auth/claim', { token: tokenOf(r.claimUrl) });
    expect(claim.body).toMatchObject({ role: 'recruiter', workspace: 'recruiter' });
    expect((await call(t, 'GET', '/api/me')).body).toMatchObject({ role: 'recruiter', workspace: 'recruiter' });
    expect((await call(t, 'GET', '/api/v2/recruiter/drives')).status).toBe(200);
    for (const url of ['/api/v2/tpo/invitations', '/api/v2/student/profile', '/api/v2/tpo/members']) expect((await call(t, 'GET', url)).status, url).toBe(403);
  });
});

describe('Colleges are separate', () => {
  it('another college cannot list, revoke or resend this college\'s invitations', async () => {
    const r = (await invite('tpo', [student()])).body.results[0];
    const theirs = (await call(tokens['tpo-poly'], 'GET', '/api/v2/tpo/invitations')).body.invitations;
    expect(theirs.find((x: any) => x.id === r.id)).toBeUndefined();
    expect((await call(tokens['tpo-poly'], 'POST', `/api/v2/tpo/invitations/${r.id}/revoke`)).status).toBe(404);
    expect((await call(tokens['tpo-poly'], 'POST', `/api/v2/tpo/invitations/${r.id}/resend`)).status).toBe(404);
  });

  it('resending kills the old link and gives a new one', async () => {
    const e = student(); const r = (await invite('tpo', [e])).body.results[0];
    const fresh = (await call(tokens.tpo, 'POST', `/api/v2/tpo/invitations/${r.id}/resend`)).body;
    expect(tokenOf(fresh.claimUrl)).not.toBe(tokenOf(r.claimUrl));
    expect((await call(await login('real|k', e.email), 'POST', '/api/auth/claim', { token: tokenOf(r.claimUrl) })).status).toBe(404);
    expect((await call(await login('real|k', e.email), 'POST', '/api/auth/claim', { token: tokenOf(fresh.claimUrl) })).status).toBe(200);
  });

  it('the invitation list never contains a link or token', async () => {
    const list = JSON.stringify((await call(tokens.tpo, 'GET', '/api/v2/tpo/invitations')).body);
    expect(list).not.toMatch(/claim#|token/i);
  });
});
