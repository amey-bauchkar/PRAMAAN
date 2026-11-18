import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import {
  sampleAptitudeSet, scoreAptitude, scoreMachineProblem, scoreInterviewAnswer, buildMockReport, AptitudeQuestion,
} from '../src/mock-drive.js';
import { computeKpis, readiness, cohortForecast, wilson, extractSkills, demandVsSupply, planLearningPath } from '../src/analytics.js';
import { detectClashes, parseCompanyEmail, allocateRooms } from '../src/calendar.js';
import { buildOpenBadge, issuerKeyFromSeed, signCredential, verifyCredential } from '../src/credentials.js';
import { matchCandidates, accreditationSummary, toCsv } from '../src/placement-reports.js';

const NOW = '2026-11-16T00:00:00.000Z';

function bank(): AptitudeQuestion[] {
  const out: AptitudeQuestion[] = [];
  const topics: [AptitudeQuestion['topic'], string[]][] = [
    ['quantitative', ['percentages', 'ratios', 'time-work', 'speed-distance']],
    ['logical', ['series', 'coding-decoding', 'syllogisms']],
    ['verbal', ['synonyms', 'grammar', 'reading']],
  ];
  for (const [topic, subs] of topics) for (const sub of subs) for (let i = 0; i < 6; i++) {
    out.push({ id: `${topic}-${sub}-${i}`, topic, subtopic: sub, difficulty: 1 + (i % 3), stem: `${sub} ${i}`, options: ['a', 'b', 'c', 'd'], answerIndex: i % 4, explanation: 'x' });
  }
  return out;
}

describe('Mock drive engine (ST-05)', () => {
  it('gives every student 30 questions (10 per topic) covering all subtopics, different between students, reproducible per seed', () => {
    const a = sampleAptitudeSet(bank(), 'student-a:attempt-1');
    const b = sampleAptitudeSet(bank(), 'student-b:attempt-1');
    expect(a).toHaveLength(30);
    expect(a.filter(q => q.topic === 'logical')).toHaveLength(10);
    expect(new Set(a.filter(q => q.topic === 'quantitative').map(q => q.subtopic)).size).toBe(4);
    expect(new Set(a.map(q => q.id)).size).toBe(30);
    expect(a.map(q => q.id)).not.toEqual(b.map(q => q.id));
    expect(sampleAptitudeSet(bank(), 'student-a:attempt-1').map(q => q.id)).toEqual(a.map(q => q.id));
  });

  it('scores aptitude and finds weak subtopics', () => {
    const qs = sampleAptitudeSet(bank(), 's');
    const answers = Object.fromEntries(qs.map(q => [q.id, q.subtopic === 'percentages' ? (q.answerIndex + 1) % 4 : q.answerIndex]));
    const r = scoreAptitude(qs, answers);
    expect(r.score).toBe(30 - qs.filter(q => q.subtopic === 'percentages').length);
    expect(r.weakTopics).toEqual(['percentages']);
  });

  it('gives partial machine-test marks per hidden test and explains every mark lost', () => {
    const problem = { id: 'p', title: 'Two Sum', marks: 10, topics: ['hashing'], hiddenTests: [
      { input: [[1, 2], 3], expected: [0, 1], description: 'basic' },
      { input: [[], 3], expected: [], description: 'empty array' },
      { input: [[3, 3], 6], expected: [0, 1], description: 'duplicates' },
      { input: [[1], 2], expected: [], description: 'single element' },
    ] };
    const r = scoreMachineProblem(problem, [
      { index: 0, passed: true }, { index: 1, passed: false, expected: [], received: null },
      { index: 2, passed: true }, { index: 3, passed: true },
    ]);
    expect(r.marks).toBe(7.5);
    expect(r.marksLost).toEqual([{ description: 'empty array', marks: 2.5, detail: 'Expected [], got null' }]);
  });

  it('interview scoring is content-only: covered key points out of 10', () => {
    const s = scoreInterviewAnswer({ id: 'q', topic: 'databases', keyPoints: [
      { point: 'Explains what an index is', keywords: ['index'] },
      { point: 'Mentions trade-off on writes', keywords: ['slower insert', 'write overhead', 'slows down writes'] },
    ] }, 'An index is a B-tree that speeds up lookups.');
    expect(s.score).toBe(5);
    expect(s.missed).toEqual(['Mentions trade-off on writes']);
  });

  it('builds a report matching the PS example: weak topics and skill signals per round', () => {
    const qs = sampleAptitudeSet(bank(), 'rahul');
    const answers = Object.fromEntries(qs.map((q, i) => [q.id, i < 21 ? q.answerIndex : null]));
    const report = buildMockReport({
      aptitude: scoreAptitude(qs, answers),
      machine: [
        { problemId: 'a', title: 'A', marks: 7, maxMarks: 10, passed: 7, total: 10, topics: ['arrays'], marksLost: [] },
        { problemId: 'b', title: 'B', marks: 5, maxMarks: 10, passed: 2, total: 4, topics: ['sql'], marksLost: [] },
      ],
      interview: [{ questionId: 'i', topic: 'databases', score: 3, covered: [], missed: ['joins'] }],
      machineSkillSlugs: ['problem-solving'],
    });
    expect(report.rounds.map(r => `${r.score}/${r.maxScore}`)).toEqual(['21/30', '12/20', '3/10']);
    expect(report.weakTopics).toEqual(expect.arrayContaining(['sql', 'databases']));
    expect(report.summary).toMatch(/^Weak in /);
    expect(report.skillSignals.find(s => s.skillSlug === 'problem-solving')).toMatchObject({ percent: 60, passed: true });
  });
});

describe('Analytics', () => {
  it('KPIs carry numerator, denominator and formula; empty denominators give null, not 0', () => {
    const k = computeKpis({ optedIn: 200, placedStudents: 120, requiredSkillSlots: 1000, verifiedRequiredSkillSlots: 450,
      gapsOpenAtSeasonStart: 300, gapsClosedSinceSeasonStart: 105, shortlisted: 80, offers: 20, daysToShortlist: [4, 9, 6],
      recruiterActions: { evidenceCardsOpened: 30, feedbackGiven: 5, reprobesRequested: 2 }, activeRecruiters: 0 });
    expect(k.find(x => x.key === 'placement_rate')).toMatchObject({ value: 60, numerator: 120, denominator: 200 });
    expect(k.find(x => x.key === 'gap_closure_rate')?.value).toBe(35);
    expect(k.find(x => x.key === 'time_to_shortlist')?.value).toBe(6);
    expect(k.find(x => x.key === 'recruiter_engagement')?.value).toBeNull();
  });

  it('readiness is a visible weighted sum; missing mock data is disclosed', () => {
    const r = readiness({ studentId: 's', coreSkillsRequired: 5, coreSkillsVerified: 4, latestMockPercent: null, learningTasksAssigned: 0, learningTasksPassed: 0, activeBacklogs: 0 });
    expect(r.score).toBe(Math.round(0.8 * 45 + 0.5 * 30 + 0.5 * 15 + 10));
    expect(r.missingData[0]).toMatch(/No mock drive/);
    expect(r.factors.reduce((s, f) => s + f.weight, 0)).toBeCloseTo(1);
  });

  it('cohort forecast is a range (Wilson interval), not a single number', () => {
    expect(wilson(68, 100).low).toBeCloseTo(0.584, 2);
    const f = cohortForecast(Array.from({ length: 100 }, (_, i) => ({ studentId: `${i}`, score: i < 68 ? 70 : 40, factors: [], missingData: [] })));
    expect(f.estimatePercent).toBe(68);
    expect(f.lowPercent).toBeLessThan(68);
    expect(f.highPercent).toBeGreaterThan(68);
  });

  it('extracts skills by whole word, including C++, C#, .NET and Node.js, without false hits', () => {
    const tax = [
      { skillId: 'cpp', slug: 'cpp', name: 'C++', aliases: [] },
      { skillId: 'cs', slug: 'csharp', name: 'C#', aliases: [] },
      { skillId: 'net', slug: 'dotnet', name: '.NET', aliases: ['asp.net'] },
      { skillId: 'node', slug: 'nodejs', name: 'Node.js', aliases: ['node'] },
      { skillId: 'java', slug: 'java', name: 'Java', aliases: [] },
      { skillId: 'go', slug: 'go', name: 'Go', aliases: ['golang'] },
    ];
    const ids = extractSkills('Experience with C++ and C# on .NET; Node.js services. JavaScript welcome. Ready to go live.', tax).map(m => m.skillId).sort();
    expect(ids).toEqual(['cpp', 'cs', 'net', 'node']);
  });

  it('demand vs supply raises an alert like the PS Docker example, with sample size and dates', () => {
    const jds = Array.from({ length: 10 }, (_, i) => ({ id: `${i}`, postedOn: `2026-0${(i % 6) + 1}-10`, skillIds: i < 4 ? ['docker', 'sql'] : ['sql'] }));
    const cohort = Array.from({ length: 10 }, (_, i) => ({ studentId: `${i}`, verifiedSkillIds: i < 1 ? ['docker'] : ['sql'] }));
    const r = demandVsSupply(jds, cohort, new Map([['docker', 'Docker'], ['sql', 'SQL']]));
    expect(r.sampleSize).toBe(10);
    expect(r.dateFrom).toBe('2026-01-10');
    expect(r.alerts.map(a => a.message)).toEqual(['40% of 10 job descriptions ask for Docker; only 10% of the batch has it Verified.']);
  });

  it('learning path puts drive-unlocking proof first, then weak topics, skipping already-proven skills', () => {
    const tasks = [
      { id: 't1', slug: 'sql-set', skillId: 'sql', skillName: 'SQL', title: 'SQL set', kind: 'coding', targetProof: 'L2' as const, weakTopics: ['sql'], estHours: 2 },
      { id: 't2', slug: 'arrays', skillId: 'ds', skillName: 'DS', title: 'Arrays', kind: 'coding', targetProof: 'L2' as const, weakTopics: ['arrays'], estHours: 2 },
      { id: 't3', slug: 'py', skillId: 'py', skillName: 'Python', title: 'Py', kind: 'coding', targetProof: 'L2' as const, weakTopics: ['arrays'], estHours: 2 },
    ];
    const plan = planLearningPath({
      proofActions: [{ skillId: 'sql', name: 'SQL', unlocksCount: 2, targetProof: 'L2' }],
      weakTopics: ['arrays'], verified: new Map([['py', 2]]), tasks,
    });
    expect(plan.map(p => p.taskId)).toEqual(['t1', 't2']);
    expect(plan[0].reason).toMatch(/unlocks 2 drive/);
  });
});

describe('Calendar (AD-06)', () => {
  it('detects room clashes and student clashes between overlapping drives', () => {
    const events = [
      { id: 'a', driveId: 'd1', title: 'Nimbus aptitude', startsAt: '2026-12-09T10:00:00+05:30', endsAt: '2026-12-09T11:00:00+05:30', roomId: 'r1' },
      { id: 'b', driveId: 'd2', title: 'Quanta test', startsAt: '2026-12-09T10:30:00+05:30', endsAt: '2026-12-09T11:30:00+05:30', roomId: 'r1' },
    ];
    const clashes = detectClashes(events, new Map([['d1', new Set(['s1', 's2'])], ['d2', new Set(['s2'])]]));
    expect(clashes.map(c => c.kind).sort()).toEqual(['room', 'student']);
    expect(clashes.find(c => c.kind === 'student')?.studentCount).toBe(1);
  });

  it('parses a company email into labelled windows, and reports what it cannot parse', () => {
    const p = parseCompanyEmail('We would like to visit on 9 December 2026. Aptitude test 10:00–11:00, technical interviews 11:30 am to 5 pm. HR round to follow.');
    expect(p.date).toBe('2026-12-09');
    expect(p.windows.map(w => [w.kind, w.start, w.end])).toEqual([
      ['aptitude', '2026-12-09T10:00:00+05:30', '2026-12-09T11:00:00+05:30'],
      ['interview', '2026-12-09T11:30:00+05:30', '2026-12-09T17:00:00+05:30'],
    ]);
    expect(parseCompanyEmail('Interviews 10-12').unparsed[0]).toMatch(/No visit date/);
  });

  it('allocates the smallest free room that fits and flags windows with no room', () => {
    const rooms = [{ id: 'big', name: 'Auditorium', capacity: 300 }, { id: 'small', name: 'Lab 2', capacity: 60 }];
    const w = parseCompanyEmail('Visit on 9 December 2026. Aptitude 10:00-11:00').windows;
    expect(allocateRooms(w, rooms, [], 50)[0].roomId).toBe('small');
    expect(allocateRooms(w, rooms, [{ roomId: 'small', startsAt: w[0].start, endsAt: w[0].end }], 50)[0].roomId).toBe('big');
    expect(allocateRooms(w, rooms, [], 500)[0].roomId).toBeNull();
  });
});

describe('Skill Passport credentials', () => {
  const { privateKey, publicKeyPem } = issuerKeyFromSeed('11'.repeat(32));
  const payload = buildOpenBadge({
    credentialId: 'c1', issuer: { id: 'did:web:sahyadri.demo', name: 'College' }, student: { id: 's1', name: 'Rahul' },
    skill: { id: 'k', name: 'SQL' }, proofLevel: 'L2_assessed', method: 'Mock machine test', evidence: [{ id: 'e', kind: 'test_result', description: '12/20' }],
    issuedAt: NOW, validUntil: '2027-11-16T00:00:00.000Z',
  }, 'https://pramaan.example/verify');
  const proofValue = signCredential(payload, privateKey);

  it('is an OpenBadgeCredential that verifies with the issuer key', () => {
    expect(payload.type).toEqual(['VerifiableCredential', 'OpenBadgeCredential']);
    expect(verifyCredential({ payload, proofValue, publicKeyPem, status: 'active', validUntil: '2027-11-16T00:00:00.000Z', now: NOW }).valid).toBe(true);
  });

  it('detects tampering, the wrong key, expiry and revocation', () => {
    const tampered = { ...payload, name: 'SQL — L3 defended' };
    expect(verifyCredential({ payload: tampered, proofValue, publicKeyPem, status: 'active', validUntil: '2027-11-16T00:00:00.000Z', now: NOW }).signatureValid).toBe(false);
    const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'pem', type: 'spki' }).toString();
    expect(verifyCredential({ payload, proofValue, publicKeyPem: other, status: 'active', validUntil: '2027-11-16T00:00:00.000Z', now: NOW }).valid).toBe(false);
    expect(verifyCredential({ payload, proofValue, publicKeyPem, status: 'active', validUntil: '2026-01-01T00:00:00.000Z', now: NOW }).expired).toBe(true);
    expect(verifyCredential({ payload, proofValue, publicKeyPem, status: 'revoked', validUntil: '2027-11-16T00:00:00.000Z', now: NOW }).reasons).toContain('Status is revoked.');
  });
});

describe('Recruiter matching and accreditation', () => {
  it('matches by explicit filters with reasons, sorted by matches then freshness', () => {
    const c = (id: string, proof: 'L1_code_backed' | 'L2_assessed', days: number) => ({
      studentId: id, displayName: id, branch: 'CSE',
      skills: [{ skillId: 'sql', name: 'SQL', state: 'verified', proofLevel: proof, verifiedAt: new Date(Date.parse(NOW) - days * 86_400_000).toISOString(), validUntil: '2027-12-01T00:00:00.000Z' }],
    });
    const r = matchCandidates([c('old', 'L2_assessed', 200), c('new', 'L2_assessed', 10), c('weak', 'L1_code_backed', 1)], [{ skillId: 'sql', name: 'SQL', minProof: 'L2' }], NOW);
    expect(r.map(x => x.studentId)).toEqual(['new', 'old']);
    expect(r[0].matched[0].reason).toMatch(/SQL Verified \(L2 assessed\), 10 days ago/);
    expect(matchCandidates([c('old', 'L2_assessed', 200)], [{ skillId: 'sql', name: 'SQL', minProof: 'L2', maxAgeDays: 180 }], NOW)).toHaveLength(0);
  });

  it('counts each student once in accreditation tables', () => {
    const s = accreditationSummary(new Map([['CSE', 4]]), [
      { studentId: 'a', branch: 'CSE', outcomeType: 'placed', ctcInr: 400000 },
      { studentId: 'a', branch: 'CSE', outcomeType: 'placed', ctcInr: 600000 },
      { studentId: 'b', branch: 'CSE', outcomeType: 'higher_studies', ctcInr: null },
      { studentId: 'c', branch: 'CSE', outcomeType: 'placed', ctcInr: 500000 },
    ]);
    expect(s.rows[0]).toMatchObject({ placed: 2, placedPercent: 50, higherStudies: 1, medianCtcInr: 550000, highestCtcInr: 600000 });
  });

  it('CSV export neutralises spreadsheet formulas', () => {
    expect(toCsv([{ a: '=HYPERLINK("x")', b: 'ok, fine' }])).toBe('a,b\n"\'=HYPERLINK(""x"")","ok, fine"');
  });
});
