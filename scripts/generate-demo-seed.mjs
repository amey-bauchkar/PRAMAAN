#!/usr/bin/env node
/**
 * Generates the Phase 0 seed files deterministically (same output on every run):
 *   db/seeds/010_skill_taxonomy.sql        ~150 skills, aliases, proposed ESCO / O*NET mappings
 *   db/seeds/020_synthetic_demo_tenant.sql  1 university, 2 colleges, 6 branches, 300 synthetic students
 *
 * Every person, organisation and company is fictional and visibly marked [SYNTHETIC]; e-mail addresses
 * use the reserved .invalid TLD. Usage: node scripts/generate-demo-seed.mjs
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import vm from 'vm';
import { TAXONOMY } from './seed-data/taxonomy.mjs';
import { MIX, nameMaker } from './seed-data/people.mjs';
import { aptitudeBank, codingProblems, LEARNING_TASKS, INTERVIEW_QUESTIONS, RAHUL_PROBE } from './seed-data/banks.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEEDS = path.resolve(__dirname, '..', 'db', 'seeds');

// ---------- deterministic helpers ----------
let rngState = 20270123;
function rand() { // mulberry32
  rngState |= 0; rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = arr => arr[Math.floor(rand() * arr.length)];
let rng2State = 5150;
function rand2() { rng2State = (rng2State * 1103515245 + 12345) % 2147483648; return rng2State / 2147483648; }
const between2 = (lo, hi) => lo + rand2() * (hi - lo);
// Independent streams for the realism model, so the original streams stay stable.
function streamFrom(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand3 = streamFrom(31337), rand4 = streamFrom(777001);
/** Standard normal draw (Box-Muller) from the given uniform source. */
function normal(u = rand4) { const a = Math.max(1e-9, u()), b = u(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b); }
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
/** Share of women by branch, close to national engineering and polytechnic intake patterns. */
const FEMALE_P = { cse: 0.34, it: 0.4, entc: 0.28, mech: 0.08, dce: 0.17, dee: 0.1 };
/** Typical stacks, so a student's skills cluster the way real portfolios do. */
const BUNDLES = {
  cse: [['javascript', 'typescript', 'react', 'nodejs', 'rest-api', 'mongodb'], ['java', 'oop', 'sql', 'dbms', 'rest-api', 'postgresql'], ['python', 'machine-learning', 'sql', 'data-structures'], ['cpp', 'algorithms', 'operating-systems', 'computer-networks', 'linux'], ['docker', 'aws', 'linux', 'git', 'system-design']],
  it: [['html', 'css', 'javascript', 'react', 'sql', 'mysql'], ['python', 'data-analysis', 'power-bi', 'excel', 'sql'], ['software-testing', 'selenium', 'java', 'git'], ['linux', 'computer-networks', 'cybersecurity', 'docker']],
  entc: [['embedded-c', 'arduino', 'microcontrollers', 'iot', 'raspberry-pi'], ['verilog', 'vlsi', 'digital-electronics', 'analog-electronics'], ['signal-processing', 'communication-systems', 'matlab', 'python'], ['pcb-design', 'analog-electronics', 'digital-electronics']],
  mech: [['autocad', 'solidworks', 'catia', 'gdt'], ['ansys', 'matlab', 'thermodynamics', 'hvac'], ['cnc-programming', 'manufacturing-processes', 'gdt', 'excel']],
  dce: [['autocad', 'staad-pro', 'revit'], ['surveying', 'estimation-costing', 'excel']],
  dee: [['electrical-machines', 'power-systems', 'control-systems'], ['plc', 'scada', 'electrical-design'], ['solar-pv', 'electrical-design', 'autocad']],
};
/** Plausible file paths for code evidence, by skill family. */
const PATHS = {
  python: ['app/services/inventory.py', 'scripts/clean_data.py', 'src/utils/validators.py', 'api/routes/orders.py'],
  java: ['src/main/java/com/app/service/BookingService.java', 'src/main/java/com/app/dao/StudentDao.java', 'src/main/java/Main.java'],
  javascript: ['src/components/CartSummary.jsx', 'server/routes/auth.js', 'src/utils/pricing.js', 'public/js/app.js'],
  typescript: ['src/hooks/useFetch.ts', 'src/services/api.ts', 'src/types/models.ts'],
  react: ['src/components/Dashboard.jsx', 'src/pages/Login.jsx', 'src/App.jsx'],
  nodejs: ['server/index.js', 'routes/products.js', 'middleware/auth.js'],
  sql: ['db/schema.sql', 'queries/monthly_report.sql', 'migrations/001_init.sql'],
  c: ['src/main.c', 'lib/linked_list.c', 'drivers/uart.c'],
  cpp: ['src/graph.cpp', 'solutions/dp_knapsack.cpp', 'include/segment_tree.hpp'],
  'embedded-c': ['firmware/main.c', 'drivers/adc.c', 'src/pwm_control.c'],
  default: ['src/main.py', 'lib/helpers.js', 'README.md', 'notebooks/analysis.ipynb'],
};
const pathFor = (slug, r) => { const list = PATHS[slug] ?? PATHS.default; return list[Math.floor(r() * list.length)]; };

const between = (lo, hi) => lo + rand() * (hi - lo);
const int = (lo, hi) => Math.floor(between(lo, hi + 1));
/** Stable UUID from a name (v5-style layout over SHA-1). */
function uid(name) {
  const h = crypto.createHash('sha1').update(`pramaan-demo:${name}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${(8 + (parseInt(h[16], 16) & 3)).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const q = v => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : `'${String(v).replace(/'/g, "''")}'`;
const row = vals => `(${vals.map(q).join(', ')})`;
function chunked(header, rows, footer = '', size = 400) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(`${header}\n${rows.slice(i, i + size).join(',\n')}\n${footer};`);
  return out.join('\n\n');
}
const BANNER = (title) => `-- ==============================================================================
-- ${title}
-- GENERATED by scripts/generate-demo-seed.mjs. Do not edit by hand; edit the generator and re-run.
-- ==============================================================================\n`;

// ---------- 010 taxonomy ----------
function taxonomySql() {
  const seenSlug = new Set(), seenAlias = new Set();
  const skills = [], aliases = [], mappings = [];
  for (const [slug, name, category, halfLife, al, esco, onet] of TAXONOMY) {
    if (seenSlug.has(slug)) throw new Error(`duplicate slug ${slug}`);
    seenSlug.add(slug);
    skills.push(row([uid(`skill:${slug}`), slug, name, category, `${name} (${category}).`, halfLife]));
    for (const a of al) {
      const k = a.toLowerCase();
      if (seenAlias.has(k)) throw new Error(`duplicate alias ${a}`);
      seenAlias.add(k);
      aliases.push(row([slug, a]));
    }
    if (esco) mappings.push(row([slug, 'ESCO', esco]));
    if (onet) mappings.push(row([slug, 'ONET', onet]));
  }
  return [
    BANNER('PRAMAAN SEED 010: SKILL TAXONOMY v1'),
    `-- Upserts by canonical_name so rows created by seed 001 keep their ids and gain a slug.`,
    chunked(`INSERT INTO skills (id, slug, canonical_name, category, description, half_life_days) VALUES`, skills,
      `ON CONFLICT (canonical_name) DO UPDATE SET slug = EXCLUDED.slug, category = EXCLUDED.category, half_life_days = EXCLUDED.half_life_days`),
    '',
    `INSERT INTO skill_aliases (skill_id, alias)\nSELECT s.id, v.alias FROM (VALUES\n${aliases.join(',\n')}\n) v(slug, alias) JOIN skills s ON s.slug = v.slug\nON CONFLICT DO NOTHING;`,
    '',
    `-- Proposed labels only: status pending_review, code NULL, until confirmed against ESCO / O*NET.`,
    `INSERT INTO skill_mappings (skill_id, framework, label, framework_version, match_type, status)\nSELECT s.id, v.framework, v.label, NULL, 'close', 'pending_review' FROM (VALUES\n${mappings.join(',\n')}\n) v(slug, framework, label) JOIN skills s ON s.slug = v.slug\nON CONFLICT DO NOTHING;`,
    '',
    `-- Version-1 rubric for every skill, so verification sessions can reference one.`,
    `INSERT INTO rubric_versions (skill_id, version_no, dimensions, levels)\nSELECT s.id, 1,\n  '[{"key":"correctness","label":"Correctness"},{"key":"reasoning","label":"Reasoning"},{"key":"communication","label":"Explanation"}]'::jsonb,\n  '{"1":"Novice","2":"Competent","3":"Proficient"}'::jsonb\nFROM skills s WHERE s.slug IS NOT NULL\nON CONFLICT (skill_id, version_no) DO NOTHING;`,
    '',
  ].join('\n');
}

// ---------- 020 synthetic tenant ----------

const UNI = uid('org:university');
const COL_A = uid('org:college-a');
const COL_B = uid('org:college-b');

const DEPTS = [
  { key: 'cse', org: COL_A, name: 'Computer Engineering', code: 'CSE', n: 80, poly: false },
  { key: 'it', org: COL_A, name: 'Information Technology', code: 'IT', n: 50, poly: false },
  { key: 'entc', org: COL_A, name: 'Electronics & Telecommunication', code: 'ENTC', n: 50, poly: false },
  { key: 'mech', org: COL_A, name: 'Mechanical Engineering', code: 'MECH', n: 40, poly: false },
  { key: 'dce', org: COL_B, name: 'Diploma in Civil Engineering', code: 'DCE', n: 40, poly: true },
  { key: 'dee', org: COL_B, name: 'Diploma in Electrical Engineering', code: 'DEE', n: 40, poly: true },
];

// Skills each branch typically shows; drawn per student.
const BRANCH_SKILLS = {
  cse: ['python', 'java', 'cpp', 'javascript', 'typescript', 'react', 'nodejs', 'sql', 'postgresql', 'mongodb', 'git', 'docker', 'data-structures', 'algorithms', 'oop', 'dbms', 'operating-systems', 'computer-networks', 'machine-learning', 'rest-api', 'linux', 'aws', 'system-design', 'unit-testing'],
  it: ['python', 'java', 'javascript', 'html', 'css', 'react', 'sql', 'mysql', 'git', 'data-structures', 'algorithms', 'oop', 'dbms', 'computer-networks', 'data-analysis', 'power-bi', 'excel', 'software-testing', 'selenium', 'docker', 'linux', 'cybersecurity'],
  entc: ['c', 'embedded-c', 'arduino', 'microcontrollers', 'iot', 'matlab', 'digital-electronics', 'analog-electronics', 'signal-processing', 'pcb-design', 'verilog', 'vlsi', 'communication-systems', 'python', 'raspberry-pi', 'linux', 'sql'],
  mech: ['autocad', 'solidworks', 'catia', 'ansys', 'cnc-programming', 'gdt', 'manufacturing-processes', 'thermodynamics', 'hvac', 'matlab', 'excel', 'python'],
  dce: ['autocad', 'staad-pro', 'revit', 'surveying', 'estimation-costing', 'excel'],
  dee: ['electrical-machines', 'power-systems', 'electrical-design', 'control-systems', 'plc', 'scada', 'solar-pv', 'autocad', 'excel'],
};
// Core skills every student of a branch studies; they appear on every profile and are proven more often.
const CORE = {
  cse: ['sql', 'data-structures', 'python', 'java', 'git'],
  it: ['sql', 'data-structures', 'java', 'excel'],
  entc: ['c', 'embedded-c', 'microcontrollers'],
  mech: ['autocad', 'solidworks', 'gdt'],
  dce: ['autocad', 'estimation-costing'],
  dee: ['electrical-design', 'solar-pv'],
};
// Skills shown with code; any other L1 proof is an issuer-verified certificate.
const CODE_SKILLS = new Set(['python', 'java', 'c', 'cpp', 'javascript', 'typescript', 'react', 'nodejs', 'sql', 'postgresql', 'mongodb', 'git', 'docker',
  'data-structures', 'algorithms', 'oop', 'machine-learning', 'rest-api', 'html', 'css', 'mysql', 'selenium', 'unit-testing', 'embedded-c', 'verilog', 'raspberry-pi', 'arduino']);
const COMMON = ['quant-aptitude', 'logical-reasoning', 'verbal-ability', 'communication', 'problem-solving', 'teamwork'];

// Proof level → verification modality and evidence kind (must match migration 019's mapping).
const PROOF = {
  L1_code_backed: { modality: 'code_backed', kind: 'code_span' },
  L2_assessed: { modality: 'test_score', kind: 'test_result' },
  L3_defended: { modality: 'probe', kind: 'code_span' },
  L3_attested: { modality: 'mentor', kind: 'lab' },
};
const SOFTWARE = new Set(['cse', 'it']);

const DRIVE_CTC = { backend: 650000, 'data-analyst': 550000, cloud: 500000, sde: 450000, ml: 800000, embedded: 520000, 'design-eng': 480000, 'site-eng': 300000, 'electrical-tech': 280000, 'past-backend': 475000 };
const pick2 = arr => arr[Math.floor(rand2() * arr.length)];

/** Runs our own trusted reference solution to compute expected outputs for hidden tests. */
function runReference(source, entry, input) {
  const ctx = vm.createContext({});
  vm.runInContext(`${source}\n;globalThis.__fn = ${entry};`, ctx, { timeout: 1000 });
  return JSON.parse(vm.runInContext(`JSON.stringify(__fn(...${JSON.stringify(input)}))`, ctx, { timeout: 1000 }) ?? 'null');
}

// ---------- 015 assessment banks (global, org_id NULL) ----------
function banksSql() {
  const out = [BANNER('PRAMAAN SEED 015: ASSESSMENT & LEARNING BANKS (global)')];
  const apt = aptitudeBank();
  out.push(chunked(`INSERT INTO aptitude_questions (id, org_id, topic, subtopic, difficulty, stem, options, answer_index, explanation) VALUES`,
    apt.map((x, i) => row([uid(`apt:${x.topic}:${x.subtopic}:${i}`), null, x.topic, x.subtopic, x.difficulty, x.stem, JSON.stringify(x.options), x.answerIndex, x.explanation])),
    `ON CONFLICT (id) DO NOTHING`));
  const problems = codingProblems().map(p => ({
    ...p,
    hiddenTests: p.language === 'javascript' ? p.hiddenTests.map(t => ({ ...t, expected: runReference(p.reference, p.entry, t.input) })) : p.hiddenTests,
    publicTests: p.language === 'javascript' ? p.publicTests.map(t => ({ ...t, expected: runReference(p.reference, p.entry, t.input) })) : p.publicTests,
  }));
  out.push(chunked(`INSERT INTO coding_problems (id, org_id, slug, title, statement, entry_function, starter_code, public_tests, hidden_tests, language, reference_solution, sql_schema, marks, topics, skill_slugs, difficulty)\nSELECT v.id::uuid, NULL, v.slug, v.title, v.statement, v.entry, v.starter::jsonb, v.pub::jsonb, v.hid::jsonb, v.lang, v.ref, v.schema, v.marks::int, string_to_array(v.topics, ','), string_to_array(v.skills, ','), v.diff::int FROM (VALUES`,
    problems.map(p => row([uid(`problem:${p.slug}`), p.slug, p.title, p.statement, p.entry, JSON.stringify({ [p.language]: p.starter }), JSON.stringify(p.publicTests), JSON.stringify(p.hiddenTests), p.language, p.reference, p.sqlSchema, p.marks, p.topics.join(','), p.skills.join(','), p.difficulty])),
    `) v(id, slug, title, statement, entry, starter, pub, hid, lang, ref, schema, marks, topics, skills, diff)\nON CONFLICT (id) DO NOTHING`));
  out.push(chunked(`INSERT INTO learning_tasks (id, org_id, slug, skill_id, title, description, kind, coding_problem_id, target_proof, est_hours, weak_topics)\nSELECT v.id::uuid, NULL, v.slug, s.id, v.title, v.descr, v.kind, v.problem::uuid, v.proof, v.hours::numeric, string_to_array(v.topics, ',') FROM (VALUES`,
    LEARNING_TASKS.map(([slug, skill, title, kind, prob, proof, hours, topics, descr]) => row([uid(`task:${slug}`), slug, skill, title, descr, kind, prob ? uid(`problem:${prob}`) : null, proof, hours, topics.join(',')])),
    `) v(id, slug, skill, title, descr, kind, problem, proof, hours, topics) JOIN skills s ON s.slug = v.skill\nON CONFLICT (id) DO NOTHING`));
  return out.join('\n\n') + '\n';
}


function demoTenantSql() {
  const NOW = Date.UTC(2026, 10, 16); // 16 Nov 2026, fixed so the seed is reproducible
  const iso = ms => new Date(ms).toISOString();
  const day = 86_400_000;

  const out = [BANNER('PRAMAAN SEED 020: SYNTHETIC DEMO TENANT (all people and organisations are fictional)')];

  // Organisations
  out.push(`INSERT INTO organizations (id, parent_id, kind, name, tier, config) VALUES
${row([UNI, null, 'university', '[SYNTHETIC] Deccan Technological University', null, '{"synthetic": true}'])},
${row([COL_A, UNI, 'college', '[SYNTHETIC] Sahyadri College of Engineering', 'Tier 2', '{"synthetic": true}'])},
${row([COL_B, UNI, 'college', '[SYNTHETIC] Konkan Government Polytechnic', 'Tier 3', '{"synthetic": true}'])}
ON CONFLICT (id) DO NOTHING;`);

  out.push(chunked(`INSERT INTO departments (id, org_id, name, code) VALUES`,
    DEPTS.map(d => row([uid(`dept:${d.key}`), d.org, d.name, d.code])), `ON CONFLICT (id) DO NOTHING`));

  // Staff
  const staff = [
    { key: 'uni-admin', name: 'Dr. Sunita Kale', org: UNI, role: 'university_admin', dept: null },
    { key: 'tpo-a', name: 'Prof. Meenal Joshi', org: COL_A, role: 'officer', dept: null },
    { key: 'admin-a', name: 'Dr. Vikram Bhide', org: COL_A, role: 'college_admin', dept: null },
    { key: 'coord-cse', name: 'Prof. Anil Gokhale', org: COL_A, role: 'dept_coordinator', dept: 'cse' },
    { key: 'mentor-cse', name: 'Dr. Rekha Menon', org: COL_A, role: 'mentor', dept: 'cse' },
    { key: 'mentor-entc', name: 'Prof. Santosh Kulkarni', org: COL_A, role: 'mentor', dept: 'entc' },
    { key: 'mentor-mech', name: 'Prof. Farhan Ali', org: COL_A, role: 'mentor', dept: 'mech' },
    { key: 'tpo-b', name: 'Shri. Prakash Sawant', org: COL_B, role: 'officer', dept: null },
    { key: 'mentor-dee', name: 'Smt. Lata Dhuri', org: COL_B, role: 'mentor', dept: 'dee' },
    { key: 'mentor-dce', name: 'Shri. Mahesh Naik', org: COL_B, role: 'mentor', dept: 'dce' },
    { key: 'recruiter-1', name: 'Neha Kapoor', org: COL_A, role: 'recruiter', dept: null },
    { key: 'recruiter-2', name: 'Arvind Krishnan', org: COL_A, role: 'recruiter', dept: null },
  ];
  const users = [], members = [];
  for (const s of staff) {
    users.push(row([uid(`user:${s.key}`), `demo|${s.key}`, `${s.key}@demo.pramaan.invalid`, `${s.name} [SYNTHETIC]`]));
    members.push(row([uid(`member:${s.key}`), uid(`user:${s.key}`), s.org, s.dept ? uid(`dept:${s.dept}`) : null, s.role]));
  }
  const memberOf = key => uid(`member:${key}`);
  const mentorFor = { cse: 'mentor-cse', it: 'mentor-cse', entc: 'mentor-entc', mech: 'mentor-mech', dce: 'mentor-dce', dee: 'mentor-dee' };
  const tpoFor = org => (org === COL_A ? 'tpo-a' : 'tpo-b');

  // Students
  const students = [], academics = [], consents = [], groupAttrs = [], guardians = [];
  const sSkills = [], evidence = [], links = [], sessions = [], verifyUpdates = [], attestations = [];
  const summary = { minors: 0, verified: 0, students: 0 };
  const studentIndex = [];
  let seq = 0;
  const makeName = nameMaker(rand3);
  const makeNameA = f => makeName(MIX.collegeA, f);
  const makeNameB = f => makeName(MIX.collegeB, f);

  for (const d of DEPTS) {
    for (let i = 0; i < d.n; i++) {
      seq += 1;
      const isHero = d.key === 'cse' && i === 0;
      if (!isHero) { rand(); rand(); rand(); } // keep the original stream positions stable
      const female = isHero ? false : rand3() < FEMALE_P[d.key];
      const nm = isHero ? { first: 'Rahul', last: 'Deshmukh' } : (d.org === COL_A ? makeNameA : makeNameB)(female);
      const first = nm.first, last = nm.last;
      const key = `student:${d.key}:${i}`;
      const userId = uid(`user:${key}`), memberId = uid(`member:${key}`), studentId = uid(key);
      const enrol = `${d.poly ? 'KGP' : 'SCOE'}-2027-${d.code}-${String(i + 1).padStart(3, '0')}`;

      // Ages: degree students born 2004–05; diploma students 2007–09, about ten of them still 17.
      let dob;
      if (!d.poly) dob = `${pick([2004, 2005])}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`;
      else if (i < 5) dob = `2009-${String(int(1, 10)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`;
      else dob = `${pick([2007, 2008])}-${String(int(1, 6)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`;
      const minor = new Date(`${dob}T00:00:00Z`).getTime() > NOW - 18 * 365.25 * day;
      if (minor) summary.minors += 1;

      users.push(row([userId, `demo|${key}`, `${first.toLowerCase()}.${last.toLowerCase()}.${seq}@demo.pramaan.invalid`, `${first} ${last} [SYNTHETIC]`]));
      members.push(row([memberId, userId, d.org, uid(`dept:${d.key}`), 'student']));
      students.push(row([studentId, d.org, userId, uid(`dept:${d.key}`), enrol, 2027, minor, dob]));
      summary.students += 1;

      // Realistic academic model: one latent ability drives 10th, 12th/diploma and CGPA, so they correlate
      // the way real records do. SSC marks are out of 500 (steps of 0.2%), HSC out of 600 (steps of 1/6 %).
      // Category is drawn from a hash of the student key. SYNTHETIC MODELLING CHOICE: school-leaving marks
      // (10th/12th/diploma) are shifted by category to reflect the documented gap in access to prior schooling,
      // so the fairness tools have a realistic pattern to find. CGPA and skills are NOT shifted.
      const catR = parseInt(crypto.createHash('sha256').update(`cat:${key}`).digest('hex').slice(0, 8), 16) / 0xffffffff;
      const categoryOf = r => (r < 0.06 ? 'Prefer not to say' : r < 0.46 ? 'General' : r < 0.74 ? 'OBC' : r < 0.86 ? 'SC' : r < 0.92 ? 'ST' : 'EWS');
      const schoolGap = { 'SC': -9, 'ST': -11, 'OBC': -3, 'EWS': -4 }[categoryOf(catR)] ?? 0;
      const ability = normal();
      const branchOffset = { cse: 0.25, it: 0.1, entc: 0, mech: -0.2, dce: 0.1, dee: 0 }[d.key];
      const lateral = !d.poly && !isHero && rand4() < 0.12; // lateral-entry (diploma) students in the degree course
      const ssc = v => Number((Math.round(clampN(v, 50, 98.6) * 5) / 5).toFixed(1));
      const hsc = v => Number((Math.round(clampN(v, 48, 95) * 6) / 6).toFixed(2));
      const dip = v => Number(clampN(v, 50, 92).toFixed(2));
      const tenth = isHero ? 86.4 : ssc((d.poly ? 74 : 78) + 8.5 * ability + 3.5 * normal() + schoolGap);
      const twelfth = d.poly || lateral ? null : isHero ? 78.2 : hsc(72 + 9.5 * (0.75 * ability + 0.66 * normal()) + schoolGap);
      const diploma = d.poly ? dip(68 + 8 * (0.8 * ability + 0.6 * normal()) + schoolGap) : lateral ? dip(70 + 8 * (0.7 * ability + 0.7 * normal()) + schoolGap) : null;
      const cgpa = isHero ? 7.8 : Number(clampN(d.poly ? (diploma / 10) + 0.25 * normal() : 7.0 + 0.8 * (0.6 * ability + 0.8 * normal()) + branchOffset, 5.0, 9.7).toFixed(2));
      const pBack = cgpa < 6.3 ? 0.5 : cgpa < 7 ? 0.28 : cgpa < 7.8 ? 0.1 : 0.03;
      const backlogs = isHero ? 0 : rand4() < pBack ? 1 + (rand4() < 0.35 ? 1 : 0) + (rand4() < 0.12 ? 1 : 0) : 0;
      const gap = isHero ? 0 : rand4() < (cgpa < 6.5 ? 0.14 : 0.05) ? 1 : 0;
      const history = backlogs + (isHero ? 0 : rand4() < (cgpa < 7 ? 0.25 : 0.07) ? 1 : 0);
      academics.push(row([uid(`acad:${key}`), studentId, cgpa, backlogs, tenth, twelfth, diploma, gap, history]));
      const si = { key, studentId, dept: d.key, org: d.org, isHero, cgpa, backlogs, minor, verified: new Set() };
      studentIndex.push(si);

      // Consents: everyone for placement operations; others vary. Minors never share with recruiters
      // unless a verified guardian consent exists.
      const grant = (purpose, granted = true) => {
        if (!granted) return null;
        const id = uid(`consent:${key}:${purpose}`);
        consents.push(row([id, studentId, purpose, 1, iso(NOW - (rand3() < 0.85 ? 62 + rand3() * 28 : 4 + rand3() * 50) * day)]));
        return id;
      };
      grant('placement_operations');
      const hasRepo = isHero || (SOFTWARE.has(d.key) ? rand() < 0.75 : rand() < 0.3);
      grant('repo_verification', hasRepo);
      let guardianVerified = false;
      if (minor) {
        guardianVerified = i % 2 === 0;
        guardians.push(row([uid(`guardian:${key}`), studentId, `Guardian of ${first} [SYNTHETIC]`, pick(['mother', 'father']), `REF-${seq}`,
          guardianVerified ? 'verified' : 'pending', guardianVerified ? memberOf(tpoFor(d.org)) : null,
          guardianVerified ? 'digilocker' : null, guardianVerified ? iso(NOW - 30 * day) : null]));
      }
      grant('recruiter_sharing', (!minor || guardianVerified) && rand() < 0.85);
      const fairnessGrant = grant('fairness_monitoring', rand() < 0.88);
      if (fairnessGrant) {
        const gender = rand() < 0.05 ? 'Prefer not to say' : female ? 'Female' : 'Male';
        rand(); // keep the main PRNG stream unchanged
        const category = categoryOf(catR);
        groupAttrs.push(row([studentId, gender, category, fairnessGrant]));
      }

      // Skills
      const bundles = BUNDLES[d.key];
      const b1 = bundles[Math.floor(rand3() * bundles.length)];
      const b2 = rand3() < 0.45 ? bundles[Math.floor(rand3() * bundles.length)] : [];
      const extras = BRANCH_SKILLS[d.key].filter(() => rand3() < 0.06);
      const commons = COMMON.filter(() => rand3() < 0.45);
      const chosen = isHero
        ? ['python', 'sql', 'java', 'git', 'data-structures', 'excel', 'javascript', 'react', 'docker', 'quant-aptitude', 'communication']
        : [...new Set([...CORE[d.key], ...b1, ...b2, ...extras, ...(commons.length ? commons : [COMMON[Math.floor(rand3() * COMMON.length)]])])];
      const heroStates = { python: ['verified', 'L1_code_backed', 2], sql: ['claimed', null, 1], java: ['verified', 'L2_assessed', 2], git: ['verified', 'L1_code_backed', 2], 'data-structures': ['evidence_linked', null, 2], excel: ['verified', 'L1_code_backed', 1], javascript: ['evidence_linked', null, 2], react: ['observed', null, 1], docker: ['claimed', null, 1], 'quant-aptitude': ['verified', 'L2_assessed', 2], communication: ['claimed', null, 1] };

      for (const slug of chosen) {
        const ssId = uid(`ss:${key}:${slug}`);
        let state, proof, level;
        if (isHero) [state, proof, level] = heroStates[slug];
        else {
          const r = rand();
          // Better CGPA students have somewhat more proof, so cohort analytics have signal.
          const boost = (cgpa - 7) * 0.04 + (CORE[d.key].includes(slug) ? 0.2 : 0);
          state = r < 0.28 - boost ? 'claimed' : r < 0.42 - boost ? 'observed' : r < 0.6 - boost ? 'evidence_linked' : r < 0.95 ? 'verified' : 'expired';
          level = state === 'verified' ? (rand() < 0.55 ? 2 : rand() < 0.5 ? 1 : 3) : int(1, 2);
          if (state === 'verified') {
            const softwareSkill = SOFTWARE.has(d.key) && !COMMON.includes(slug);
            const p = rand();
            proof = COMMON.includes(slug) ? 'L2_assessed'
              : softwareSkill ? (p < (hasRepo ? 0.25 : 0) ? 'L1_code_backed' : p < 0.9 ? 'L2_assessed' : hasRepo ? 'L3_defended' : 'L3_attested')
              : (p < 0.3 ? 'L1_code_backed' : p < 0.65 ? 'L3_attested' : 'L2_assessed');
          }
        }
        sSkills.push(row([ssId, studentId, slug, state === 'verified' ? 'evidence_linked' : state, level]));

        if (state === 'claimed' || state === 'observed') continue;

        const p = state !== 'verified' ? { kind: SOFTWARE.has(d.key) && hasRepo ? 'code_span' : 'certificate' }
          : proof === 'L1_code_backed' && !CODE_SKILLS.has(slug) ? { modality: 'issuer_verified', kind: 'certificate' }
          : PROOF[proof];
        const evId = uid(`ev:${key}:${slug}`);
        const season = rand3(); // proofs cluster in the current season and the summer break
        const createdMs = NOW - (season < 0.6 ? 8 + rand3() * 80 : season < 0.85 ? 125 + rand3() * 50 : 190 + rand3() * 150) * day;
        const heroProbe = isHero && slug === 'javascript';
        const contentHash = heroProbe ? crypto.createHash('sha256').update(RAHUL_PROBE.code).digest('hex') : crypto.createHash('sha256').update(evId).digest('hex');
        const evValid = state === 'expired' ? iso(NOW - int(5, 60) * day) : iso(NOW + int(200, 500) * day);
        evidence.push(row([evId, studentId, p.kind, contentHash, 'accepted', heroProbe ? RAHUL_PROBE.filePath : p.kind === 'code_span' ? pathFor(slug, rand3) : null,
          state === 'expired' ? 'accepted' : 'accepted', iso(createdMs), evValid]));
        links.push(row([ssId, evId]));

        if (state === 'verified') {
          const vsId = uid(`vs:${key}:${slug}`);
          const completed = createdMs + int(1, 10) * day;
          sessions.push(row([vsId, ssId, p.modality, iso(completed - day), iso(completed)]));
          const validUntil = iso(Math.min(completed + 365 * day, Date.parse(evValid)));
          verifyUpdates.push(row([ssId, vsId, validUntil, proof, iso(completed)]));
          if (proof === 'L3_attested') {
            attestations.push(row([uid(`att:${key}:${slug}`), evId, memberOf(mentorFor[d.key]), slug,
              `Faculty review of practical work in ${slug.replace(/-/g, ' ')}`, iso(completed), iso(completed + 365 * day)]));
          }
          summary.verified += 1;
          si.verified.add(slug);
        }
      }
    }
  }

  out.push(chunked(`INSERT INTO users (id, auth_subject, email, full_name) VALUES`, users, `ON CONFLICT (id) DO NOTHING`));
  out.push(chunked(`INSERT INTO memberships (id, user_id, org_id, department_id, role) VALUES`, members, `ON CONFLICT (id) DO NOTHING`));
  out.push(chunked(`INSERT INTO students (id, org_id, user_id, department_id, enrollment_no, graduating_year, is_minor, date_of_birth) VALUES`, students, `ON CONFLICT (id) DO NOTHING`));
  out.push(chunked(`INSERT INTO academic_records (id, student_id, cgpa, active_backlogs, tenth_pct, twelfth_pct, diploma_pct, gap_years, backlog_history) VALUES`, academics,
    `ON CONFLICT (id) DO UPDATE SET tenth_pct = EXCLUDED.tenth_pct, twelfth_pct = EXCLUDED.twelfth_pct, diploma_pct = EXCLUDED.diploma_pct, gap_years = EXCLUDED.gap_years, backlog_history = EXCLUDED.backlog_history`));
  out.push(chunked(`INSERT INTO consent_grants (id, student_id, purpose, notice_version, granted_at) VALUES`, consents, `ON CONFLICT (id) DO NOTHING`));
  out.push(chunked(`INSERT INTO guardian_consents (id, student_id, guardian_name, relationship, verification_ref, status, verified_by, verification_method, verified_at) VALUES`, guardians, `ON CONFLICT (id) DO NOTHING`));
  out.push(chunked(`INSERT INTO student_group_attributes (student_id, gender, category, consent_grant_id) VALUES`, groupAttrs, `ON CONFLICT (student_id) DO NOTHING`));

  out.push(`-- Student skills are inserted at most 'evidence_linked'; verified ones are promoted below, after their
-- evidence and passed verification session exist, so migration 019's trigger checks every one of them.`);
  out.push(chunked(`INSERT INTO student_skills (id, student_id, skill_id, state, level)\nSELECT v.id::uuid, v.student_id::uuid, s.id, v.state, v.level FROM (VALUES`, sSkills,
    `) v(id, student_id, slug, state, level) JOIN skills s ON s.slug = v.slug\nON CONFLICT (student_id, skill_id) DO NOTHING`));
  out.push(chunked(`INSERT INTO evidence_items (id, student_id, kind, content_hash, status, path, accepted_by, created_at, valid_until)\nSELECT v.id::uuid, v.student_id::uuid, v.kind, v.content_hash, v.status, v.path, NULL, v.created_at::timestamptz, v.valid_until::timestamptz FROM (VALUES`,
    evidence, `) v(id, student_id, kind, content_hash, status, path, _s, created_at, valid_until)\nON CONFLICT (id) DO NOTHING`));
  out.push(chunked(`INSERT INTO skill_evidence (student_skill_id, evidence_id)\nSELECT v.ss::uuid, v.ev::uuid FROM (VALUES`, links, `) v(ss, ev)\nON CONFLICT DO NOTHING`));
  out.push(chunked(`INSERT INTO verification_sessions (id, student_skill_id, rubric_version_id, modality, started_at, completed_at, outcome)\nSELECT v.id::uuid, ss.id, rv.id, v.modality, v.started_at::timestamptz, v.completed_at::timestamptz, 'passed' FROM (VALUES`,
    sessions, `) v(id, ss_id, modality, started_at, completed_at)\nJOIN student_skills ss ON ss.id = v.ss_id::uuid\nJOIN rubric_versions rv ON rv.skill_id = ss.skill_id AND rv.version_no = 1\nON CONFLICT (id) DO NOTHING`));
  out.push(chunked(`INSERT INTO attestations (id, evidence_id, mentor_membership_id, rubric_version_id, scope_text, rubric_scores, created_at, valid_until)\nSELECT v.id::uuid, v.ev::uuid, v.mentor::uuid, rv.id, v.scope, '{"correctness": 3, "reasoning": 2, "communication": 2}'::jsonb, v.created_at::timestamptz, v.valid_until::timestamptz FROM (VALUES`,
    attestations, `) v(id, ev, mentor, slug, scope, created_at, valid_until)\nJOIN skills s ON s.slug = v.slug\nJOIN rubric_versions rv ON rv.skill_id = s.id AND rv.version_no = 1\nON CONFLICT (id) DO NOTHING`));
  out.push(chunked(`UPDATE student_skills ss SET state = 'verified', last_verification_id = v.vs::uuid, valid_until = v.valid_until::timestamptz, proof_level = v.proof\nFROM (VALUES`,
    verifyUpdates, `) v(ss, vs, valid_until, proof, verified_at)\nWHERE ss.id = v.ss::uuid AND ss.state <> 'verified'`));

  // Companies, roles and drives
  const companies = [
    ['nimbus', 'Nimbus Analytics', 'IT Services'], ['quanta', 'Quanta Fintech', 'Financial Services'], ['orbit', 'Orbit Cloud Systems', 'Cloud Software'],
    ['kaveri', 'Kaveri Motors', 'Automotive'], ['sahyadri-power', 'Sahyadri Power Grid Solutions', 'Power & Energy'], ['vistar', 'Vistar Infra Builders', 'Construction'],
    ['tejas-semi', 'Tejas Semiconductors', 'Semiconductors'], ['pragati', 'Pragati Consulting', 'IT Services'], ['medisys', 'Medisys Health Tech', 'Healthcare Software'],
    ['krishi', 'Krishi Data Labs', 'AgriTech'], ['urja', 'Urja Solar', 'Renewable Energy'], ['shakti', 'Shakti Automation', 'Industrial Automation'],
  ];
  out.push(chunked(`INSERT INTO companies (id, org_id, name, industry, contact_email) VALUES`,
    companies.map(([k, n, ind]) => row([uid(`company:${k}`), ['vistar', 'urja'].includes(k) ? COL_B : COL_A, `[SYNTHETIC] ${n}`, ind, `campus@${k}.demo.pramaan.invalid`])), `ON CONFLICT (id) DO NOTHING`));

  // [key, company, title, college, start offset days, status, branches, minCgpa, maxBacklogs, skills[[slug,minLevel,minProof]], JD text]
  const drives = [
    ['backend', 'nimbus', 'Backend Developer', COL_A, 35, 'scheduled', ['CSE', 'IT'], 7.0, 0, [['python', 1, 'L1'], ['sql', 1, 'L2']], 'Build REST APIs in Python, design SQL schemas and write efficient queries. Docker and Git are a plus.'],
    ['data-analyst', 'quanta', 'Data Analyst', COL_A, 42, 'scheduled', ['CSE', 'IT', 'ENTC'], 6.5, 1, [['sql', 1, 'L2'], ['excel', 1, 'L1']], 'Analyse transaction data with SQL and Excel, build Power BI dashboards, present findings.'],
    ['cloud', 'orbit', 'Cloud Support Engineer', COL_A, 50, 'scheduled', ['CSE', 'IT'], 6.5, 0, [['linux', 1, 'L1'], ['docker', 1, 'L1']], 'Support customer workloads on Linux and Docker; scripting and networking fundamentals expected.'],
    ['sde', 'pragati', 'Software Engineer Trainee', COL_A, 28, 'scheduled', ['CSE', 'IT', 'ENTC'], 6.0, 0, [['data-structures', 1, 'L2'], ['java', 1, 'L1']], 'Strong data structures and Java; you will work on enterprise applications with SQL and Git.'],
    ['ml', 'krishi', 'ML Engineer Intern', COL_A, 60, 'draft', ['CSE', 'IT'], 7.5, 0, [['python', 2, 'L2'], ['machine-learning', 1, 'L2']], 'Train and deploy crop-yield models in Python; pandas, scikit-learn, and Docker for serving.'],
    ['embedded', 'tejas-semi', 'Embedded Systems Engineer', COL_A, 45, 'scheduled', ['ENTC'], 6.5, 0, [['embedded-c', 1, 'L2'], ['microcontrollers', 1, 'L1']], 'Firmware in Embedded C for ARM microcontrollers; digital electronics and PCB debugging.'],
    ['design-eng', 'kaveri', 'Design Engineer (GET)', COL_A, 38, 'scheduled', ['MECH'], 6.0, 1, [['solidworks', 1, 'L1'], ['gdt', 1, 'L1']], 'Part and assembly modelling in SolidWorks and CATIA, GD&T, manufacturing drawings.'],
    ['site-eng', 'vistar', 'Junior Site Engineer', COL_B, 30, 'scheduled', ['DCE'], 5.5, 1, [['autocad', 1, 'L1'], ['estimation-costing', 1, 'L1']], 'Site supervision, AutoCAD drawings, quantity estimation and surveying.'],
    ['electrical-tech', 'urja', 'Solar Installation Technician', COL_B, 33, 'scheduled', ['DEE'], 5.5, 1, [['solar-pv', 1, 'L1'], ['electrical-design', 1, 'L1']], 'Install and commission rooftop solar PV; wiring, earthing and electrical safety.'],
    ['past-backend', 'medisys', 'Associate Software Engineer (completed)', COL_A, -40, 'completed', ['CSE', 'IT'], 6.5, 0, [['sql', 1, 'L1']], 'Healthcare software: Java or Python services and SQL. Completed drive used for funnel analytics.'],
  ];
  const roles = [], roleSkills = [], driveRows = [], ruleSets = [], ruleVersions = [];
  for (const [k, comp, title, org, offset, status, branches, minCgpa, maxBacklogs, skills, jd] of drives) {
    const roleId = uid(`role:${k}`), driveId = uid(`drive:${k}`), rsId = uid(`ruleset:${k}`), rvId = uid(`rulever:${k}`);
    roles.push(row([roleId, uid(`company:${comp}`), title, jd]));
    for (const [slug, lvl] of skills) roleSkills.push(row([roleId, slug, lvl]));
    const start = NOW + offset * day;
    driveRows.push(row([driveId, org, uid(`company:${comp}`), `[SYNTHETIC] ${title}`, org === COL_A ? 'Seminar Hall 1' : 'Main Hall', iso(start), iso(start + 8 * 3600_000), status]));
    ruleSets.push(row([rsId, org, `${title} criteria`]));
    const skillValues = skills.map(([slug, lvl, proof]) => `('${slug}', ${lvl}, '${proof}')`).join(', ');
    ruleVersions.push(`INSERT INTO eligibility_rule_versions (id, rule_set_id, version_no, rules, rationale, published_by)
SELECT ${q(rvId)}, ${q(rsId)}, 1, jsonb_build_object(
  'schemaVersion', 2,
  'academics', jsonb_build_object('minCgpa', ${minCgpa}, 'minTenthPct', 60, 'minTwelfthOrDiplomaPct', 60, 'maxGapYears', 1),
  'backlogs', jsonb_build_object('maxActive', ${maxBacklogs}),
  'branches', ${q(JSON.stringify(branches))}::jsonb,
  'graduatingYears', '[2027]'::jsonb,
  'skills', (SELECT jsonb_agg(jsonb_build_object('skillId', s.id, 'name', s.canonical_name, 'minLevel', r.lvl, 'minProof', r.proof) ORDER BY s.canonical_name)
             FROM (VALUES ${skillValues}) r(slug, lvl, proof) JOIN skills s ON s.slug = r.slug),
  'policy', jsonb_build_object('maxOffersHeld', 0)
), ${q(`Version 1 for ${title}: academic floor, branch list and evidence-backed skills.`)}, ${q(memberOf(tpoFor(org)))}
ON CONFLICT (id) DO NOTHING;`);
  }
  out.push(chunked(`INSERT INTO job_roles (id, company_id, title, description) VALUES`, roles, `ON CONFLICT (id) DO NOTHING`));
  out.push(chunked(`INSERT INTO job_role_skills (role_id, skill_id, min_level)\nSELECT v.role::uuid, s.id, v.lvl FROM (VALUES`, roleSkills, `) v(role, slug, lvl) JOIN skills s ON s.slug = v.slug\nON CONFLICT DO NOTHING`));
  out.push(chunked(`INSERT INTO drives (id, org_id, company_id, title, venue_resource, starts_at, ends_at, status) VALUES`, driveRows, `ON CONFLICT (id) DO NOTHING`));
  out.push(chunked(`INSERT INTO eligibility_rule_sets (id, org_id, title) VALUES`, ruleSets, `ON CONFLICT (id) DO NOTHING`));
  out.push(ruleVersions.join('\n\n'));

  // Completed drive: application funnel for fairness and KPI demos.
  const funnel = [];
  const outcomes = [];
  // Applicants are the eligible students who chose to apply (about 70%). Selection follows a noisy score
  // of CGPA and verified SQL, like a real shortlist: about 12% offered, 18% interviews, 30% shortlisted.
  const applicants = studentIndex
    .filter(st => (st.dept === 'cse' || st.dept === 'it') && !st.isHero && st.cgpa >= 6.5 && st.backlogs === 0 && rand3() < 0.7)
    .map(st => ({ st, score: (st.cgpa - 7) * 0.9 + (st.verified.has('sql') ? 0.6 : 0) + (st.verified.has('java') || st.verified.has('python') ? 0.3 : 0) + 0.7 * normal() }))
    .sort((a, b) => b.score - a.score);
  applicants.forEach(({ st, score }, idx) => {
    const frac = idx / applicants.length;
    const stage = frac < 0.12 ? 'offered' : frac < 0.30 ? 'interview_scheduled' : frac < 0.60 ? 'shortlisted' : 'rejected';
    const ctc = stage === 'offered' ? 420000 + Math.max(0, Math.min(8, Math.round(2 + score * 1.5))) * 20000 : null;
    funnel.push(row([uid(`app:past-backend:${st.key}`), uid('drive:past-backend'), st.studentId, stage, ctc]));
    if (stage === 'offered') outcomes.push(row([uid(`outcome:${st.key}`), st.studentId, 'placed', '[SYNTHETIC] Medisys Health Tech', ctc, 'offer-letter-synthetic']));
  });
  out.push(chunked(`INSERT INTO applications (id, drive_id, student_id, stage, ctc_inr) VALUES`, funnel, `ON CONFLICT (id) DO NOTHING`));
  out.push(chunked(`INSERT INTO student_outcomes (id, student_id, outcome_type, organization_name, ctc_inr, evidence_ref) VALUES`, outcomes, `ON CONFLICT (id) DO NOTHING`));
  // Stage history for the completed drive, so Time-to-Shortlist has real timestamps.
  const pastStart = NOW - 40 * day;
  out.push(`UPDATE drives SET created_at = ${q(iso(pastStart - 30 * day))} WHERE id = ${q(uid('drive:past-backend'))};`);
  const evRows = [];
  for (const r of funnel) {
    const m = r.match(/^\('([^']+)', '[^']+', '[^']+', '([^']+)'/);
    if (!m) continue;
    const [, appId, stage] = m;
    evRows.push(row([uid(`ae:${appId}:applied`), appId, null, 'applied', iso(pastStart - 25 * day)]));
    if (stage !== 'rejected') evRows.push(row([uid(`ae:${appId}:sl`), appId, 'applied', 'shortlisted', iso(pastStart - 23 * day)]));
    else evRows.push(row([uid(`ae:${appId}:rj`), appId, 'applied', 'rejected', iso(pastStart - 23 * day)]));
    if (stage === 'offered') evRows.push(row([uid(`ae:${appId}:of`), appId, 'shortlisted', 'offered', iso(pastStart + day)]));
  }
  out.push(chunked(`INSERT INTO application_events (id, application_id, from_stage, to_stage, occurred_at) VALUES`, evRows, `ON CONFLICT (id) DO NOTHING`));


  // ---------- Phase 1–3 additions: drive links, rooms, rounds, grants, JDs, outreach, probe, mock history ----------
  const dl = drives.map(([k]) => row([uid(`drive:${k}`), uid(`role:${k}`), uid(`ruleset:${k}`), uid(`rulever:${k}`), DRIVE_CTC[k] ?? null]));
  out.push(chunked(`UPDATE drives d SET role_id = v.role::uuid, rule_set_id = v.rs::uuid, rule_version_id = v.rv::uuid, ctc_inr = v.ctc::numeric\nFROM (VALUES`, dl, `) v(id, role, rs, rv, ctc) WHERE d.id = v.id::uuid`));

  const rooms = [[COL_A, 'Seminar Hall 1', 120], [COL_A, 'Auditorium', 300], [COL_A, 'Computer Lab 1', 60], [COL_A, 'Computer Lab 2', 60], [COL_A, 'Interview Room A', 6], [COL_A, 'Interview Room B', 6], [COL_B, 'Main Hall', 150], [COL_B, 'Workshop Lab', 40]];
  out.push(chunked(`INSERT INTO rooms (id, org_id, name, capacity) VALUES`, rooms.map(([o, n, c]) => row([uid(`room:${o}:${n}`), o, n, c])), `ON CONFLICT (id) DO NOTHING`));
  const room = (o, n) => uid(`room:${o}:${n}`);
  // IST wall-clock time on the day `offsetDays` after the reference date.
  const at = (offsetDays, hh, mm = 0) => iso(NOW + offsetDays * day + ((hh * 60 + mm) - 330) * 60_000);
  const rounds = [
    ['backend', 'aptitude', 'Aptitude test', 35, [10, 0], [11, 0], room(COL_A, 'Computer Lab 1')],
    ['backend', 'interview', 'Technical interviews', 35, [11, 30], [17, 0], room(COL_A, 'Interview Room A')],
    ['data-analyst', 'technical_test', 'SQL and Excel test', 42, [10, 0], [11, 30], room(COL_A, 'Computer Lab 1')],
    ['sde', 'pre_placement_talk', 'Pre-placement talk', 28, [9, 30], [10, 30], room(COL_A, 'Seminar Hall 1')],
    ['sde', 'technical_test', 'Coding test', 28, [11, 0], [12, 30], room(COL_A, 'Computer Lab 2')],
    ['cloud', 'technical_test', 'Linux practical', 35, [10, 30], [12, 0], room(COL_A, 'Computer Lab 2')],
    ['site-eng', 'interview', 'Interviews', 30, [10, 0], [14, 0], room(COL_B, 'Main Hall')],
  ];
  out.push(chunked(`INSERT INTO drive_rounds (id, drive_id, kind, title, starts_at, ends_at, room_id, status) VALUES`,
    rounds.map(([k, kind, t, o, s1, e1, r]) => row([uid(`round:${k}:${kind}`), uid(`drive:${k}`), kind, t, at(o, ...s1), at(o, ...e1), r, 'scheduled'])), `ON CONFLICT (id) DO NOTHING`));

  out.push(`INSERT INTO recruiter_access_grants (id, recruiter_membership_id, drive_id, scope, approved_by, expires_at) VALUES
${[['recruiter-1', 'backend'], ['recruiter-1', 'past-backend'], ['recruiter-2', 'data-analyst']].map(([r, k]) => row([uid(`grant:${r}:${k}`), memberOf(r), uid(`drive:${k}`), '{"fields": ["verified_skills", "evidence_cards"]}', memberOf('tpo-a'), '2027-01-31T18:29:59.000Z'])).join(',\n')}
ON CONFLICT (id) DO NOTHING;`);

  // Job descriptions: the drives' own JDs plus a synthetic market sample spread over six months.
  const jds = drives.map(([k, comp, title, org, , , , , , , jd]) => row([uid(`jd:${k}`), org, uid(`company:${comp}`), 'drive', title, jd, '2026-11-01']));
  const MARKET = [
    ['Backend Engineer', 'Python or Java services, REST API design, SQL and PostgreSQL. Docker and Kubernetes in production. Git and CI/CD.'],
    ['Full Stack Developer', 'React and TypeScript front end, Node.js and Express.js back end, MongoDB or SQL, Docker for local development.'],
    ['Data Analyst', 'SQL, Microsoft Excel and Power BI dashboards; Python with Pandas is a plus. Strong statistics.'],
    ['Data Engineer', 'ETL pipelines with Apache Spark and Apache Airflow, SQL, Python, Docker, Amazon Web Services.'],
    ['DevOps Engineer', 'Linux, Docker, Kubernetes, Terraform, CI/CD with GitHub Actions, monitoring with Prometheus and Grafana.'],
    ['ML Engineer', 'Python, PyTorch or TensorFlow, scikit-learn, MLOps with Docker; experience with Generative AI applications.'],
    ['QA Engineer', 'Software testing, Selenium, unit testing, SQL for test data, Git, Agile & Scrum.'],
    ['Embedded Engineer', 'Embedded C on ARM microcontrollers, digital electronics, PCB design debugging, Linux.'],
    ['Graduate Engineer Trainee (Mechanical)', 'AutoCAD and SolidWorks, GD&T, manufacturing processes, Microsoft Excel.'],
    ['Site Engineer', 'AutoCAD, estimation & costing, surveying, quantity surveying on residential projects.'],
    ['Solar Technician', 'Solar PV design and installation, electrical design, earthing and safety.'],
    ['Cloud Associate', 'Amazon Web Services, Linux, Docker, networking basics, scripting with Python or Bash.'],
  ];
  for (let i = 0; i < 36; i++) {
    const [t, body] = MARKET[i % MARKET.length];
    const month = 6 + (i % 6), dayOfMonth = month === 11 ? 2 + ((i * 7) % 12) : 3 + ((i * 7) % 25);
    jds.push(row([uid(`jd:market:${i}`), COL_A, null, 'dataset', `${t} [SYNTHETIC sample ${i + 1}]`, body, `2026-${String(month).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`]));
  }
  out.push(chunked(`INSERT INTO jd_documents (id, org_id, company_id, source, title, body, posted_on) VALUES`, jds, `ON CONFLICT (id) DO NOTHING`));

  out.push(`INSERT INTO outreach_templates (id, org_id, name, subject, body, created_by) VALUES
${row([uid('template:invite'), COL_A, 'Campus drive invitation 2026–27', 'Campus recruitment invitation: {{college}}, batch of 2027',
    'Dear {{company}} team,\n\n{{college}} invites you to recruit from our 2027 batch. Every candidate profile shows verified skills with the evidence behind them.\n\nPlease reply with your preferred visit date and rounds.\n\nRegards,\nTraining & Placement Office',
    memberOf('tpo-a')])}
ON CONFLICT (id) DO NOTHING;`);
  out.push(`INSERT INTO inbound_messages (id, org_id, company_id, from_email, subject, body, received_at) VALUES
${row([uid('inbound:orbit'), COL_A, uid('company:orbit'), 'campus@orbit.demo.pramaan.invalid', 'Re: Campus recruitment invitation',
    'Thank you for the invitation. We would like to visit on 21 December 2026. Pre-placement talk 9:30–10:00, Linux practical 10:30–12:00, technical interviews 1 pm to 5 pm. Please confirm.', iso(NOW - 2 * day)])}
ON CONFLICT (id) DO NOTHING;`);

  // Interview questions per role, approved by the placement office.
  const iqs = INTERVIEW_QUESTIONS.map(([role, topic, qq, kps], i) => {
    const org = ['Junior Site Engineer', 'Solar Installation Technician'].includes(role) ? COL_B : COL_A;
    return row([uid(`iq:${i}`), org, role, topic, qq, JSON.stringify(kps.map(([point, keywords]) => ({ point, keywords }))), 'approved', 'officer', memberOf(tpoFor(org))]);
  });
  out.push(chunked(`INSERT INTO interview_questions (id, org_id, role_title, topic, question, key_points, status, drafted_by, approved_by)\nSELECT v.id::uuid, v.org::uuid, v.role, v.topic, v.q, v.kp::jsonb, v.st, v.by, v.ap::uuid FROM (VALUES`, iqs,
    `) v(id, org, role, topic, q, kp, st, by, ap)\nON CONFLICT (id) DO NOTHING`));

  // Rahul's Live Mutation Probe on his own code (preloaded snapshot, labelled as such).
  const probeTests = RAHUL_PROBE.hiddenTests.map(t => (t.expectError ? t : { ...t, expected: runReference(RAHUL_PROBE.reference, 'finalAmount', t.input) }));
  const hero = studentIndex.find(x => x.isHero);
  out.push(`INSERT INTO probe_definitions (id, skill_id, title, description, language, entry_function_name, test_harness_code, timeout_ms,
  student_id, commit_sha, file_path, line_start, line_end, code_span, content_hash, predict_question, predict_key_points, mutation_task, provenance)
SELECT ${q(uid('probe:rahul:pricing'))}::uuid, s.id, 'Live Mutation Probe: cart pricing', ${q(`Repository ${RAHUL_PROBE.repo} at commit ${RAHUL_PROBE.commitSha.slice(0, 7)}`)}, 'javascript', 'finalAmount',
  ${q(JSON.stringify(probeTests))}, 2000, ${q(hero.studentId)}::uuid, ${q(RAHUL_PROBE.commitSha)}, ${q(RAHUL_PROBE.filePath)}, ${RAHUL_PROBE.lineStart}, ${RAHUL_PROBE.lineEnd},
  ${q(RAHUL_PROBE.code)}, ${q(crypto.createHash('sha256').update(RAHUL_PROBE.code).digest('hex'))}, ${q(RAHUL_PROBE.predictQuestion)}, ${q(JSON.stringify(RAHUL_PROBE.predictKeyPoints))}::jsonb,
  ${q(RAHUL_PROBE.mutationTask)}, 'preloaded_demo_snapshot'
FROM skills s WHERE s.slug = 'javascript'
ON CONFLICT (id) DO NOTHING;`);

  // Mock drive history: CSE students before (September) and after (November) a SQL workshop, so the
  // cohort report shows the PS example "60% weak in SQL → workshop → 25%". Other branches: one attempt.
  const attempts = [], roundRows = [];
  const mockFor = (st, label, whenMs, sqlWeakP) => {
    const id = uid(`mock:${st.key}:${label}`);
    const role = st.dept === 'cse' || st.dept === 'it' ? 'Backend Developer' : st.dept === 'entc' ? 'Embedded Systems Engineer' : st.dept === 'mech' ? 'Design Engineer (GET)' : st.dept === 'dce' ? 'Junior Site Engineer' : 'Solar Installation Technician';
    const base = (st.cgpa - 5) / 5;
    const apt = Math.max(8, Math.min(29, Math.round(12 + base * 14 + between2(-3, 3))));
    const sqlWeak = rand2() < sqlWeakP;
    const mach = Math.max(2, Math.min(20, Math.round(8 + base * 9 + between2(-3, 3) - (sqlWeak ? 4 : 0))));
    const intv = Math.max(6, Math.min(28, Math.round(12 + base * 12 + between2(-4, 4) - (sqlWeak ? 4 : 0))));
    const weak = [];
    if (sqlWeak && role === 'Backend Developer') weak.push('sql');
    if (apt < 18) weak.push(pick2(['percentages', 'time-work', 'number-series', 'sentence-correction']));
    if (mach < 10) weak.push(pick2(['arrays', 'hashing', 'stacks']));
    const pct = (a, b) => Math.round((a / b) * 1000) / 10;
    const report = {
      rounds: [{ round: 'aptitude', score: apt, maxScore: 30, percent: pct(apt, 30) }, { round: 'machine_test', score: mach, maxScore: 20, percent: pct(mach, 20) }, { round: 'interview', score: intv, maxScore: 30, percent: pct(intv, 30) }],
      totalPercent: pct(apt + mach + intv, 80), weakTopics: weak, marksLost: [], summary: weak.length ? `Weak in ${weak.join(' + ')}.` : 'No weak topics in this attempt.', skillSignals: [], synthetic: true,
    };
    attempts.push(row([id, st.studentId, role, 'completed', '{}', '{}', '{}', JSON.stringify(report), iso(whenMs), iso(whenMs + 2 * 3600_000)]));
    roundRows.push(row([uid(`mr:${id}:a`), id, 'aptitude', apt, 30, '{"synthetic": true}', iso(whenMs + 3600_000)]));
    roundRows.push(row([uid(`mr:${id}:m`), id, 'machine_test', mach, 20, '{"synthetic": true}', iso(whenMs + 3600_000)]));
    roundRows.push(row([uid(`mr:${id}:i`), id, 'interview', intv, 30, '{"synthetic": true}', iso(whenMs + 3600_000)]));
  };
  const SEPT = Date.UTC(2026, 8, 18), NOVM = Date.UTC(2026, 10, 6);
  for (const st of studentIndex) {
    if (st.isHero) continue;
    if (st.dept === 'cse') {
      if (rand2() < 0.85) { mockFor(st, 'sept', SEPT, 0.6); mockFor(st, 'nov', NOVM, 0.25); }
    } else if (rand2() < 0.6) mockFor(st, 'oct', Date.UTC(2026, 9, 10), 0.4);
  }
  out.push(chunked(`INSERT INTO mock_attempts (id, student_id, role_title, status, aptitude_question_ids, coding_problem_ids, interview_question_ids, report, started_at, completed_at) VALUES`, attempts, `ON CONFLICT (id) DO NOTHING`));
  out.push(chunked(`INSERT INTO mock_round_results (id, attempt_id, round, score, max_score, details, completed_at) VALUES`, roundRows, `ON CONFLICT (id) DO NOTHING`));

  const baseline = uid('kpi:baseline');
  out.push(`INSERT INTO kpi_snapshots (id, org_id, label, taken_at, metrics) VALUES
${row([baseline, COL_A, 'Season baseline (synthetic)', iso(SEPT + 3 * day), JSON.stringify({ synthetic: true, note: 'Baseline captured before the SQL workshop.' })])}
ON CONFLICT (id) DO NOTHING;`);
  out.push(`INSERT INTO interventions (id, org_id, title, skill_id, department_id, starts_on, ends_on, before_snapshot_id, created_by)
SELECT ${q(uid('intervention:sql'))}::uuid, ${q(COL_A)}::uuid, 'SQL workshop for Computer Engineering', s.id, ${q(uid('dept:cse'))}::uuid, '2026-10-05', '2026-10-16', ${q(baseline)}::uuid, ${q(memberOf('tpo-a'))}::uuid
FROM skills s WHERE s.slug = 'sql'
ON CONFLICT (id) DO NOTHING;`);
  out.unshift(`-- Summary: ${summary.students} students, ${summary.minors} minors by date of birth, ${summary.verified} verified skills,\n-- ${drives.length} drives, ${funnel.length} applications in the completed drive. Reference date 2026-11-16.\n`);
  return { sql: out.join('\n\n') + '\n', summary };
}

fs.writeFileSync(path.join(SEEDS, '010_skill_taxonomy.sql'), taxonomySql());
fs.writeFileSync(path.join(SEEDS, '015_assessment_banks.sql'), banksSql());
const { sql, summary } = demoTenantSql();
fs.writeFileSync(path.join(SEEDS, '020_synthetic_demo_tenant.sql'), sql);
console.log(`[SEED-GEN] taxonomy: ${TAXONOMY.length} skills`);
console.log(`[SEED-GEN] demo tenant: ${JSON.stringify(summary)}`);
