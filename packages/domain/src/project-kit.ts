/**
 * Project interview kit: pure logic for turning a candidate's GitHub projects and resume into interview questions a person can ask.
 * No network, no database. The API fetches the data and calls a language model; everything checkable lives here so it can be tested.
 *
 * Design rules (from the problem statement and the interview research in docs/PLAN_REAL_AUTH_GITHUB_VERCEL.md):
 *  - A model only proposes. Every question carries the file it is based on, and a question that points at a file we never read is dropped.
 *  - Nothing here scores or judges the candidate, and nothing here guesses whether code was written by an AI.
 *  - Repository text and resume text are data, never instructions.
 */

// ---------------------------------------------------------------------------
// GitHub profile link
// ---------------------------------------------------------------------------

const RESERVED = new Set(['orgs', 'settings', 'login', 'about', 'pricing', 'features', 'enterprise', 'marketplace', 'sponsors', 'topics', 'explore', 'notifications', 'new', 'search', 'apps', 'collections', 'trending', 'events', 'issues', 'pulls', 'codespaces', 'readme', 'security', 'site', 'customer-stories']);

/** Accepts a profile link, a repository link, `@name` or a bare name, and returns the GitHub login, or null when it is not one. */
export function parseGitHubProfile(input: string): string | null {
  let s = String(input ?? '').trim();
  if (!s || s.length > 300) return null;
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/?#\s]+)/i.exec(s);
  if (m) s = m[1];
  else if (/[/\s:]/.test(s)) return null;
  s = s.replace(/^@/, '');
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(s)) return null;
  if (RESERVED.has(s.toLowerCase())) return null;
  return s;
}

// ---------------------------------------------------------------------------
// Technology vocabulary
// ---------------------------------------------------------------------------

const TECH: [string, RegExp][] = [
  ['JavaScript', /\bjavascript\b|\bjs\b(?!on)/i], ['TypeScript', /\btypescript\b|\bts\b/i], ['React', /\breact(?:\.?js)?\b(?!\s*native)/i], ['React Native', /\breact[\s-]?native\b/i],
  ['Next.js', /\bnext\.?js\b/i], ['Node.js', /\bnode(?:\.?js)?\b/i], ['Express', /\bexpress(?:\.?js)?\b/i], ['Vue', /\bvue(?:\.?js)?\b/i], ['Angular', /\bangular(?:js)?\b/i],
  ['Redux', /\bredux\b/i], ['HTML', /\bhtml5?\b/i], ['CSS', /\bcss3?\b/i], ['Tailwind CSS', /\btailwind(?:\s?css)?\b/i], ['Bootstrap', /\bbootstrap\b/i],
  ['Python', /\bpython\b/i], ['Django', /\bdjango\b/i], ['Flask', /\bflask\b/i], ['FastAPI', /\bfastapi\b/i], ['Streamlit', /\bstreamlit\b/i], ['Tkinter', /\btkinter\b/i],
  ['Java', /\bjava\b(?!\s*script)/i], ['Spring Boot', /\bspring(?:\s?boot)?\b/i], ['Hibernate', /\bhibernate\b/i], ['Kotlin', /\bkotlin\b/i], ['Android', /\bandroid\b/i],
  ['Flutter', /\bflutter\b/i], ['Dart', /\bdart\b/i], ['Swift', /\bswift(?:ui)?\b/i], ['C', /(?:^|[\s,(/])C(?=[\s,)/.;]|$)/], ['C++', /\bc\+\+|\bcpp\b/i], ['C#', /\bc#|\bcsharp\b/i],
  ['PHP', /\bphp\b/i], ['Laravel', /\blaravel\b/i], ['Go', /\bgolang\b|\bgo\s?lang\b/i], ['Rust', /\brust\b/i], ['SQL', /\bsql\b/i], ['MySQL', /\bmysql\b/i], ['PostgreSQL', /\bpostgres(?:ql)?\b/i],
  ['SQLite', /\bsqlite\b/i], ['MongoDB', /\bmongo(?:db)?\b|\bmongoose\b/i], ['Firebase', /\bfirebase\b/i], ['Redis', /\bredis\b/i], ['GraphQL', /\bgraphql\b/i], ['REST API', /\brest(?:ful)?(?:\s?api)?s?\b/i],
  ['JWT', /\bjwt\b|\bjson web token\b/i], ['Socket.IO', /\bsocket\.?io\b|\bwebsockets?\b/i], ['Docker', /\bdocker\b/i], ['Kubernetes', /\bkubernetes\b|\bk8s\b/i], ['AWS', /\baws\b|\bamazon web services\b/i],
  ['Azure', /\bazure\b/i], ['GCP', /\bgcp\b|\bgoogle cloud\b/i], ['Git', /\bgit\b(?!hub)/i], ['CI/CD', /\bci\/cd\b|\bgithub actions\b|\bjenkins\b/i], ['TensorFlow', /\btensorflow\b|\bkeras\b/i], ['PyTorch', /\bpytorch\b|\btorch\b/i],
  ['scikit-learn', /\bscikit[\s-]?learn\b|\bsklearn\b/i], ['Pandas', /\bpandas\b/i], ['NumPy', /\bnumpy\b/i], ['OpenCV', /\bopencv\b/i], ['NLP', /\bnlp\b|\bnatural language\b/i], ['Machine Learning', /\bmachine learning\b|\bml\b/i],
  ['Deep Learning', /\bdeep learning\b|\bcnn\b|\blstm\b/i], ['Arduino', /\barduino\b/i], ['Raspberry Pi', /\braspberry\s?pi\b/i], ['ESP32', /\besp(?:32|8266)\b/i], ['IoT', /\biot\b|\binternet of things\b/i],
  ['Selenium', /\bselenium\b/i], ['Jest', /\bjest\b/i], ['Unity', /\bunity\b/i], ['Blockchain', /\bblockchain\b|\bsolidity\b|\bethereum\b/i], ['Prisma', /\bprisma\b/i], ['Sequelize', /\bsequelize\b/i],
];

/** Technologies named in free text (a resume line, a README), in a stable order. */
export function techFromText(text: string): string[] {
  const t = String(text ?? '');
  const out: string[] = [];
  for (const [name, re] of TECH) if (re.test(t)) out.push(name);
  return out;
}

const NPM: Record<string, string> = {
  react: 'React', next: 'Next.js', express: 'Express', 'react-native': 'React Native', vue: 'Vue', '@angular/core': 'Angular', redux: 'Redux', '@reduxjs/toolkit': 'Redux',
  mongoose: 'MongoDB', mongodb: 'MongoDB', pg: 'PostgreSQL', mysql: 'MySQL', mysql2: 'MySQL', sqlite3: 'SQLite', redis: 'Redis', ioredis: 'Redis', 'socket.io': 'Socket.IO', ws: 'WebSockets',
  jsonwebtoken: 'JWT', bcrypt: 'bcrypt', bcryptjs: 'bcrypt', passport: 'Passport', jest: 'Jest', mocha: 'Mocha', vitest: 'Vitest', cypress: 'Cypress', tailwindcss: 'Tailwind CSS', prisma: 'Prisma',
  '@prisma/client': 'Prisma', typeorm: 'TypeORM', sequelize: 'Sequelize', '@nestjs/core': 'NestJS', graphql: 'GraphQL', firebase: 'Firebase', stripe: 'Stripe', razorpay: 'Razorpay', electron: 'Electron',
  three: 'Three.js', typescript: 'TypeScript', axios: 'Axios', multer: 'File uploads (multer)', nodemailer: 'Email (nodemailer)', cors: 'CORS', helmet: 'Helmet', 'express-validator': 'Input validation', zod: 'Zod',
};
const PY: Record<string, string> = {
  django: 'Django', flask: 'Flask', fastapi: 'FastAPI', numpy: 'NumPy', pandas: 'Pandas', 'scikit-learn': 'scikit-learn', sklearn: 'scikit-learn', tensorflow: 'TensorFlow', keras: 'TensorFlow', torch: 'PyTorch',
  'opencv-python': 'OpenCV', streamlit: 'Streamlit', sqlalchemy: 'SQLAlchemy', requests: 'requests', beautifulsoup4: 'BeautifulSoup', selenium: 'Selenium', pytest: 'pytest', celery: 'Celery', matplotlib: 'Matplotlib',
  nltk: 'NLTK', transformers: 'Transformers', pymongo: 'MongoDB', psycopg2: 'PostgreSQL', 'psycopg2-binary': 'PostgreSQL', pyjwt: 'JWT',
};

export interface ManifestFile { path: string; text: string }

/** Technologies shown by dependency files (package.json, requirements.txt, pom.xml, ...). */
export function techFromManifests(files: ManifestFile[]): string[] {
  const out = new Set<string>();
  for (const f of files) {
    const base = f.path.split('/').pop()!.toLowerCase();
    if (base === 'package.json') {
      try {
        const j = JSON.parse(f.text);
        for (const k of Object.keys({ ...(j.dependencies ?? {}), ...(j.devDependencies ?? {}) })) if (NPM[k]) out.add(NPM[k]);
        out.add('Node.js');
      } catch { /* truncated or invalid: ignore */ }
    } else if (base === 'requirements.txt' || base === 'pyproject.toml' || base === 'pipfile') {
      for (const line of f.text.split('\n')) { const n = /^\s*"?([A-Za-z0-9_.-]+)/.exec(line)?.[1]?.toLowerCase(); if (n && PY[n]) out.add(PY[n]); }
      out.add('Python');
    } else if (base === 'pom.xml' || base === 'build.gradle' || base === 'build.gradle.kts') {
      out.add('Java');
      if (/spring-boot/i.test(f.text)) out.add('Spring Boot');
      if (/hibernate|jpa/i.test(f.text)) out.add('Hibernate');
      if (/junit/i.test(f.text)) out.add('JUnit');
      if (/mysql/i.test(f.text)) out.add('MySQL');
    } else if (base === 'go.mod') out.add('Go');
    else if (base === 'cargo.toml') out.add('Rust');
    else if (base === 'composer.json') { out.add('PHP'); if (/laravel/i.test(f.text)) out.add('Laravel'); }
    else if (base === 'dockerfile' || base.startsWith('docker-compose')) out.add('Docker');
    else if (base === 'pubspec.yaml') { out.add('Flutter'); out.add('Dart'); }
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// Keeping private and secret text out of what leaves the building
// ---------------------------------------------------------------------------

/** Replaces credentials and keys in code or text with a marker, so they are never sent to a model or shown. */
export function scrubSecrets(text: string): string {
  return String(text ?? '')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[REDACTED]')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b/g, '[REDACTED]')
    .replace(/\bAIza[0-9A-Za-z_-]{30,}\b|\bxox[abprs]-[A-Za-z0-9-]{10,}\b|\bsk-[A-Za-z0-9_-]{20,}\b|\bgsk_[A-Za-z0-9]{20,}\b/g, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED]')
    .replace(/(:\/\/[^\s:/@]+:)[^\s@/]{3,}(@)/g, '$1[REDACTED]$2')
    .replace(/((?:api[_-]?key|secret|token|passwd|password|pwd|private[_-]?key|client[_-]?secret)["']?\s*[:=]\s*["'])[^"'\n]{6,}(["'])/gi, '$1[REDACTED]$2');
}

/** True for files that must never be read or sent: environment files, keys, credentials. */
export function isSensitivePath(path: string): boolean {
  const p = path.toLowerCase();
  const base = p.split('/').pop() ?? '';
  return base === '.env' || base.startsWith('.env.') || /\.(pem|key|p12|pfx|jks|keystore|crt|cer)$/.test(base) || /(^|\/)(id_rsa|id_ed25519|\.npmrc|\.pypirc|\.netrc|credentials|secrets?)(\.|$)/.test(p) || /(serviceaccount|service-account|firebase-adminsdk).*\.json$/.test(base);
}

/** Removes contact details and links from resume text before any of it is sent to a model. Names are not found by rules, so send only the project section. */
export function redactPersonalData(text: string): string {
  return String(text ?? '')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, m => (m.replace(/\D/g, '').length >= 10 ? '[phone]' : m))
    .replace(/https?:\/\/(?!(?:www\.)?github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+)[^\s)]+/gi, '[link]')
    .replace(/\b(?:www\.)?linkedin\.com\/[^\s)]*/gi, '[link]');
}

// ---------------------------------------------------------------------------
// Resume projects
// ---------------------------------------------------------------------------

export interface ResumeProject { name: string; summary: string; tech: string[] }

const SECTION_END = /^(?:work\s+)?(?:experience|education|skills|technical skills|certifications?|achievements?|awards?|internships?|publications?|positions? of responsibility|extra[- ]?curricular(?: activities)?|summary|objective|profile|languages|hobbies|interests|references|courses?|coursework|training|volunteering|leadership)\b[\s:&a-z-]*$/i;
const PROJECT_HEAD = /^(?:(?:personal|academic|key|major|notable|selected|technical|mini|capstone|final[- ]year|live|side)\s+)?projects?(?:\s*(?:&|and)\s*[a-z ]+)?\s*:?$/i;
const BULLET = /^\s*(?:[•●▪■◦·*\-–—]|\d+[.)])\s+/;

/**
 * Last-resort reader for a resume's project section, used when no model is available or its answer is unusable. It looks for a
 * "Projects" heading and treats each non-bullet line as a project title and the bullets under it as its description.
 */
export function extractProjectsHeuristic(text: string): ResumeProject[] {
  const lines = String(text ?? '').replace(/\r/g, '').split('\n').map(l => l.replace(/\s+$/, ''));
  const start = lines.findIndex(l => PROJECT_HEAD.test(l.trim().replace(/^#+\s*/, '')));
  if (start < 0) return [];
  const projects: ResumeProject[] = [];
  let cur: { name: string; desc: string[]; head: string } | null = null;
  const flush = () => {
    if (cur && cur.name) {
      const summary = cur.desc.join(' ').replace(/\s+/g, ' ').trim().slice(0, 600);
      projects.push({ name: cur.name, summary, tech: techFromText(`${cur.head} ${summary}`).slice(0, 12) });
    }
    cur = null;
  };
  for (const raw of lines.slice(start + 1)) {
    const l = raw.trim();
    if (!l) continue;
    const bare = l.replace(/^#+\s*/, '');
    if (SECTION_END.test(bare) && bare.length < 40) break;
    if (BULLET.test(l)) { if (cur) cur.desc.push(l.replace(BULLET, '')); continue; }
    if (l.length <= 140 && (!cur || cur.desc.length > 0 || /[|–—:(]| - /.test(l))) {
      flush();
      const name = l.split(/\s*[|–—:(]\s*|\s+-\s+/)[0].replace(/[*_`]/g, '').trim();
      if (name.length >= 2 && name.length <= 90) cur = { name, desc: [], head: l };
    } else if (cur) cur.desc.push(l);
    if (projects.length >= 8) break;
  }
  flush();
  return projects.slice(0, 8);
}

/** The part of a resume to send to a model: the project section if there is one, otherwise the start. Always redacted and capped. */
export function projectSectionForModel(text: string, maxChars = 6000): string {
  const lines = String(text ?? '').replace(/\r/g, '').split('\n');
  const start = lines.findIndex(l => PROJECT_HEAD.test(l.trim().replace(/^#+\s*/, '')));
  let body: string[];
  if (start < 0) body = lines;
  else {
    const rest = lines.slice(start);
    const end = rest.findIndex((l, i) => i > 0 && SECTION_END.test(l.trim().replace(/^#+\s*/, '')) && l.trim().length < 40);
    body = end < 0 ? rest : rest.slice(0, end);
  }
  return redactPersonalData(body.join('\n')).slice(0, maxChars);
}

// ---------------------------------------------------------------------------
// Matching a resume project to a GitHub repository
// ---------------------------------------------------------------------------

export interface RepoLite {
  name: string; description: string | null; topics: string[]; language: string | null; fork: boolean; stars: number; pushedAt: string | null;
  /** Filled in by the deep scan when available. */
  readme?: string | null; tech?: string[];
  /** The README's own title. Projects are often named there and not in the repository's name ("Warrant" in a repo called "Mindspark"). */
  title?: string | null;
}

/** The README's heading or first line of text, without markdown, HTML or emoji. */
export function readmeTitle(readme: string | null | undefined): string | null {
  const lines = String(readme ?? '').replace(/\r/g, '').split('\n');
  const clean = (l: string) => l.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '').replace(/[*_`>#|]/g, '').replace(/\p{Extended_Pictographic}/gu, '').replace(/\s+/g, ' ').trim();
  const h1 = lines.find(l => /^#\s+\S/.test(l));
  const t = clean(h1 ?? lines.find(l => clean(l).length >= 3) ?? '');
  return t ? t.slice(0, 120) : null;
}

export interface RepoMatch { repo: string; score: number; strength: 'strong' | 'possible'; reasons: string[] }

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'for', 'to', 'in', 'on', 'with', 'using', 'based', 'app', 'application', 'system', 'project', 'website', 'web', 'portal', 'my', 'new', 'final', 'year', 'mini', 'v1', 'v2', 'clone', 'demo', 'repo', 'code', 'sample', 'test']);

/** Lower-case word tokens, splitting camelCase, kebab-case and snake_case, without filler words. */
export function nameTokens(s: string): string[] {
  return String(s ?? '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1 && !STOP.has(t));
}
const squash = (s: string) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const wordSet = (s: string) => new Set(String(s ?? '').toLowerCase().split(/[^a-z0-9+#.]+/).filter(t => t.length >= 4 && !STOP.has(t)));

/** Ranks a candidate's repositories for one resume project, each with the reasons, strongest first. Deterministic and explainable. */
export function matchProject(project: ResumeProject, repos: RepoLite[]): RepoMatch[] {
  const pt = nameTokens(project.name);
  const pSquash = squash(project.name);
  const pTech = new Set(project.tech.map(t => t.toLowerCase()));
  const pWords = wordSet(project.summary);
  const out: RepoMatch[] = [];
  for (const r of repos) {
    const nameScoreOf = (label: string) => {
      const rt = nameTokens(label);
      const rSquash = squash(label);
      if (pSquash && pSquash === rSquash) return 1;
      if (pSquash.length >= 4 && rSquash.length >= 4 && (rSquash.includes(pSquash) || pSquash.includes(rSquash))) return 0.85;
      if (pt.length && rt.length) {
        const inter = pt.filter(t => rt.includes(t)).length;
        return Math.max(inter / new Set([...pt, ...rt]).size, (inter / Math.min(pt.length, rt.length)) * 0.8);
      }
      return 0;
    };
    const byRepoName = nameScoreOf(r.name);
    // A README title counts a little less than the repository's own name, since many READMEs repeat a generic heading.
    const byTitle = r.title ? nameScoreOf(r.title) * 0.95 : 0;
    const name = Math.max(byRepoName, byTitle);
    const repoTech = new Set([...(r.tech ?? []), ...(r.language ? [r.language] : []), ...r.topics].map(t => t.toLowerCase()));
    const sharedTech = [...pTech].filter(t => repoTech.has(t));
    const tech = pTech.size ? Math.min(1, sharedTech.length / Math.min(pTech.size, 3)) : 0;
    const rWords = wordSet(`${r.description ?? ''} ${r.topics.join(' ')} ${(r.readme ?? '').slice(0, 2500)}`);
    const sharedWords = [...pWords].filter(w => rWords.has(w));
    const text = pWords.size ? Math.min(1, sharedWords.length / Math.min(pWords.size, 8)) : 0;
    const score = Math.round((0.6 * name + 0.2 * tech + 0.2 * text) * 100) / 100;
    if (score < 0.3 && name < 0.8) continue;
    const reasons: string[] = [];
    if (byTitle > byRepoName && name >= 0.5) reasons.push(`The README of "${r.name}" is titled "${r.title}", which matches the project name.`);
    else if (name >= 0.8) reasons.push(name === 1 ? `The repository name "${r.name}" is the project name.` : `The repository name "${r.name}" contains or is contained in the project name.`);
    else if (name > 0.3) reasons.push(`The names share words ("${r.name}" and "${project.name}").`);
    if (sharedTech.length) reasons.push(`Same technology: ${sharedTech.slice(0, 4).join(', ')}.`);
    if (sharedWords.length >= 2) reasons.push(`Description words in common: ${sharedWords.slice(0, 5).join(', ')}.`);
    if (r.fork) reasons.push('This repository is a fork, so the history may not be the candidate’s own.');
    out.push({ repo: r.name, score, strength: score >= 0.55 || name >= 0.85 ? 'strong' : 'possible', reasons });
  }
  return out.sort((a, b) => b.score - a.score || a.repo.localeCompare(b.repo)).slice(0, 3);
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export type Level = 'easy' | 'medium' | 'hard';
export const LEVELS: readonly Level[] = ['easy', 'medium', 'hard'];
export const FOCUS = ['overview', 'role', 'stack', 'code', 'data', 'testing', 'challenge', 'design', 'scale', 'security', 'hindsight'] as const;
export type Focus = (typeof FOCUS)[number];

export interface KitQuestion {
  level: Level;
  question: string;
  /** The scanned file this question is based on, or null for questions about the project as a whole. */
  evidence: string | null;
  /** What a good answer would cover, for the interviewer. Not a score. */
  lookFor: string[];
  followUp: string | null;
  focus: Focus;
  source: 'ai' | 'template';
}

export interface ProjectFacts {
  name: string;
  summary: string;
  tech: string[];
  repo: { name: string; description: string | null; url: string; fork: boolean; matched: boolean } | null;
  readmeExcerpt: string | null;
  /** Paths that were actually read or listed. Evidence may only point at these. */
  files: string[];
  samples: { path: string; excerpt: string }[];
  hasTests: boolean;
  hasCI: boolean;
  hasDocker: boolean;
  /** Short facts from the commit sample: how many commits we saw and the share the candidate authored. */
  commits: { seen: number; byCandidate: number; first: string | null; last: string | null } | null;
}

const clean = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Checks what a model returned, one question at a time. A question is kept only if it has the right shape and its evidence, if any,
 * names a file that was really scanned. Returns what was kept and how many were dropped.
 */
export function validateQuestions(raw: any, evidence: ReadonlySet<string>): { questions: KitQuestion[]; dropped: number } {
  const list = Array.isArray(raw?.questions) ? raw.questions : [];
  const out: KitQuestion[] = [];
  let dropped = 0;
  const seen = new Set<string>();
  for (const q of list) {
    const level = String(q?.level ?? '').toLowerCase() as Level;
    const question = clean(q?.question, 400);
    const lookFor = Array.isArray(q?.lookFor) ? q.lookFor.map((x: unknown) => clean(x, 160)).filter((x: string) => x.length >= 4).slice(0, 5) : [];
    const ev = q?.evidence === null || q?.evidence === undefined || q?.evidence === '' ? null : clean(q.evidence, 300);
    const key = question.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
    const badEvidence = ev !== null && !evidence.has(ev);
    if (!LEVELS.includes(level) || question.length < 20 || (!question.includes('?') && question.length < 40) || lookFor.length < 2 || badEvidence || seen.has(key)) { dropped++; continue; }
    seen.add(key);
    const focus = (FOCUS as readonly string[]).includes(q?.focus) ? (q.focus as Focus) : 'design';
    const follow = clean(q?.followUp, 300);
    out.push({ level, question, evidence: ev, lookFor, followUp: follow.length >= 10 ? follow : null, focus, source: 'ai' });
  }
  return { questions: out, dropped };
}

/** Keeps at most `perLevel` questions of each level, in the order given. */
export function limitPerLevel<T extends { level: Level }>(qs: T[], perLevel: number): T[] {
  const n: Record<Level, number> = { easy: 0, medium: 0, hard: 0 };
  return qs.filter(q => (n[q.level] += 1) <= perLevel);
}

/**
 * Questions built only from facts we hold, used to top up a model's answer or to stand in for it. Each states what it is based on.
 * Easy: what and why, the way campus rounds ask. Medium: how it works, pointing at a real file. Hard: trade-offs, scale and hindsight.
 */
export function templateQuestions(f: ProjectFacts): KitQuestion[] {
  const n = f.name;
  const stack = f.tech.slice(0, 4).join(', ');
  const code = f.samples[0];
  const code2 = f.samples[1];
  const T = (level: Level, focus: Focus, question: string, lookFor: string[], evidence: string | null = null, followUp: string | null = null): KitQuestion => ({ level, question, evidence, lookFor, followUp, focus, source: 'template' });
  const qs: KitQuestion[] = [
    T('easy', 'overview', `In two or three sentences, what problem does ${n} solve and who would use it?`, ['Names a real user and a real problem', 'Describes what the project does without reading the README aloud'], null, 'What did the first working version do?'),
    T('easy', 'role', `Which parts of ${n} did you build yourself, and which parts did teammates, tutorials or libraries provide?`, ['Separates own work from borrowed work honestly', 'Can name specific modules or screens'], null, 'Which part took you the longest?'),
    T('easy', 'stack', stack ? `Why did you choose ${stack} for ${n}? What else could you have used?` : `Which technologies did you use in ${n}, and why those?`, ['Gives a reason that fits the project, not "it is popular"', 'Can name at least one alternative'], null),
    T('easy', 'overview', f.readmeExcerpt ? `Your README describes ${n}. What is the one feature you are most proud of, and how does it work at a high level?` : `What is the one feature of ${n} you are most proud of, and how does it work at a high level?`, ['Picks a concrete feature', 'Explains it in a sensible order'], null),
  ];
  if (code) qs.push(T('medium', 'code', `Open ${code.path}. Walk me through what this file does and how it connects to the rest of ${n}.`, ['Describes the file’s purpose correctly', 'Can say who calls it and what it calls', 'Can explain any unusual line without guessing'], code.path, 'What would break if you deleted this file?'));
  else qs.push(T('medium', 'design', `Walk me through what happens in ${n} from a user action to the stored result. Which parts of the code handle each step?`, ['Follows the data in a sensible order', 'Names real modules or functions'], null));
  if (code2) qs.push(T('medium', 'code', `In ${code2.path}, pick one function and explain what it takes in, what it returns, and what happens when the input is wrong.`, ['Explains inputs and outputs correctly', 'Has thought about invalid input', 'Can change it live without trouble'], code2.path));
  qs.push(T('medium', 'data', f.tech.some(t => /sql|mongo|firebase|postgres|mysql|sqlite|redis/i.test(t)) ? `How is the data in ${n} organised? Describe the main tables or collections and how they relate.` : `Where does ${n} keep its data, and how would you change that if the amount of data grew?`, ['Describes the real data layout', 'Explains a relationship or an index'], null));
  qs.push(T('medium', 'testing', f.hasTests ? `The repository has tests. Which behaviour do they protect, and what is one thing they do not cover?` : `This repository has no tests that we could find. How did you check that ${n} works, and how would you test it now?`, f.hasTests ? ['Names what the tests check', 'Is honest about gaps'] : ['Describes how it was really checked', 'Can name a first test worth writing'], null));
  qs.push(T('medium', 'challenge', `What was the hardest bug or problem you hit in ${n}, how did you find the cause, and what did you change?`, ['A specific problem with a specific cause', 'Describes how they investigated, not only the fix'], null, 'How would you stop it happening again?'));
  qs.push(T('hard', 'scale', `If ${n} had 100 times more users tomorrow, which part would fail first? What would you change, and in what order?`, ['Identifies a real bottleneck for this design', 'Orders the fixes sensibly', 'Mentions how they would measure it'], null));
  qs.push(T('hard', 'design', code ? `Pick one design decision in ${code.path}. What alternative did you reject, and what did that cost you?` : `Pick one design decision in ${n}. What alternative did you reject, and what did that cost you?`, ['Names a real alternative', 'States a trade-off, not only a benefit'], code?.path ?? null));
  qs.push(T('hard', 'security', f.tech.some(t => /jwt|passport|bcrypt|firebase/i.test(t)) ? `How does ${n} handle sign-in and protect a user’s data? Describe one way an attacker could try to get around it, and how yours holds up.` : `What is the most sensitive piece of data in ${n}, and how is it protected? Describe one way it could leak.`, ['Understands what is sensitive', 'Names a realistic attack', 'Does not claim the project is fully secure'], null));
  qs.push(T('hard', 'hindsight', `If you rebuilt ${n} today, which decision would you reverse, and what evidence made you change your mind?`, ['Names a specific decision', 'Ties the change to something learned, not hindsight alone'], null));
  return qs;
}

/**
 * Combines a model's validated questions with template questions so every level has `perLevel` questions. Template questions
 * fill only the gaps and never repeat a focus the model already covers at that level.
 */
export function completeSet(modelQs: KitQuestion[], facts: ProjectFacts, perLevel: number): KitQuestion[] {
  const out: KitQuestion[] = [];
  const tmpl = templateQuestions(facts);
  for (const level of LEVELS) {
    const have = limitPerLevel(modelQs.filter(q => q.level === level), perLevel);
    const focus = new Set(have.map(q => q.focus));
    const fill = tmpl.filter(q => q.level === level && !focus.has(q.focus)).slice(0, Math.max(0, perLevel - have.length));
    out.push(...have, ...fill);
  }
  return out;
}
