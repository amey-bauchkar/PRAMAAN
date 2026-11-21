import { describe, it, expect } from 'vitest';
import { codeTokens, codeSimilarity, judgeSimilarity, pickDefenceTest, checkDefenceAnswer } from '../src/code-checks.js';
import { summarizeIntegrity, mayAwardProof } from '../src/proctoring.js';

const twoSum = `function twoSum(nums, target) {
  const seen = new Map();
  for (let i = 0; i < nums.length; i++) {
    const need = target - nums[i];
    if (seen.has(need)) return [seen.get(need), i];
    seen.set(nums[i], i);
  }
  return [];
}`;
const renamed = `// find the pair
function twoSum(arr, goal) {
  const lookup = new Map();
  for (let k = 0; k < arr.length; k++) {
    const rest = goal - arr[k];
    if (lookup.has(rest)) return [lookup.get(rest), k];
    lookup.set(arr[k], k);
  }
  return [];
}`;
const different = `function twoSum(nums, target) {
  for (let i = 0; i < nums.length; i++) {
    for (let j = i + 1; j < nums.length; j++) {
      if (nums[i] + nums[j] === target) return [i, j];
    }
  }
  return [];
}`;
const T = (s: string) => codeTokens(s, 'javascript');

describe('code similarity', () => {
  it('sees through renamed variables, comments and spacing', () => {
    expect(codeSimilarity(T(twoSum), T(renamed))).toBeGreaterThan(0.95);
  });
  it('tells a different algorithm apart', () => {
    expect(codeSimilarity(T(twoSum), T(different))).toBeLessThan(0.5);
  });
  it('does not treat -- as a comment in JavaScript, but does in SQL', () => {
    expect(codeTokens('while (n--) x++;', 'javascript')).toContain('--');
    expect(codeTokens('select 1 -- note', 'sql')).toEqual(['select', 'N']);
  });
  it('flags two copies that differ from the reference, not two students who both wrote the reference', () => {
    const ref = T(different);
    expect(judgeSimilarity(T(twoSum), [T(renamed)], ref).flagged).toBe(true);
    expect(judgeSimilarity(T(different), [T(different)], ref).flagged).toBe(false);
  });
  it('ignores answers too short to tell apart, and unrelated peers', () => {
    expect(judgeSimilarity(T('function f(a){return a}'), [T('function f(a){return a}')], null).flagged).toBe(false);
    expect(judgeSimilarity(T(twoSum), [T(different)], null).flagged).toBe(false);
  });
});

describe('defend your answer', () => {
  const problem = { language: 'javascript', hiddenTests: [
    { input: [[2, 7], 9], expected: [0, 1] },
    { input: [[1, 2, 3]], expected: 6 },
    { input: [[1]], expected: undefined },
    { input: [[3]], expected: 3, expectError: 'RangeError' },
  ] };
  const res = [{ index: 0, passed: true }, { index: 1, passed: false }, { index: 2, passed: true }, { index: 3, passed: true }];
  it('picks only a hidden test the student passed that has a short, definite answer', () => {
    const t = pickDefenceTest(problem, res, 'seed');
    expect(t).toMatchObject({ index: 0, kind: 'js', expected: [0, 1] });
  });
  it('is deterministic for a seed and returns null when nothing qualifies', () => {
    expect(pickDefenceTest(problem, res, 'seed')).toEqual(pickDefenceTest(problem, res, 'seed'));
    expect(pickDefenceTest(problem, res.map(r => ({ ...r, passed: false })), 'seed')).toBeNull();
  });
  it('SQL: asks for a row count only when every expected row is known', () => {
    const sql = { language: 'sql', hiddenTests: [{ setup: "INSERT INTO t VALUES (1);" }, { setup: 'x'.repeat(800) }] };
    const r = [{ index: 0, passed: true, expected: [{ a: 1 }, { a: 2 }] }, { index: 1, passed: true, expected: [{ a: 1 }] }];
    expect(pickDefenceTest(sql, r, 's')).toMatchObject({ index: 0, kind: 'sql', expected: 2 });
    expect(pickDefenceTest(sql, [{ index: 0, passed: true, expected: [1, 2, 3, 4, 5] }], 's')).toBeNull();
  });
  it('checks answers as JSON values, tolerating spacing and key order', () => {
    expect(checkDefenceAnswer('js', ' [0,  1] ', [0, 1])).toBe(true);
    expect(checkDefenceAnswer('js', '[1,0]', [0, 1])).toBe(false);
    expect(checkDefenceAnswer('js', '{"b":1,"a":2}', { a: 2, b: 1 })).toBe(true);
    expect(checkDefenceAnswer('js', 'hello', 'hello')).toBe(true);
    expect(checkDefenceAnswer('js', '', 6)).toBe(false);
    expect(checkDefenceAnswer('sql', '3', 3)).toBe(true);
    expect(checkDefenceAnswer('sql', '3 rows', 3)).toBe(false);
  });
});

describe('students under 18', () => {
  it('are exempt from the camera and test-window rules, and may still earn proof', () => {
    const s = summarizeIntegrity([{ kind: 'tab_hidden' }], { exempt: true });
    expect(s.status).toBe('exempt');
    expect(s.major).toBe(0);
    expect(mayAwardProof(s)).toBe(true);
  });
});
