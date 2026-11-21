import { describe, it, expect } from 'vitest';
import {
  parseGitHubProfile, techFromText, techFromManifests, scrubSecrets, isSensitivePath, redactPersonalData, extractProjectsHeuristic,
  projectSectionForModel, matchProject, nameTokens, validateQuestions, completeSet, templateQuestions, limitPerLevel, ProjectFacts, RepoLite,
} from '../src/project-kit.js';

describe('GitHub profile link', () => {
  it('reads profile links, repository links, handles and @handles', () => {
    for (const s of ['https://github.com/octocat', 'http://www.github.com/octocat/', 'github.com/octocat?tab=repositories', 'https://github.com/octocat/Hello-World', '@octocat', 'octocat', ' octocat '])
      expect(parseGitHubProfile(s), s).toBe('octocat');
  });
  it('refuses anything that is not a GitHub user', () => {
    for (const s of ['', 'https://example.com/octocat', 'https://github.com/', 'https://github.com/orgs/foo', 'bad name', '-start', 'end-', 'a--b', 'x'.repeat(40), 'https://gitlab.com/octocat', 'javascript:alert(1)'])
      expect(parseGitHubProfile(s), s).toBeNull();
  });
});

describe('technology detection', () => {
  it('finds technologies named in text', () => {
    expect(techFromText('Built with React, Node.js, Express and MongoDB; deployed on AWS using Docker')).toEqual(expect.arrayContaining(['React', 'Node.js', 'Express', 'MongoDB', 'AWS', 'Docker']));
    expect(techFromText('Java and JavaScript')).toEqual(expect.arrayContaining(['Java', 'JavaScript']));
    expect(techFromText('React Native app')).toContain('React Native');
  });
  it('reads dependency files', () => {
    const t = techFromManifests([
      { path: 'package.json', text: JSON.stringify({ dependencies: { express: '^4', mongoose: '^7', jsonwebtoken: '^9' }, devDependencies: { jest: '^29' } }) },
      { path: 'server/requirements.txt', text: 'Flask==2.3\nnumpy>=1.2\n# c\n' },
      { path: 'pom.xml', text: '<artifactId>spring-boot-starter-web</artifactId>' },
      { path: 'Dockerfile', text: 'FROM node' },
      { path: 'package.json', text: '{broken' },
    ]);
    expect(t).toEqual(expect.arrayContaining(['Express', 'MongoDB', 'JWT', 'Jest', 'Flask', 'NumPy', 'Spring Boot', 'Docker', 'Python', 'Java']));
  });
});

describe('keeping secrets and personal data out', () => {
  it('scrubs keys, tokens and passwords from code', () => {
    const src = [`const key = "AKIAABCDEFGHIJKLMNOP";`, `token: 'ghp_${'a'.repeat(36)}'`, `password = "hunter2hunter2"`, `db = "postgres://user:s3cretpass@host/db"`,
      `const g = "gsk_${'b'.repeat(30)}"`, '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----', 'const answer = 42;'].join('\n');
    const out = scrubSecrets(src);
    for (const leak of ['AKIAABCDEFGHIJKLMNOP', 'hunter2hunter2', 's3cretpass', 'abc\n-----END']) expect(out).not.toContain(leak);
    expect(out).not.toMatch(/ghp_a{10}|gsk_b{10}/);
    expect(out).toContain('const answer = 42;');
  });
  it('never reads environment, key or credential files', () => {
    for (const p of ['.env', 'server/.env.production', 'config/id_rsa', 'cert/server.pem', 'src/secrets.json', 'firebase-adminsdk-abc.json', '.npmrc']) expect(isSensitivePath(p), p).toBe(true);
    for (const p of ['src/index.js', 'README.md', 'env.example.md', 'package.json', 'src/keys.ts']) expect(isSensitivePath(p), p).toBe(false);
  });
  it('removes emails, phone numbers and links from resume text but keeps GitHub project links', () => {
    const out = redactPersonalData('Asha asha.p@college.edu +91 98765 43210 https://linkedin.com/in/asha https://asha.dev/x https://github.com/asha/shop-api');
    expect(out).not.toMatch(/college\.edu|98765|linkedin|asha\.dev/);
    expect(out).toContain('https://github.com/asha/shop-api');
  });
});

const RESUME = `ASHA PATIL
asha@college.edu | +91 98765 43210

EDUCATION
B.E. Computer Engineering, VPPCOE, 2027

PROJECTS
Campus Cab Share | React, Node.js, MongoDB
• Built a ride-sharing app for students with live seat matching using Socket.IO.
• Implemented JWT login and a fare-split calculator.
Smart Attendance System – Python, OpenCV
• Face recognition attendance using OpenCV and a Flask dashboard.

TECHNICAL SKILLS
Java, Python, SQL`;

describe('resume projects', () => {
  it('finds the projects, their technology and their description, and stops at the next section', () => {
    const p = extractProjectsHeuristic(RESUME);
    expect(p.map(x => x.name)).toEqual(['Campus Cab Share', 'Smart Attendance System']);
    expect(p[0].tech).toEqual(expect.arrayContaining(['React', 'Node.js', 'MongoDB', 'Socket.IO', 'JWT']));
    expect(p[1].tech).toEqual(expect.arrayContaining(['Python', 'OpenCV', 'Flask']));
    expect(p[0].summary).toContain('ride-sharing');
  });
  it('returns nothing rather than guessing when there is no project section', () => {
    expect(extractProjectsHeuristic('Just a paragraph about me.')).toEqual([]);
    expect(extractProjectsHeuristic('')).toEqual([]);
  });
  it('sends only the project section to a model, with contact details removed', () => {
    const s = projectSectionForModel(RESUME);
    expect(s).toContain('Campus Cab Share');
    expect(s).not.toMatch(/asha@college|98765|EDUCATION|TECHNICAL SKILLS|Java, Python, SQL/);
  });
});

const repos: RepoLite[] = [
  { name: 'campus-cab-share', description: 'Ride sharing for students', topics: ['nodejs', 'react'], language: 'JavaScript', fork: false, stars: 2, pushedAt: '2026-05-01', readme: 'A ride-sharing app with live seat matching using Socket.IO', tech: ['React', 'Node.js', 'Socket.IO'] },
  { name: 'SmartAttendance', description: 'Face recognition attendance', topics: ['opencv'], language: 'Python', fork: false, stars: 0, pushedAt: '2026-03-01', tech: ['Python', 'OpenCV', 'Flask'] },
  { name: 'dotfiles', description: null, topics: [], language: 'Shell', fork: false, stars: 0, pushedAt: null },
  { name: 'react', description: 'The library for web and native user interfaces', topics: [], language: 'JavaScript', fork: true, stars: 0, pushedAt: null },
];

describe('matching a resume project to a repository', () => {
  const [cab, att] = extractProjectsHeuristic(RESUME);
  it('names and splits words the way people write them', () => {
    expect(nameTokens('campus-cab-share')).toEqual(['campus', 'cab', 'share']);
    expect(nameTokens('SmartAttendanceSystem')).toEqual(['smart', 'attendance']);
  });
  it('finds the right repository with reasons, even when the names are written differently', () => {
    const a = matchProject(cab, repos);
    expect(a[0]).toMatchObject({ repo: 'campus-cab-share', strength: 'strong' });
    expect(a[0].reasons.join(' ')).toMatch(/name/i);
    const b = matchProject(att, repos);
    expect(b[0]).toMatchObject({ repo: 'SmartAttendance', strength: 'strong' });
  });
  it('returns nothing for a project that is not on GitHub, and does not match unrelated repositories', () => {
    expect(matchProject({ name: 'Hospital Queue Planner', summary: 'Scheduling for outpatient clinics', tech: ['Java'] }, repos)).toEqual([]);
  });
  it('says so when the best match is a fork', () => {
    const m = matchProject({ name: 'react', summary: '', tech: [] }, repos);
    expect(m[0].reasons.join(' ')).toMatch(/fork/i);
  });
});

const facts: ProjectFacts = {
  name: 'Campus Cab Share', summary: 'Ride sharing for students', tech: ['React', 'Node.js', 'MongoDB', 'JWT'],
  repo: { name: 'campus-cab-share', description: 'Ride sharing', url: 'https://github.com/asha/campus-cab-share', fork: false, matched: true },
  readmeExcerpt: 'A ride-sharing app', files: ['server/routes/rides.js', 'server/models/Ride.js', 'client/src/App.jsx', 'README.md'],
  samples: [{ path: 'server/routes/rides.js', excerpt: 'router.post("/", auth, async (req,res)=>{})' }, { path: 'server/models/Ride.js', excerpt: 'const RideSchema = new Schema({})' }],
  hasTests: false, hasCI: false, hasDocker: false, commits: { seen: 20, byCandidate: 18, first: '2026-01-01', last: '2026-04-01' },
};
const ev = new Set(facts.files);

describe('questions', () => {
  it('keeps good questions and drops invented files, thin answers and repeats', () => {
    const raw = { questions: [
      { level: 'medium', question: 'In rides.js, how do you stop two riders booking the same seat?', evidence: 'server/routes/rides.js', lookFor: ['Mentions a lock, unique index or transaction', 'Handles the second request'], followUp: 'What if the server restarts mid-request?', focus: 'code' },
      { level: 'hard', question: 'Which part of the app breaks first at 100x users and why?', evidence: null, lookFor: ['A real bottleneck', 'A sensible order of fixes'], focus: 'scale' },
      { level: 'medium', question: 'Explain the function in server/utils/hack.js that you wrote?', evidence: 'server/utils/hack.js', lookFor: ['a', 'b'] },
      { level: 'easy', question: 'Too short', evidence: null, lookFor: ['x'] },
      { level: 'expert', question: 'What is the hardest part of this project in your view?', evidence: null, lookFor: ['one', 'two'] },
      { level: 'hard', question: 'Which part of the app breaks first at 100x users and why?', evidence: null, lookFor: ['A real bottleneck', 'A sensible order of fixes'] },
    ] };
    const { questions, dropped } = validateQuestions(raw, ev);
    expect(questions.map(q => q.focus)).toEqual(['code', 'scale']);
    expect(questions[0]).toMatchObject({ source: 'ai', evidence: 'server/routes/rides.js', followUp: 'What if the server restarts mid-request?' });
    expect(dropped).toBe(4);
  });
  it('rejects non-object answers without throwing', () => {
    for (const raw of [null, undefined, 'text', 42, {}, { questions: 'x' }]) expect(validateQuestions(raw, ev)).toEqual({ questions: [], dropped: 0 });
  });
  it('templates cover every level and only cite files that were read', () => {
    const t = templateQuestions(facts);
    for (const level of ['easy', 'medium', 'hard']) expect(t.filter(q => q.level === level).length).toBeGreaterThanOrEqual(3);
    expect(t.every(q => q.evidence === null || ev.has(q.evidence))).toBe(true);
    expect(t.every(q => q.source === 'template' && q.lookFor.length >= 2)).toBe(true);
    expect(t.find(q => q.focus === 'testing')!.question).toMatch(/no tests/i);
  });
  it('completes a partial model answer to the requested number per level, labelled by source', () => {
    const model = validateQuestions({ questions: [{ level: 'hard', question: 'Which part of the app breaks first at 100x users and why?', evidence: null, lookFor: ['bottleneck', 'order'], focus: 'scale' }] }, ev).questions;
    const set = completeSet(model, facts, 3);
    for (const level of ['easy', 'medium', 'hard']) expect(set.filter(q => q.level === level)).toHaveLength(3);
    expect(set.filter(q => q.source === 'ai')).toHaveLength(1);
    const hardScale = set.filter(q => q.level === 'hard' && q.focus === 'scale');
    expect(hardScale).toHaveLength(1); // the template for scale is not added on top of the model's
  });
  it('limits per level', () => {
    const t = templateQuestions(facts);
    const l = limitPerLevel(t, 2);
    for (const level of ['easy', 'medium', 'hard']) expect(l.filter(q => q.level === level)).toHaveLength(2);
  });
});
