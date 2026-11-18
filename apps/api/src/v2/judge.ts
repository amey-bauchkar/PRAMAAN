import { Worker } from 'worker_threads';
import { stableStringify } from '@pramaan/domain';
import type { JudgeCaseResult } from '@pramaan/domain';

export interface JsTestCase { input: unknown[]; expected?: unknown; expectError?: string; description?: string }
export interface SqlTestCase { setup: string; description?: string }

export interface JudgeOutcome {
  runner: string;
  compileError?: string;
  results: JudgeCaseResult[];
  passed: number;
  total: number;
}

/**
 * Executes untrusted student code against tests. Implementations must never give student code access to
 * the network, secrets, the file system or the application database.
 */
export interface Judge {
  readonly name: string;
  runJavaScript(code: string, entry: string, tests: JsTestCase[]): Promise<JudgeOutcome>;
  runSql(schema: string, tests: SqlTestCase[], studentQuery: string, referenceQuery: string): Promise<JudgeOutcome>;
}

const MAX_CODE = 20_000;

/*
 * Local development judge.
 * JavaScript: runs in a separate worker thread (own heap, capped memory, empty env) inside a fresh vm
 * context with no host objects. Inputs enter as JSON text and results leave as JSON text, so no host
 * object is reachable from student code. Each test has a CPU timeout and the worker is terminated after a
 * wall-clock limit.
 * SQL: runs in a throwaway in-memory PGlite per test, in a worker, never the application database.
 *
 * A vm context inside Node is NOT a security boundary against a determined attacker. This runner is for
 * local demos and tests; production must use an isolated judge (Judge0 or an isolate/gVisor sandbox).
 */
const JS_WORKER = `(function () {
const { parentPort, workerData } = require('worker_threads');
const vm = require('vm');
const { code, entry, tests, perTestMs } = workerData;
const ctx = vm.createContext(Object.create(null), { codeGeneration: { strings: true, wasm: false }, microtaskMode: 'afterEvaluate' });
try {
  vm.runInContext(code + '\\n;globalThis.__entry = (typeof ' + entry + ' === "function") ? ' + entry + ' : undefined;', ctx, { timeout: perTestMs });
} catch (e) {
  parentPort.postMessage({ compileError: String(e && e.message || e).slice(0, 300) });
  return;
}
const out = [];
for (let i = 0; i < tests.length; i++) {
  const src = '(function () { if (typeof __entry !== "function") return JSON.stringify({ error: "ReferenceError", message: "Function ' + entry + ' is not defined" });'
    + ' try { const r = __entry(...JSON.parse(' + JSON.stringify(JSON.stringify(tests[i].input)) + '));'
    + ' return JSON.stringify({ ok: r === undefined ? null : r }); }'
    + ' catch (e) { return JSON.stringify({ error: (e && e.name) || "Error", message: String(e && e.message || e).slice(0, 200) }); } })()';
  try {
    out.push(String(vm.runInContext(src, ctx, { timeout: perTestMs })));
  } catch (e) {
    out.push(JSON.stringify({ error: 'Timeout', message: 'Time limit exceeded' }));
  }
}
parentPort.postMessage({ results: out });
})();
`;

const SQL_WORKER = (pglitePath: string) => `
const { parentPort, workerData } = require('worker_threads');
const { PGlite } = require(${JSON.stringify(pglitePath)});
const { schema, tests, student, reference } = workerData;
(async () => {
  const results = [];
  for (const t of tests) {
    const db = await PGlite.create();
    try {
      await db.exec(schema);
      await db.exec(t.setup);
      const ref = await db.query(reference);
      let stu;
      try { stu = await db.query(student); }
      catch (e) { results.push({ error: String(e && e.message || e).slice(0, 200) }); continue; }
      results.push({ ref: { fields: ref.fields.map(f => f.name), rows: ref.rows }, stu: { fields: stu.fields.map(f => f.name), rows: stu.rows } });
    } finally { await db.close(); }
  }
  parentPort.postMessage({ results });
})().catch(e => parentPort.postMessage({ compileError: String(e && e.message || e) }));
`;

function runWorker(source: string, workerData: unknown, wallMs: number, memMb: number): Promise<any> {
  return new Promise(resolve => {
    const w = new Worker(source, {
      eval: true, workerData, env: {},
      resourceLimits: { maxOldGenerationSizeMb: memMb, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    });
    let settled = false;
    const done = (v: any) => { if (!settled) { settled = true; clearTimeout(timer); w.terminate(); resolve(v); } };
    const timer = setTimeout(() => done({ timeout: true }), wallMs);
    w.on('message', done);
    w.on('error', e => done({ compileError: `Runner stopped: ${String(e.message).slice(0, 200)}` }));
    w.on('exit', () => done({ compileError: 'Runner exited (memory or resource limit).' }));
  });
}

const norm = (v: unknown) => stableStringify(v);

export class LocalJudge implements Judge {
  readonly name = 'local-dev-runner';

  async runJavaScript(code: string, entry: string, tests: JsTestCase[]): Promise<JudgeOutcome> {
    if (code.length > MAX_CODE) return { runner: this.name, compileError: 'Code is too long.', results: [], passed: 0, total: tests.length };
    if (!/^[A-Za-z_$][\w$]*$/.test(entry)) throw new Error('Invalid entry function name.');
    const res = await runWorker(JS_WORKER, { code, entry, tests: tests.map(t => ({ input: t.input })), perTestMs: 1000 }, 5000 + tests.length * 1000, 64);
    if (res.timeout) return { runner: this.name, compileError: 'Time limit exceeded.', results: tests.map((t, index) => ({ index, passed: false, description: t.description, error: 'Timeout' })), passed: 0, total: tests.length };
    if (res.compileError) return { runner: this.name, compileError: res.compileError, results: tests.map((t, index) => ({ index, passed: false, description: t.description, error: res.compileError })), passed: 0, total: tests.length };
    const results: JudgeCaseResult[] = tests.map((t, index) => {
      let parsed: any;
      try { parsed = JSON.parse(res.results[index]); } catch { parsed = { error: 'Error', message: 'Result could not be read (not JSON-serialisable).' }; }
      if (t.expectError) {
        const passed = parsed.error === t.expectError;
        return { index, passed, description: t.description, expected: `throws ${t.expectError}`, received: parsed.error ? `throws ${parsed.error}` : parsed.ok, error: undefined };
      }
      if (parsed.error) return { index, passed: false, description: t.description, expected: t.expected, error: `${parsed.error}: ${parsed.message}` };
      return { index, passed: norm(parsed.ok) === norm(t.expected), description: t.description, expected: t.expected, received: parsed.ok };
    });
    return { runner: this.name, results, passed: results.filter(r => r.passed).length, total: tests.length };
  }

  async runSql(schema: string, tests: SqlTestCase[], studentQuery: string, referenceQuery: string): Promise<JudgeOutcome> {
    const q = studentQuery.trim().replace(/;\s*$/, '');
    if (q.length === 0 || q.length > MAX_CODE) return { runner: this.name, compileError: 'Query is empty or too long.', results: [], passed: 0, total: tests.length };
    if (q.includes(';')) return { runner: this.name, compileError: 'Submit a single SQL statement.', results: [], passed: 0, total: tests.length };
    const res = await runWorker(SQL_WORKER(require.resolve('@electric-sql/pglite')), { schema, tests, student: q, reference: referenceQuery }, 20_000 + tests.length * 4000, 256);
    if (res.timeout || res.compileError) {
      const msg = res.timeout ? 'Time limit exceeded.' : res.compileError;
      return { runner: this.name, compileError: msg, results: tests.map((t, index) => ({ index, passed: false, description: t.description, error: msg })), passed: 0, total: tests.length };
    }
    const ordered = /\border\s+by\b/i.test(referenceQuery);
    const results: JudgeCaseResult[] = tests.map((t, index) => {
      const r = res.results[index];
      if (r.error) return { index, passed: false, description: t.description, error: r.error };
      const cols = r.ref.fields.map((f: string) => f.toLowerCase());
      const stuCols = r.stu.fields.map((f: string) => f.toLowerCase());
      if (cols.join(',') !== stuCols.join(',')) {
        return { index, passed: false, description: t.description, expected: `columns ${cols.join(', ')}`, received: `columns ${stuCols.join(', ')}` };
      }
      const rows = (x: any[]) => x.map(rw => r.ref.fields.map((f: string) => rw[f] ?? rw[f.toLowerCase()] ?? null)).map(v => norm(v));
      const a = rows(r.ref.rows), b = rows(r.stu.rows);
      const passed = ordered ? a.join('|') === b.join('|') : [...a].sort().join('|') === [...b].sort().join('|');
      return { index, passed, description: t.description, expected: r.ref.rows.slice(0, 5), received: r.stu.rows.slice(0, 5) };
    });
    return { runner: this.name, results, passed: results.filter(x => x.passed).length, total: tests.length };
  }
}

/**
 * Production judge backed by a self-hosted Judge0 CE instance (JUDGE0_URL). JavaScript only; SQL runs in
 * the local PGlite sandbox, which never touches the application database.
 */
export class Judge0Judge implements Judge {
  readonly name = 'judge0';
  private readonly local = new LocalJudge();
  constructor(private readonly baseUrl: string, private readonly apiKey?: string) {}

  async runJavaScript(code: string, entry: string, tests: JsTestCase[]): Promise<JudgeOutcome> {
    if (!/^[A-Za-z_$][\w$]*$/.test(entry)) throw new Error('Invalid entry function name.');
    const harness = `${code}\n;const __t = ${JSON.stringify(tests.map(t => t.input))};\nfor (const i of __t) { try { const r = ${entry}(...i); console.log(JSON.stringify({ ok: r === undefined ? null : r })); } catch (e) { console.log(JSON.stringify({ error: e && e.name || 'Error', message: String(e && e.message || e) })); } }`;
    const res = await fetch(`${this.baseUrl}/submissions?base64_encoded=false&wait=true`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(this.apiKey ? { 'X-Auth-Token': this.apiKey } : {}) },
      body: JSON.stringify({ language_id: 63, source_code: harness, cpu_time_limit: 2, memory_limit: 128000, enable_network: false }),
    });
    const body: any = await res.json();
    const lines = String(body.stdout ?? '').trim().split('\n');
    const results: JudgeCaseResult[] = tests.map((t, index) => {
      let p: any; try { p = JSON.parse(lines[index]); } catch { p = { error: 'Error', message: body.stderr ?? body.compile_output ?? 'No output' }; }
      if (t.expectError) return { index, passed: p.error === t.expectError, description: t.description, expected: `throws ${t.expectError}`, received: p.error ? `throws ${p.error}` : p.ok };
      if (p.error) return { index, passed: false, description: t.description, error: `${p.error}: ${p.message}` };
      return { index, passed: norm(p.ok) === norm(t.expected), description: t.description, expected: t.expected, received: p.ok };
    });
    return { runner: this.name, results, passed: results.filter(r => r.passed).length, total: tests.length };
  }

  runSql(schema: string, tests: SqlTestCase[], studentQuery: string, referenceQuery: string): Promise<JudgeOutcome> {
    return this.local.runSql(schema, tests, studentQuery, referenceQuery);
  }
}
