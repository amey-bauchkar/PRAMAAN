import { describe, it, expect, beforeAll } from 'vitest';
import { createDemoApp, DemoApp } from '../src/v2/demo.js';
import { ResilientEnsembleJudge, scoreAnswer, CoverageJudge } from '../src/v2/interview-judge.js';
import { FailoverLlm, GeminiClient, GroqClient, LlmClient, createLlmFromEnv } from '../src/v2/llm.js';
import { validateDrafts } from '../src/v2/interview-drafter.js';

const q = { id: 'q', topic: 'sql', question: 'What does a JOIN do?', keyPoints: [{ point: 'combines rows', keywords: ['join'] }, { point: 'uses a matching key', keywords: ['key'] }] };
const judge = (name: string, out: boolean[] | null): CoverageJudge => ({ name, coverage: async () => out });

describe('Ensemble interview judge', () => {
  it('gives credit only where every judge that answered agrees (one model fooled by stuffing is outvoted)', async () => {
    const fooled = judge('llm:gemini', [true, true]);
    const careful = judge('llm:groq', [false, false]);
    const s = await scoreAnswer(q, 'join key join key', new ResilientEnsembleJudge([fooled, careful]));
    expect(s.score).toBe(0);
    expect(s.scorer).toBe('ensemble:gemini+groq');
  });
  it('names only the judge that answered when the other fails, and falls back to rules when all fail', async () => {
    const one = await scoreAnswer(q, 'a join with a key', new ResilientEnsembleJudge([judge('llm:gemini', null), judge('llm:groq', [true, true])]));
    expect(one.scorer).toBe('llm:groq');
    expect(one.score).toBe(10);
    const none = await scoreAnswer(q, 'a join with a key', new ResilientEnsembleJudge([judge('llm:a', null), judge('llm:b', null)]));
    expect(none.scorer).toBe('rules');
  });
  it('gives each concurrent answer its own scorer name', async () => {
    const ens = new ResilientEnsembleJudge([judge('llm:a', [true, true]), judge('llm:b', null)]);
    const [x, y] = await Promise.all([scoreAnswer(q, 'one', ens), scoreAnswer(q, 'two', ens)]);
    expect([x.scorer, y.scorer]).toEqual(['llm:a', 'llm:a']);
  });
});

describe('LLM clients', () => {
  const ok = (body: unknown) => async () => ({ ok: true, status: 200, json: async () => body });
  it('parses Gemini and Groq responses and sends the key in a header, not the URL', async () => {
    let seen: any;
    const gem = new GeminiClient('K', 'm', (async (url: string, init: any) => { seen = { url, init }; return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] }) }; }) as any);
    expect(await gem.complete('s', 'u')).toBe('hi');
    expect(seen.url).not.toContain('K');
    expect(seen.init.headers['x-goog-api-key']).toBe('K');
    expect(await new GroqClient('K', 'm', ok({ choices: [{ message: { content: 'yo' } }] }) as any).complete('s', 'u')).toBe('yo');
  });
  it('fails over to the next provider and says which one answered', async () => {
    const bad: LlmClient = { name: 'bad', complete: async () => null };
    const good: LlmClient = { name: 'good', complete: async () => 'text' };
    const f = new FailoverLlm([bad, good]);
    expect(await f.complete('s', 'u')).toBe('text');
    expect(f.lastUsed).toBe('good');
    expect(createLlmFromEnv({} as any)).toBeNull();
  });
});

describe('Drafted interview questions are validated', () => {
  const good = { questions: [{ question: 'Describe a project where you used SQL joins and why.', keyPoints: [{ point: 'States the problem', keywords: ['problem'] }, { point: 'Explains the join', keywords: ['join'] }] }] };
  it('accepts a well-formed draft and rejects malformed ones', () => {
    expect(validateDrafts(good, ['sql'])?.[0].topic).toBe('sql');
    expect(validateDrafts({ questions: [] }, ['sql'])).toBeNull();
    expect(validateDrafts({ questions: [{ question: 'short', keyPoints: [] }] }, ['sql'])).toBeNull();
    expect(validateDrafts(good, ['sql', 'java'])).toBeNull();
    expect(validateDrafts('nonsense', ['sql'])).toBeNull();
  });
});

describe('Interview drafter agent with a model', () => {
  let demo: DemoApp; let token: string;
  beforeAll(async () => {
    const llm = new FailoverLlm([{ name: 'llm:test', complete: async (_s: string, user: string) => JSON.stringify({ questions: user.split('each: ')[1].split(', ').map((_x, i0) => i0 + 1).map(i => ({ question: `Explain a decision you made in project ${i} and how you checked it.`, keyPoints: [{ point: 'Says what they decided', keywords: ['decided'] }, { point: 'Says how they checked', keywords: ['tested'] }] })) }) }]);
    demo = await createDemoApp({ llm });
    token = await demo.tokenFor('tpo');
  }, 300_000);
  it('stores model drafts as drafts and records the model that wrote them', async () => {
    const res = await demo.app.inject({ method: 'POST', url: '/api/v2/tpo/mock-setup/interview-questions/draft', headers: { authorization: `Bearer ${token}` }, payload: { role: 'Backend Developer' } });
    expect(res.statusCode).toBe(200);
    const rows = (await demo.db.admin.query<any>(`SELECT output_summary FROM agent_actions WHERE tool = 'draft_questions' ORDER BY created_at DESC LIMIT 1`)).rows;
    expect(rows[0].output_summary.drafter).toBe('llm:test');
    const drafts = (await demo.db.admin.query<any>(`SELECT status, drafted_by FROM interview_questions WHERE question LIKE 'Explain a decision you made in project%'`)).rows;
    expect(drafts.length).toBe(JSON.parse(res.payload).drafted);
    expect(drafts.every((d: any) => d.status === 'draft')).toBe(true);
  });
});
