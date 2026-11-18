/**
 * Mock Drive engine (PS p4, ST-05): per-student aptitude sampling, scoring of the three rounds and the
 * personal report ("score per round, weak topics, where marks were lost"). Pure and deterministic.
 */
import { createHash } from 'crypto';

export interface AptitudeQuestion {
  id: string;
  topic: 'quantitative' | 'logical' | 'verbal';
  subtopic: string;
  difficulty: number;
  stem: string;
  options: string[];
  answerIndex: number;
  explanation: string;
}

export interface CodingTestCase { input: unknown[]; expected: unknown; description?: string }

export interface JudgeCaseResult {
  index: number;
  passed: boolean;
  description?: string;
  expected?: unknown;
  received?: unknown;
  error?: string;
}

export interface InterviewKeyPoint {
  point: string;
  /** Any of these phrases (case-insensitive) counts as covering the point. */
  keywords: string[];
}

export const APTITUDE_PER_TOPIC = { quantitative: 10, logical: 10, verbal: 10 } as const;
export const WEAK_TOPIC_THRESHOLD = 0.6;

/** Seeded PRNG so a student's set is reproducible for audit but differs between students and attempts. */
function seededRandom(seed: string): () => number {
  let h = parseInt(createHash('sha256').update(seed).digest('hex').slice(0, 8), 16) >>> 0;
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Picks 30 questions (10 per topic) for one student attempt, spread across subtopics and difficulties.
 * Throws if the bank cannot supply a full set.
 */
export function sampleAptitudeSet(bank: AptitudeQuestion[], seed: string): AptitudeQuestion[] {
  const rand = seededRandom(seed);
  const out: AptitudeQuestion[] = [];
  for (const [topic, n] of Object.entries(APTITUDE_PER_TOPIC)) {
    const pool = bank.filter(q => q.topic === topic);
    if (pool.length < n) throw new Error(`Aptitude bank has only ${pool.length} ${topic} questions; ${n} needed.`);
    // Round-robin over subtopics so every set covers the breadth of the topic.
    const bySub = new Map<string, AptitudeQuestion[]>();
    for (const q of [...pool].sort((a, b) => a.id.localeCompare(b.id))) {
      const arr = bySub.get(q.subtopic) ?? [];
      arr.push(q);
      bySub.set(q.subtopic, arr);
    }
    for (const arr of bySub.values()) {
      for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    }
    const subs = [...bySub.keys()].sort();
    for (let i = subs.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [subs[i], subs[j]] = [subs[j], subs[i]]; }
    let k = 0;
    while (out.filter(q => q.topic === topic).length < n) {
      const arr = bySub.get(subs[k % subs.length])!;
      const q = arr.shift();
      if (q) out.push(q);
      k++;
    }
  }
  return out;
}

export interface TopicScore { topic: string; correct: number; total: number; accuracy: number }

export interface AptitudeResult {
  score: number;
  maxScore: number;
  byTopic: TopicScore[];
  bySubtopic: TopicScore[];
  weakTopics: string[];
  review: { questionId: string; correct: boolean; chosen: number | null; answer: number; explanation: string; subtopic: string }[];
}

export function scoreAptitude(questions: AptitudeQuestion[], answers: Record<string, number | null>): AptitudeResult {
  const tally = (key: (q: AptitudeQuestion) => string) => {
    const m = new Map<string, { correct: number; total: number }>();
    for (const q of questions) {
      const t = m.get(key(q)) ?? { correct: 0, total: 0 };
      t.total += 1;
      if (answers[q.id] === q.answerIndex) t.correct += 1;
      m.set(key(q), t);
    }
    return [...m.entries()].map(([topic, t]) => ({ topic, ...t, accuracy: t.total ? t.correct / t.total : 0 }))
      .sort((a, b) => a.topic.localeCompare(b.topic));
  };
  const bySubtopic = tally(q => q.subtopic);
  return {
    score: questions.filter(q => answers[q.id] === q.answerIndex).length,
    maxScore: questions.length,
    byTopic: tally(q => q.topic),
    bySubtopic,
    weakTopics: bySubtopic.filter(t => t.accuracy < WEAK_TOPIC_THRESHOLD).map(t => t.topic),
    review: questions.map(q => ({
      questionId: q.id, correct: answers[q.id] === q.answerIndex, chosen: answers[q.id] ?? null,
      answer: q.answerIndex, explanation: q.explanation, subtopic: q.subtopic,
    })),
  };
}

export interface MachineProblemResult {
  problemId: string;
  title: string;
  marks: number;
  maxMarks: number;
  passed: number;
  total: number;
  topics: string[];
  marksLost: { description: string; marks: number; detail: string }[];
}

/** Partial marks: each hidden test is worth an equal share of the problem's marks, rounded to 0.5. */
export function scoreMachineProblem(
  problem: { id: string; title: string; marks: number; topics: string[]; hiddenTests: CodingTestCase[] },
  results: JudgeCaseResult[]
): MachineProblemResult {
  const total = problem.hiddenTests.length;
  const perCase = total ? problem.marks / total : 0;
  const passed = results.filter(r => r.passed).length;
  const round = (x: number) => Math.round(x * 2) / 2;
  return {
    problemId: problem.id,
    title: problem.title,
    marks: round(perCase * passed),
    maxMarks: problem.marks,
    passed,
    total,
    topics: problem.topics,
    marksLost: results.filter(r => !r.passed).map(r => ({
      description: problem.hiddenTests[r.index]?.description ?? `Hidden test ${r.index + 1}`,
      marks: round(perCase),
      detail: r.error ? `Error: ${r.error}` : `Expected ${JSON.stringify(r.expected)}, got ${JSON.stringify(r.received)}`,
    })),
  };
}

export interface InterviewAnswerScore {
  questionId: string;
  topic: string;
  score: number;      // 0–10
  covered: string[];
  missed: string[];
}

/**
 * Content-only rubric scoring: the share of expected key points an answer covers. No voice, video,
 * keystroke or behavioural signals are used (PS p2: no behavioural monitoring). The result is a draft
 * the student may send for human review.
 */
export function scoreInterviewAnswer(q: { id: string; topic: string; keyPoints: InterviewKeyPoint[] }, answer: string): InterviewAnswerScore {
  const text = ` ${answer.toLowerCase().replace(/\s+/g, ' ')} `;
  const covered: string[] = [], missed: string[] = [];
  for (const kp of q.keyPoints) {
    (kp.keywords.some(k => text.includes(k.toLowerCase())) ? covered : missed).push(kp.point);
  }
  const n = q.keyPoints.length || 1;
  return { questionId: q.id, topic: q.topic, score: Math.round((covered.length / n) * 100) / 10, covered, missed };
}

export interface MockReport {
  rounds: { round: 'aptitude' | 'machine_test' | 'interview'; score: number; maxScore: number; percent: number }[];
  totalPercent: number;
  weakTopics: string[];
  marksLost: { round: string; description: string; marks: number; detail: string }[];
  summary: string;
  /** Skills each round can count as Assessed (L2) evidence for, when the round is passed. */
  skillSignals: { skillSlug: string; round: string; percent: number; passed: boolean }[];
}

const APTITUDE_SKILL: Record<string, string> = { quantitative: 'quant-aptitude', logical: 'logical-reasoning', verbal: 'verbal-ability' };
export const ROUND_PASS_PERCENT = 60;

const TOPIC_LABEL: Record<string, string> = {
  sql: 'SQL', joins: 'SQL joins', databases: 'databases', 'data-structures': 'data structures', arrays: 'arrays', strings: 'strings',
  hashing: 'hashing', 'problem-solving': 'problem solving', recursion: 'recursion', sorting: 'sorting',
};
const label = (t: string) => TOPIC_LABEL[t] ?? t.replace(/-/g, ' ');

export function buildMockReport(input: {
  aptitude: AptitudeResult;
  machine: MachineProblemResult[];
  interview: InterviewAnswerScore[];
  machineSkillSlugs: string[];
}): MockReport {
  const mScore = input.machine.reduce((s, p) => s + p.marks, 0);
  const mMax = input.machine.reduce((s, p) => s + p.maxMarks, 0);
  const iScore = Math.round(input.interview.reduce((s, a) => s + a.score, 0) * 10) / 10;
  const iMax = input.interview.length * 10;
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

  const rounds: MockReport['rounds'] = [
    { round: 'aptitude', score: input.aptitude.score, maxScore: input.aptitude.maxScore, percent: pct(input.aptitude.score, input.aptitude.maxScore) },
    { round: 'machine_test', score: mScore, maxScore: mMax, percent: pct(mScore, mMax) },
    { round: 'interview', score: iScore, maxScore: iMax, percent: pct(iScore, iMax) },
  ];

  const weak = new Set<string>(input.aptitude.weakTopics);
  for (const p of input.machine) if (p.total && p.passed / p.total < WEAK_TOPIC_THRESHOLD) p.topics.forEach(t => weak.add(t));
  const interviewTopic = new Map<string, { s: number; n: number }>();
  for (const a of input.interview) {
    const t = interviewTopic.get(a.topic) ?? { s: 0, n: 0 };
    t.s += a.score; t.n += 1; interviewTopic.set(a.topic, t);
  }
  for (const [topic, t] of interviewTopic) if (t.s / t.n < WEAK_TOPIC_THRESHOLD * 10) weak.add(topic);

  const marksLost = [
    ...input.machine.flatMap(p => p.marksLost.map(m => ({ round: `Machine test: ${p.title}`, ...m }))),
    ...input.interview.filter(a => a.missed.length).map(a => ({
      round: 'Interview', description: `${label(a.topic)}: missed ${a.missed.length} key point(s)`, marks: Math.round((10 - a.score) * 10) / 10,
      detail: `Not covered: ${a.missed.join('; ')}`,
    })),
  ];

  const weakList = [...weak];
  const summary = weakList.length
    ? `Weak in ${weakList.slice(0, 3).map(label).join(' + ')}.`
    : 'No weak topics in this attempt.';

  const skillSignals = [
    ...input.aptitude.byTopic.map(t => ({ skillSlug: APTITUDE_SKILL[t.topic], round: 'aptitude', percent: pct(t.correct, t.total), passed: pct(t.correct, t.total) >= ROUND_PASS_PERCENT })),
    ...input.machineSkillSlugs.map(s => ({ skillSlug: s, round: 'machine_test', percent: pct(mScore, mMax), passed: pct(mScore, mMax) >= ROUND_PASS_PERCENT })),
  ].filter(s => !!s.skillSlug);

  return { rounds, totalPercent: pct(input.aptitude.score + mScore + iScore, input.aptitude.maxScore + mMax + iMax), weakTopics: weakList, marksLost, summary, skillSignals };
}
