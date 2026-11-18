import { describe, it, expect } from 'vitest';
import { LocalJudge } from '../src/v2/judge.js';

/** Phase 3: judge correctness and isolation checks for the local development runner. */
describe('Local judge: JavaScript', () => {
  const judge = new LocalJudge();
  const tests = [
    { input: [[2, 7, 11, 15], 9], expected: [0, 1], description: 'example' },
    { input: [[], 5], expected: [], description: 'empty' },
  ];

  it('passes a correct solution and gives per-test results for a wrong one', async () => {
    const ok = await judge.runJavaScript('function twoSum(n,t){const m=new Map();for(let j=0;j<n.length;j++){if(m.has(t-n[j]))return[m.get(t-n[j]),j];m.set(n[j],j)}return[]}', 'twoSum', tests);
    expect(ok.passed).toBe(2);
    const bad = await judge.runJavaScript('function twoSum(n,t){return null}', 'twoSum', tests);
    expect(bad.passed).toBe(0);
    expect(bad.results[0]).toMatchObject({ passed: false, received: null, expected: [0, 1] });
  });

  it('checks expected errors', async () => {
    const r = await judge.runJavaScript('function f(x){ if (x > 100) throw new RangeError("no"); return x; }', 'f',
      [{ input: [120], expectError: 'RangeError' }, { input: [5], expected: 5 }]);
    expect(r.passed).toBe(2);
  });

  it('stops infinite loops with a timeout', async () => {
    const r = await judge.runJavaScript('function f(){ while(true){} }', 'f', [{ input: [], expected: 1 }]);
    expect(r.passed).toBe(0);
    expect(JSON.stringify(r.results[0])).toMatch(/Timeout|Time limit/);
  }, 20_000);

  it('gives student code no access to require, process, globalThis host objects or the network', async () => {
    const probes = [
      'function f(){ return typeof require }',
      'function f(){ return typeof process }',
      'function f(){ return typeof fetch }',
      'function f(){ return typeof globalThis.process }',
      'function f(){ try { return typeof this.constructor.constructor("return process")() } catch(e) { return "blocked" } }',
      'function f(x){ try { return typeof x.constructor.constructor("return process")() } catch(e) { return "blocked" } }',
    ];
    for (const code of probes) {
      const r = await judge.runJavaScript(code, 'f', [{ input: [[1]], expected: 'undefined' }]);
      const v = r.results[0].received;
      expect(['undefined', 'blocked']).toContain(v);
    }
  }, 30_000);

  it('rejects an unsafe entry name', async () => {
    await expect(judge.runJavaScript('', 'f;process.exit()', [])).rejects.toThrow(/Invalid entry/);
  });
});

describe('Local judge: SQL (throwaway database per test)', () => {
  const judge = new LocalJudge();
  const schema = 'CREATE TABLE departments (id INT PRIMARY KEY, name TEXT); CREATE TABLE employees (id INT PRIMARY KEY, name TEXT, dept_id INT, salary INT);';
  const tests = [
    { setup: "INSERT INTO departments VALUES (1,'Eng'),(2,'Legal'); INSERT INTO employees VALUES (1,'A',1,10),(2,'B',1,20);", description: 'empty department' },
  ];
  const reference = 'SELECT d.name, COUNT(e.id)::int AS headcount FROM departments d LEFT JOIN employees e ON e.dept_id = d.id GROUP BY d.name ORDER BY headcount DESC, d.name';

  it('passes a correct query and fails an INNER JOIN that drops the empty department', async () => {
    expect((await judge.runSql(schema, tests, reference, reference)).passed).toBe(1);
    const inner = await judge.runSql(schema, tests, 'SELECT d.name, COUNT(e.id)::int AS headcount FROM departments d JOIN employees e ON e.dept_id = d.id GROUP BY d.name ORDER BY headcount DESC, d.name', reference);
    expect(inner.passed).toBe(0);
  }, 60_000);

  it('rejects multiple statements and reports SQL errors per test', async () => {
    expect((await judge.runSql(schema, tests, 'SELECT 1; DROP TABLE employees', reference)).compileError).toMatch(/single SQL statement/);
    const err = await judge.runSql(schema, tests, 'SELECT nope FROM employees', reference);
    expect(err.results[0].error).toMatch(/nope/);
  }, 60_000);
});
