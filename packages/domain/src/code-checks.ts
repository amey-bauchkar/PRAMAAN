import { createHash } from 'crypto';
import { stableStringify } from './eligibility-evaluator.js';
import type { JudgeCaseResult } from './mock-drive.js';

/**
 * Two checks on the work itself (not on how the student behaved): how close a submission is to another student's, and a short
 * follow-up where the student must say what their own code does on an input they never saw.
 * Both judge executed or submitted code, so they apply to every student, including under-18s. Neither watches typing or the camera.
 */

// ---------------------------------------------------------------------------
// Similarity
// ---------------------------------------------------------------------------

const JS_KEYWORDS = new Set('break case catch class const continue default delete do else export extends finally for function if import in instanceof let new of return super switch this throw try typeof var void while yield async await true false null undefined'.split(' '));
const SQL_KEYWORDS = new Set('select from where group by having order limit offset join inner left right full outer cross on as and or not in is null like between exists case when then else end distinct union all asc desc with over partition count sum avg min max coalesce cast true false'.split(' '));

/**
 * Tokens that ignore comments, spacing, quoting and the names the student chose, but keep structure, operators and
 * built-in names. Renaming every variable therefore does not hide a copy.
 */
export function codeTokens(src: string, language: 'javascript' | 'sql'): string[] {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  s = language === 'sql' ? s.replace(/--.*$/gm, ' ') : s.replace(/\/\/.*$/gm, ' ');
  const kw = language === 'sql' ? SQL_KEYWORDS : JS_KEYWORDS;
  const re = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`|\d+(?:\.\d+)?|[A-Za-z_$][\w$]*|===|!==|=>|==|!=|<=|>=|&&|\|\||\+\+|--|\S/g;
  const names = new Map<string, string>();
  const out: string[] = [];
  let prev = '';
  for (const t of s.match(re) ?? []) {
    let tok: string;
    if (/^['"`]/.test(t)) tok = 'S';
    else if (/^\d/.test(t)) tok = 'N';
    else if (/^[A-Za-z_$]/.test(t)) {
      const low = language === 'sql' ? t.toLowerCase() : t;
      if (kw.has(low)) tok = low;
      else if (language === 'javascript' && prev === '.') tok = `.${t}`; // property and method names (map, length) carry meaning
      else { if (!names.has(t)) names.set(t, `v${names.size}`); tok = names.get(t) as string; }
    } else tok = t;
    out.push(tok);
    prev = tok;
  }
  return out;
}

function grams(tokens: string[], k: number): Set<string> {
  const g = new Set<string>();
  for (let i = 0; i + k <= tokens.length; i++) g.add(tokens.slice(i, i + k).join(' '));
  return g;
}

/** Jaccard similarity of token 4-grams, from 0 to 1. */
export function codeSimilarity(a: string[], b: string[], k = 4): number {
  const A = grams(a, k), B = grams(b, k);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export interface SimilarityConfig {
  /** Shorter solutions are too small to tell a copy from the obvious answer. */
  minTokens: number;
  threshold: number;
  /** The pair must be closer to each other than either is to the reference solution, by this much. */
  margin: number;
}
export const DEFAULT_SIMILARITY: SimilarityConfig = { minTokens: 40, threshold: 0.9, margin: 0.1 };

export interface SimilarityVerdict { flagged: boolean; score: number; tokens: number; peers: number; /** Index in `peers` of the closest one that triggered the flag, or -1. */ closest: number }

/**
 * Compares one submission with the other students' submissions for the same problem. Two students who both write the
 * textbook answer are close to the reference solution, so they are not flagged; two who match each other but not the
 * reference are.
 */
export function judgeSimilarity(
  student: string[], peers: string[][], reference: string[] | null, cfg: SimilarityConfig = DEFAULT_SIMILARITY
): SimilarityVerdict {
  const base = { flagged: false, score: 0, tokens: student.length, peers: peers.length, closest: -1 };
  if (student.length < cfg.minTokens) return base;
  const refStudent = reference ? codeSimilarity(student, reference) : 0;
  let best = 0, flagged = false, closest = -1;
  for (const [i, p] of peers.entries()) {
    if (p.length < cfg.minTokens) continue;
    const s = codeSimilarity(student, p);
    const refPeer = reference ? codeSimilarity(p, reference) : 0;
    const hit = s >= cfg.threshold && s >= Math.max(refStudent, refPeer) + cfg.margin;
    if (hit && (!flagged || s > best)) { closest = i; best = s; }
    else if (!flagged) best = Math.max(best, s);
    flagged = flagged || hit;
  }
  return { ...base, flagged, closest, score: Math.round(best * 100) / 100 };
}

// ---------------------------------------------------------------------------
// "Defend your answer": what does your own code do on an input you have not seen?
// ---------------------------------------------------------------------------

export interface DefenceTest { index: number; kind: 'js' | 'sql'; args?: unknown[]; setup?: string; expected: unknown }

const short = (v: unknown, n: number) => { try { const s = JSON.stringify(v); return s !== undefined && s.length <= n; } catch { return false; } };

/**
 * Picks one hidden test that the student's code PASSED, so the right answer is known without running anything again, and
 * the student has not seen the input. JavaScript: the call and its result. SQL: how many rows the query returns on the data.
 */
export function pickDefenceTest(
  problem: { language: string; hiddenTests: any[] }, results: JudgeCaseResult[], seed: string
): DefenceTest | null {
  const ok: DefenceTest[] = [];
  for (const r of results) {
    const t = problem.hiddenTests[r.index];
    if (!r.passed || !t) continue;
    if (problem.language === 'sql') {
      if (typeof t.setup === 'string' && t.setup.length <= 700 && Array.isArray(r.expected) && r.expected.length < 5) ok.push({ index: r.index, kind: 'sql', setup: t.setup, expected: r.expected.length });
    } else if (Array.isArray(t.input) && !t.expectError && t.expected !== undefined && short(t.input, 160) && short(t.expected, 160)) {
      ok.push({ index: r.index, kind: 'js', args: t.input, expected: t.expected });
    }
  }
  if (ok.length === 0) return null;
  const h = parseInt(createHash('sha256').update(seed).digest('hex').slice(0, 8), 16);
  return ok[h % ok.length];
}

/** True when the student's typed answer matches. JavaScript answers are read as JSON (`5`, `"abc"`, `[1,2]`). SQL answers are a row count. */
export function checkDefenceAnswer(kind: 'js' | 'sql', raw: string, expected: unknown): boolean {
  const t = String(raw ?? '').trim();
  if (t === '' || t.length > 400) return false;
  if (kind === 'sql') return /^\d+$/.test(t) && Number(t) === expected;
  let parsed: unknown;
  try { parsed = JSON.parse(t); } catch { return typeof expected === 'string' && t === expected; }
  return stableStringify(parsed) === stableStringify(expected);
}

export const DEFENCE_SECONDS_PER_QUESTION = 150;
