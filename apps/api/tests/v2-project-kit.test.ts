import { describe, it, expect, beforeAll } from 'vitest';
import { createDemoApp, DemoApp } from '../src/v2/demo.js';
import { FailoverLlm, LlmClient } from '../src/v2/llm.js';
import type { GhFetch } from '../src/v2/github-scan.js';

/**
 * The project interview kit end to end on the offline database (row-level security on), with a fake GitHub and a fake model
 * that deliberately returns some bad answers. Nothing here touches the network.
 */
const LOGIN = 'asha-dev';
const SECRET = 'AKIAABCDEFGHIJKLMNOP';
const files: Record<string, Record<string, string>> = {
  'campus-cab-share': {
    'README.md': '# Campus Cab Share\nA ride-sharing app for students with live seat matching using Socket.IO.',
    'package.json': JSON.stringify({ dependencies: { express: '^4', mongoose: '^7', jsonwebtoken: '^9', 'socket.io': '^4', react: '^18' } }),
    'server/routes/rides.js': `const router = require('express').Router();\nconst KEY = "${SECRET}";\nrouter.post('/', auth, async (req, res) => { /* book a seat */ });\n` + '// pad\n'.repeat(60),
    'server/models/Ride.js': 'const RideSchema = new Schema({ seats: Number, fare: Number });\n' + '// pad\n'.repeat(60),
    '.env': `SECRET=${SECRET}`,
  },
  'SmartAttendance': { 'README.md': 'Face recognition attendance with OpenCV and Flask.', 'requirements.txt': 'flask\nopencv-python\nnumpy', 'app.py': 'from flask import Flask\napp = Flask(__name__)\n' + '# pad\n'.repeat(80) },
  dotfiles: { 'README.md': 'my dotfiles' },
};
const repoMeta = (name: string, over: any = {}) => ({ name, full_name: `${LOGIN}/${name}`, html_url: `https://github.com/${LOGIN}/${name}`, description: null, language: 'JavaScript', topics: [], fork: false, archived: false, stargazers_count: 1, forks_count: 0, size: 200, pushed_at: '2026-05-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z', default_branch: 'main', homepage: null, ...over });

function fakeGitHub(opts: { rateLimited?: boolean; unreachable?: boolean; org?: boolean } = {}) {
  const calls: { path: string; token?: string }[] = [];
  const factory = (token?: string): GhFetch => async path => {
    calls.push({ path, token });
    const meta = { rateRemaining: 4000, rateLimit: 5000 };
    if (opts.unreachable) return { status: 0 };
    if (opts.rateLimited) return { status: 403, rateRemaining: 0, rateLimit: 60, rateReset: 1790000000 };
    if (path === `/users/${LOGIN}`) return { status: 200, ...meta, json: { login: LOGIN, name: 'Asha Patil', bio: 'student', public_repos: 3, followers: 4, created_at: '2023-01-01T00:00:00Z', type: opts.org ? 'Organization' : 'User' } };
    if (path.startsWith('/users/nobody')) return { status: 404, ...meta };
    if (path.startsWith(`/users/${LOGIN}/repos`)) return { status: 200, ...meta, json: [
      repoMeta('campus-cab-share', { description: 'Ride sharing for students', topics: ['nodejs', 'react'] }), repoMeta('SmartAttendance', { language: 'Python', description: 'Face recognition attendance' }), repoMeta('dotfiles', { language: 'Shell' })] };
    const m = new RegExp(`^/repos/${LOGIN}/([^/]+)/(languages|readme|git/trees/main|commits|contents/(.+))`).exec(path.split('?')[0]);
    if (!m) return { status: 404, ...meta };
    const repo = m[1]; const fs = files[repo];
    if (!fs) return { status: 404, ...meta };
    if (m[2] === 'languages') return { status: 200, ...meta, json: { JavaScript: 9000, CSS: 1000 } };
    if (m[2] === 'readme') return { status: 200, ...meta, text: fs['README.md'] };
    if (m[2] === 'git/trees/main') return { status: 200, ...meta, json: { truncated: false, tree: Object.entries(fs).map(([p, t]) => ({ path: p, type: 'blob', size: t.length })) } };
    if (m[2] === 'commits') return { status: 200, ...meta, json: [{ author: { login: LOGIN }, commit: { message: 'feat: seat booking\n\nbody', author: { date: '2026-04-01T00:00:00Z' } } }, { author: { login: 'friend' }, commit: { message: 'fix', author: { date: '2026-01-02T00:00:00Z' } } }] };
    const p = decodeURIComponent(m[3] ?? '');
    return fs[p] !== undefined ? { status: 200, ...meta, text: fs[p] } : { status: 404, ...meta };
  };
  return { factory, calls };
}

function fakeLlm(handlers: { extract?: (u: string) => string | null; questions?: (u: string) => string | null }) {
  const seen: { system: string; user: string }[] = [];
  const client: LlmClient = { name: 'llm:groq:fake', async complete(system, user) { seen.push({ system, user }); return /Projects section of a resume/.test(system) ? (handlers.extract?.(user) ?? null) : (handlers.questions?.(user) ?? null); } };
  return { llm: new FailoverLlm([client]), seen };
}
const goodExtract = () => JSON.stringify({ projects: [
  { name: 'Campus Cab Share', summary: 'Ride sharing app for students with live seat matching.', tech: ['React', 'Node.js', 'MongoDB'] },
  { name: 'Smart Attendance System', summary: 'Face recognition attendance.', tech: ['Python', 'OpenCV'] },
  { name: 'Hospital Queue Planner', summary: 'Scheduling for outpatient clinics.', tech: ['Java'] },
] });
const modelQuestions = () => JSON.stringify({ questions: [
  { level: 'medium', question: 'In rides.js, how do you stop two riders booking the same seat at the same time?', evidence: 'server/routes/rides.js', lookFor: ['Mentions a lock, unique index or transaction', 'Handles the losing request'], followUp: 'What happens if the server restarts mid-request?', focus: 'code' },
  { level: 'medium', question: 'Explain the retry logic in server/utils/retry.js that you wrote for payments?', evidence: 'server/utils/retry.js', lookFor: ['a thing', 'another thing'], focus: 'code' },
  { level: 'hard', question: 'Which part of the app breaks first with 100 times more riders, and what would you change first?', evidence: null, lookFor: ['A real bottleneck', 'A sensible order'], followUp: 'How would you measure it?', focus: 'scale' },
] });
const RESUME = 'PROJECTS\nCampus Cab Share | React, Node.js\n• Ride sharing app for students.\nSmart Attendance System – Python, OpenCV\n• Face recognition attendance.\nHospital Queue Planner | Java\n• Scheduling for clinics.\nSKILLS\nJava';

let demo: DemoApp; let gh: ReturnType<typeof fakeGitHub>; let ai: ReturnType<typeof fakeLlm>;
const tokens: Record<string, string> = {};
async function call(who: string | null, method: 'GET' | 'POST', url: string, body?: unknown) {
  const res = await demo.app.inject({ method, url, headers: who ? { authorization: `Bearer ${tokens[who] ?? who}` } : {}, payload: body as any });
  let json: any; try { json = JSON.parse(res.payload); } catch { json = res.payload; }
  return { status: res.statusCode, body: json };
}
let driveId = '', studentId = '';

beforeAll(async () => {
  gh = fakeGitHub();
  ai = fakeLlm({ extract: goodExtract, questions: modelQuestions });
  demo = await createDemoApp({ llm: ai.llm, kit: { githubFetch: gh.factory, pdfToText: async () => RESUME } });
  for (const p of ['recruiter', 'rahul', 'tpo', 'university']) tokens[p] = await demo.tokenFor(p);
  driveId = (await call('recruiter', 'GET', '/api/v2/recruiter/drives')).body.drives[0].id;
  studentId = (await call('recruiter', 'GET', `/api/v2/recruiter/kit/candidates?driveId=${driveId}`)).body.candidates[0].id;
}, 300_000);

describe('Who can use the kit', () => {
  it('only a recruiter with a grant for the drive, and only for candidates who share with recruiters', async () => {
    for (const who of ['rahul', 'tpo', 'university']) expect((await call(who, 'GET', `/api/v2/recruiter/kit/candidates?driveId=${driveId}`)).status, who).toBe(403);
    expect((await call(null, 'GET', `/api/v2/recruiter/kit/candidates?driveId=${driveId}`)).status).toBe(401);
    expect((await call('recruiter', 'GET', '/api/v2/recruiter/kit/candidates?driveId=00000000-0000-0000-0000-000000000000')).status).toBe(403);
    const body = { driveId, studentId: '00000000-0000-0000-0000-000000000000', githubProfile: `https://github.com/${LOGIN}`, resumeText: RESUME };
    expect((await call('recruiter', 'POST', '/api/v2/recruiter/kit/scan', body)).status).toBe(403);
    expect((await call('rahul', 'POST', '/api/v2/recruiter/kit/scan', { ...body, studentId })).status).toBe(403);
  });
});

describe('Scanning a candidate', () => {
  let kit: any;
  it('finds the highlighted projects among the public repositories, with reasons, and says plainly when one is not found', async () => {
    const r = await call('recruiter', 'POST', '/api/v2/recruiter/kit/scan', { driveId, studentId, githubProfile: `github.com/${LOGIN}/`, resumeText: RESUME });
    expect(r.status).toBe(200);
    kit = r.body;
    expect(kit.github).toMatchObject({ login: LOGIN, name: 'Asha Patil', publicRepos: 3 });
    expect(kit.extraction).toBe('llm:groq:fake');
    expect(kit.projects.map((p: any) => [p.name, p.status, p.match?.repo ?? null])).toEqual([
      ['Campus Cab Share', 'matched', 'campus-cab-share'], ['Smart Attendance System', 'matched', 'SmartAttendance'], ['Hospital Queue Planner', 'not_found', null]]);
    expect(kit.projects[0].match.reasons.length).toBeGreaterThan(0);
    expect(kit.projects[0].scanned.samplePaths).toEqual(expect.arrayContaining(['server/routes/rides.js']));
    expect(kit.projects[0].scanned.repoTech).toEqual(expect.arrayContaining(['Express', 'MongoDB', 'JWT', 'Socket.IO']));
    expect(kit.projects[0].scanned.commits).toMatchObject({ seen: 2, byCandidate: 1 });
    expect(kit.scan).toMatchObject({ reposTotal: 3, rateLimited: false, token: 'none' });
    expect(kit.github.nameCheck).toMatch(/same|different|unknown/);
  });

  it('never reads environment files, never shows stored code excerpts to the browser, and keeps secrets out of what is stored and what the model sees', async () => {
    expect(gh.calls.some(c => /\.env/.test(c.path))).toBe(false);
    expect(JSON.stringify(kit)).not.toContain(SECRET);
    expect(JSON.stringify(kit)).not.toContain('router.post'); // excerpts are stored for question writing but not returned
    const row = (await demo.db.admin.query<any>(`SELECT projects, resume_sha256, models FROM project_kits WHERE id = $1`, [kit.id])).rows[0];
    expect(JSON.stringify(row.projects)).not.toContain(SECRET);
    expect(JSON.stringify(row.projects)).toContain('REDACTED');
    expect(row.resume_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain('Hospital Queue Planner|'); // the resume text itself is not stored
    expect(JSON.stringify(row)).not.toMatch(/SKILLS\nJava/);
  });

  it('sends the model only the project section, never the contact details around it', async () => {
    const withContacts = `ASHA PATIL asha@college.edu +91 98765 43210\n\n${RESUME}`;
    await call('recruiter', 'POST', '/api/v2/recruiter/kit/scan', { driveId, studentId, githubProfile: LOGIN, resumeText: withContacts });
    const sent = ai.seen.filter(s => /Projects section of a resume/.test(s.system)).map(s => s.user).join('\n');
    expect(sent).toContain('Campus Cab Share');
    expect(sent).not.toMatch(/asha@college|98765|ASHA PATIL/);
  });

  it('uses the recruiter\'s GitHub sign-in token when given, ignores junk, and never stores or returns it', async () => {
    const token = 'gho_' + 'a'.repeat(36);
    const r = await call('recruiter', 'POST', '/api/v2/recruiter/kit/scan', { driveId, studentId, githubProfile: LOGIN, resumeText: RESUME, githubToken: token });
    expect(r.body.scan.token).toBe('recruiter');
    expect(gh.calls.some(c => c.token === token)).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain(token);
    const stored = JSON.stringify((await demo.db.admin.query<any>(`SELECT * FROM project_kits ORDER BY created_at DESC LIMIT 1`)).rows[0]);
    expect(stored).not.toContain(token);
    const junk = await call('recruiter', 'POST', '/api/v2/recruiter/kit/scan', { driveId, studentId, githubProfile: LOGIN, resumeText: RESUME, githubToken: 'not a token' });
    expect(junk.body.scan.token).toBe('none');
  });

  it('refuses bad input clearly', async () => {
    const base = { driveId, studentId, githubProfile: `https://github.com/${LOGIN}`, resumeText: RESUME };
    const bad = async (over: any) => (await call('recruiter', 'POST', '/api/v2/recruiter/kit/scan', { ...base, ...over }));
    expect((await bad({ githubProfile: 'https://example.com/x' })).status).toBe(400);
    expect((await bad({ githubProfile: 'nobody' })).status).toBe(404);
    expect((await bad({ resumeText: 'short' })).status).toBe(400);
    expect((await bad({ resumeText: 'x'.repeat(90_000) })).status).toBe(413);
    expect((await bad({ resumeText: 'No projects here at all, only a long paragraph about my hobbies and interests and travel.' , githubProfile: LOGIN })).status).toBeGreaterThanOrEqual(200);
    expect((await bad({ resumeText: '', resumePdfBase64: Buffer.from('not a pdf at all').toString('base64') })).status).toBe(400);
  });

  it('reads a PDF resume, including one larger than the default request size', async () => {
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1_300_000, 65)]).toString('base64');
    const r = await call('recruiter', 'POST', '/api/v2/recruiter/kit/scan', { driveId, studentId, githubProfile: LOGIN, resumeText: '', resumePdfBase64: pdf });
    expect(r.status).toBe(200);
    expect(r.body.projects).toHaveLength(3);
    const src = (await demo.db.admin.query<any>(`SELECT resume_source FROM project_kits WHERE id = $1`, [r.body.id])).rows[0].resume_source;
    expect(src).toBe('pdf');
  });
});

describe('GitHub trouble', () => {
  const scanWith = async (g: ReturnType<typeof fakeGitHub>) => {
    const app = await createDemoApp({ llm: null, kit: { githubFetch: g.factory } });
    const t = await app.tokenFor('recruiter');
    const d = (await app.app.inject({ method: 'GET', url: '/api/v2/recruiter/drives', headers: { authorization: `Bearer ${t}` } })).json().drives[0].id;
    const s = (await app.app.inject({ method: 'GET', url: `/api/v2/recruiter/kit/candidates?driveId=${d}`, headers: { authorization: `Bearer ${t}` } })).json().candidates[0].id;
    const res = await app.app.inject({ method: 'POST', url: '/api/v2/recruiter/kit/scan', headers: { authorization: `Bearer ${t}` }, payload: { driveId: d, studentId: s, githubProfile: LOGIN, resumeText: RESUME } });
    return { status: res.statusCode, body: res.json() };
  };
  it('says when the request limit is reached, when GitHub is unreachable, and when the address is an organisation', async () => {
    const limited = await scanWith(fakeGitHub({ rateLimited: true }));
    expect(limited.status).toBe(429);
    expect(limited.body.error).toMatch(/sign in with GitHub|token/i);
    expect((await scanWith(fakeGitHub({ unreachable: true }))).status).toBe(502);
    expect((await scanWith(fakeGitHub({ org: true }))).status).toBe(400);
  }, 120_000);
});

describe('Questions', () => {
  let kit: any;
  beforeAll(async () => { kit = (await call('recruiter', 'POST', '/api/v2/recruiter/kit/scan', { driveId, studentId, githubProfile: LOGIN, resumeText: RESUME })).body; });

  it('drafts easy, medium and hard questions; keeps good model questions, drops invented files, fills gaps with labelled templates', async () => {
    const r = await call('recruiter', 'POST', `/api/v2/recruiter/kit/${kit.id}/questions`, { projectIndex: 0, perLevel: 3 });
    expect(r.status).toBe(200);
    const q = r.body.questions;
    expect(q.source).toBe('mixed');
    expect(q.model).toBe('llm:groq:fake');
    for (const level of ['easy', 'medium', 'hard']) expect(q.items.filter((x: any) => x.level === level)).toHaveLength(3);
    const ai = q.items.filter((x: any) => x.source === 'ai');
    expect(ai.map((x: any) => x.evidence)).toEqual(['server/routes/rides.js', null]);
    expect(q.items.some((x: any) => /retry\.js/.test(x.question))).toBe(false); // the file the model invented
    const known = new Set(kit.projects[0].scanned.samplePaths.concat(['README.md', 'package.json', 'server/routes/rides.js', 'server/models/Ride.js']));
    expect(q.items.every((x: any) => x.evidence === null || known.has(x.evidence))).toBe(true);
    expect(q.items.every((x: any) => x.lookFor.length >= 2)).toBe(true);
  });

  it('gives only template questions, and says so, for a project with no repository, and when no model is configured', async () => {
    const r = await call('recruiter', 'POST', `/api/v2/recruiter/kit/${kit.id}/questions`, { projectIndex: 2, perLevel: 2 });
    expect(r.body.questions.items.every((x: any) => x.evidence === null)).toBe(true);
    const app = await createDemoApp({ llm: null, kit: { githubFetch: gh.factory } });
    const t = await app.tokenFor('recruiter');
    const h = { authorization: `Bearer ${t}` };
    const d = (await app.app.inject({ method: 'GET', url: '/api/v2/recruiter/drives', headers: h })).json().drives[0].id;
    const s = (await app.app.inject({ method: 'GET', url: `/api/v2/recruiter/kit/candidates?driveId=${d}`, headers: h })).json().candidates[0].id;
    const k = (await app.app.inject({ method: 'POST', url: '/api/v2/recruiter/kit/scan', headers: h, payload: { driveId: d, studentId: s, githubProfile: LOGIN, resumeText: RESUME } })).json();
    expect(k.extraction).toBe('rules');
    expect(k.projects.length).toBeGreaterThanOrEqual(2);
    const q = (await app.app.inject({ method: 'POST', url: `/api/v2/recruiter/kit/${k.id}/questions`, headers: h, payload: { projectIndex: 0, perLevel: 2 } })).json();
    expect(q.questions.source).toBe('template');
    expect(q.questions.model).toBeNull();
  }, 120_000);

  it('survives a model that returns nonsense', async () => {
    const bad = await createDemoApp({ llm: fakeLlm({ extract: () => 'not json', questions: () => '{"questions": "nope"}' }).llm, kit: { githubFetch: gh.factory } });
    const t = await bad.tokenFor('recruiter'); const h = { authorization: `Bearer ${t}` };
    const d = (await bad.app.inject({ method: 'GET', url: '/api/v2/recruiter/drives', headers: h })).json().drives[0].id;
    const s = (await bad.app.inject({ method: 'GET', url: `/api/v2/recruiter/kit/candidates?driveId=${d}`, headers: h })).json().candidates[0].id;
    const k = (await bad.app.inject({ method: 'POST', url: '/api/v2/recruiter/kit/scan', headers: h, payload: { driveId: d, studentId: s, githubProfile: LOGIN, resumeText: RESUME } })).json();
    expect(k.extraction).toBe('rules');
    const q = (await bad.app.inject({ method: 'POST', url: `/api/v2/recruiter/kit/${k.id}/questions`, headers: h, payload: { projectIndex: 0 } })).json();
    expect(q.questions.source).toBe('template');
  }, 120_000);

  it('rejects an unknown project and keeps a project\'s questions when another is generated', async () => {
    expect((await call('recruiter', 'POST', `/api/v2/recruiter/kit/${kit.id}/questions`, { projectIndex: 9 })).status).toBe(400);
    await call('recruiter', 'POST', `/api/v2/recruiter/kit/${kit.id}/questions`, { projectIndex: 0, perLevel: 1 });
    await call('recruiter', 'POST', `/api/v2/recruiter/kit/${kit.id}/questions`, { projectIndex: 1, perLevel: 1 });
    const saved = (await call('recruiter', 'GET', `/api/v2/recruiter/kit/${kit.id}`)).body;
    expect(saved.projects[0].questions.items.length).toBe(3);
    expect(saved.projects[1].questions.items.length).toBe(3);
  });
});

describe('Privacy', () => {
  it('a kit belongs to the recruiter who made it', async () => {
    const kit = (await call('recruiter', 'POST', '/api/v2/recruiter/kit/scan', { driveId, studentId, githubProfile: LOGIN, resumeText: RESUME })).body;
    const org = (await demo.db.admin.query<any>(`SELECT m.org_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.auth_subject = 'demo|recruiter-1' LIMIT 1`)).rows[0].org_id;
    await demo.db.admin.query(`INSERT INTO users (auth_subject, email, full_name) VALUES ('demo|kit-other-recruiter', 'kit-other@demo.pramaan.invalid', 'Other Recruiter')`);
    await demo.db.admin.query(`INSERT INTO memberships (user_id, org_id, role) SELECT id, $1, 'recruiter' FROM users WHERE auth_subject = 'demo|kit-other-recruiter'`, [org]);
    const other = await demo.tokenForSubject('demo|kit-other-recruiter');
    expect((await call(other, 'GET', `/api/v2/recruiter/kit/${kit.id}`)).status).toBe(404);
    expect((await call(other, 'POST', `/api/v2/recruiter/kit/${kit.id}/questions`, { projectIndex: 0 })).status).toBe(404);
    expect((await call(other, 'GET', '/api/v2/recruiter/kit')).body.kits).toEqual([]);
    expect((await call('recruiter', 'GET', '/api/v2/recruiter/kit')).body.kits.length).toBeGreaterThan(0);
  });

  it('withdrawing recruiter-sharing consent deletes every kit about that student', async () => {
    const before = (await demo.db.admin.query<any>(`SELECT count(*)::int AS n FROM project_kits WHERE student_id = $1`, [studentId])).rows[0].n;
    expect(before).toBeGreaterThan(0);
    const sub = (await demo.db.admin.query<any>(`SELECT u.auth_subject FROM students s JOIN users u ON u.id = s.user_id WHERE s.id = $1`, [studentId])).rows[0].auth_subject;
    const st = await demo.tokenForSubject(sub);
    const r = await call(st, 'POST', '/api/v2/student/consents', { purpose: 'recruiter_sharing', action: 'revoke' });
    expect(r.status).toBe(200);
    expect((await demo.db.admin.query<any>(`SELECT count(*)::int AS n FROM project_kits WHERE student_id = $1`, [studentId])).rows[0].n).toBe(0);
    // and the candidate is no longer available for new kits
    expect((await call('recruiter', 'POST', '/api/v2/recruiter/kit/scan', { driveId, studentId, githubProfile: LOGIN, resumeText: RESUME })).status).toBe(403);
  });
});
