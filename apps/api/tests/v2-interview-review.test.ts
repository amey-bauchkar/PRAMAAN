import { describe, it, expect, beforeAll } from 'vitest';
import { createDemoApp, DemoApp } from '../src/v2/demo.js';
import {
  AnthropicCoverageJudge,
  GeminiCoverageJudge,
  GroqCoverageJudge,
  ResilientEnsembleJudge,
  createCoverageJudgeFromEnv,
  scoreAnswer,
  CoverageJudge,
} from '../src/v2/interview-judge.js';

const q = { id: 'q1', topic: 'sql', question: 'What does a JOIN do?', keyPoints: [{ point: 'combines rows from two tables', keywords: ['join'] }, { point: 'uses a matching column', keywords: ['on', 'key'] }] };

describe('Interview scoring: model judge with a rules fallback', () => {
  it('uses the model verdict for coverage and records which scorer ran', async () => {
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ content: [{ text: '{"covered":[true,false]}' }] }) });
    const judge = new AnthropicCoverageJudge('test-key', 'claude-haiku-5-5', fetchImpl as any);
    const s = await scoreAnswer(q, 'A join combines rows.', judge);
    expect(s.scorer).toBe('llm:claude-haiku-5-5');
    expect(s.score).toBe(5);
    expect(s.covered).toEqual(['combines rows from two tables']);
  });

  it('does not let keyword stuffing earn marks when the model says the ideas are absent', async () => {
    const judge: CoverageJudge = { name: 'llm:test', coverage: async () => [false, false] };
    expect((await scoreAnswer(q, 'join on key join on key', judge)).score).toBe(0);
    expect((await scoreAnswer(q, 'join on key join on key', null)).score).toBe(10); // the rule-based scorer is fooled, which is why it is labelled as such
  });

  it('falls back to the keyword rubric when the model call fails or returns nonsense', async () => {
    for (const fetchImpl of [
      async () => ({ ok: false, status: 500, json: async () => ({}) }),
      async () => ({ ok: true, status: 200, json: async () => ({ content: [{ text: 'sorry' }] }) }),
      async () => ({ ok: true, status: 200, json: async () => ({ content: [{ text: '{"covered":[true]}' }] }) }),
      async () => { throw new Error('network'); },
    ]) {
      const s = await scoreAnswer(q, 'a join on a key', new AnthropicCoverageJudge('k', 'm', fetchImpl as any));
      expect(s.scorer).toBe('rules');
    }
  });

  it('uses the Gemini model verdict for coverage and records which scorer ran', async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '{"covered":[true,false]}' }] } }] }),
    });
    const judge = new GeminiCoverageJudge('test-gemini-key', 'gemini-3.5-flash-lite', fetchImpl as any);
    const s = await scoreAnswer(q, 'A join combines rows from tables.', judge);
    expect(s.scorer).toBe('llm:gemini-3.5-flash-lite');
    expect(s.score).toBe(5);
    expect(s.covered).toEqual(['combines rows from two tables']);
  });

  it('falls back to the keyword rubric when Gemini call fails or returns invalid structure', async () => {
    for (const fetchImpl of [
      async () => ({ ok: false, status: 500, json: async () => ({}) }),
      async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'invalid json' }] } }] }) }),
      async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"covered":[true]}' }] } }] }) }),
      async () => { throw new Error('network error'); },
    ]) {
      const s = await scoreAnswer(q, 'a join on a key', new GeminiCoverageJudge('k', 'm', fetchImpl as any));
      expect(s.scorer).toBe('rules');
    }
  });

  it('uses the Groq model verdict for coverage and records which scorer ran', async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"covered":[true,false]}' } }] }),
    });
    const judge = new GroqCoverageJudge('test-groq-key', 'openai/gpt-oss-120b', fetchImpl as any);
    const s = await scoreAnswer(q, 'A join combines rows from tables.', judge);
    expect(s.scorer).toBe('llm:groq:openai/gpt-oss-120b');
    expect(s.score).toBe(5);
    expect(s.covered).toEqual(['combines rows from two tables']);
  });

  it('falls back to the keyword rubric when Groq call fails or returns invalid structure', async () => {
    for (const fetchImpl of [
      async () => ({ ok: false, status: 500, json: async () => ({}) }),
      async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'invalid json' } }] }) }),
      async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"covered":[true]}' } }] }) }),
      async () => { throw new Error('network error'); },
    ]) {
      const s = await scoreAnswer(q, 'a join on a key', new GroqCoverageJudge('k', 'm', fetchImpl as any));
      expect(s.scorer).toBe('rules');
    }
  });

  it('ResilientEnsembleJudge gives credit only where both judges agree (a union let keyword stuffing through in a live test)', async () => {
    const gemini: CoverageJudge = { name: 'llm:gemini-3.5-flash-lite', coverage: async () => [true, false] };
    const groq: CoverageJudge = { name: 'llm:groq:openai/gpt-oss-120b', coverage: async () => [false, true] };
    const ensemble = new ResilientEnsembleJudge([gemini, groq]);
    const s = await scoreAnswer(q, 'A join combines rows using matching keys', ensemble);
    expect(s.scorer).toBe('ensemble:gemini-3.5-flash-lite+groq:openai/gpt-oss-120b');
    expect(s.score).toBe(0);
    expect(s.covered).toEqual([]);
  });

  it('ResilientEnsembleJudge fails over smoothly if one judge fails', async () => {
    const failingGemini: CoverageJudge = { name: 'llm:gemini-3.5-flash-lite', coverage: async () => null };
    const workingGroq: CoverageJudge = { name: 'llm:groq:openai/gpt-oss-120b', coverage: async () => [true, false] };
    const ensemble = new ResilientEnsembleJudge([failingGemini, workingGroq]);
    const s = await scoreAnswer(q, 'A join combines rows', ensemble);
    expect(s.scorer).toBe('llm:groq:openai/gpt-oss-120b');
    expect(s.score).toBe(5);
    expect(s.covered).toEqual(['combines rows from two tables']);
  });

  it('ResilientEnsembleJudge falls back to rules if all judges fail', async () => {
    const failing1: CoverageJudge = { name: 'llm:gemini-3.5-flash-lite', coverage: async () => null };
    const failing2: CoverageJudge = { name: 'llm:groq:openai/gpt-oss-120b', coverage: async () => { throw new Error('timeout'); } };
    const ensemble = new ResilientEnsembleJudge([failing1, failing2]);
    const s = await scoreAnswer(q, 'a join on a key', ensemble);
    expect(s.scorer).toBe('rules');
  });

  it('createCoverageJudgeFromEnv builds ensemble when both GEMINI and GROQ keys are present', () => {
    const judge = createCoverageJudgeFromEnv({
      GEMINI_API_KEY: 'test-gemini',
      GROQ_API_KEY: 'test-groq',
    });
    expect(judge).toBeInstanceOf(ResilientEnsembleJudge);
    expect(judge?.name).toBe('ensemble:gemini-3.5-flash-lite+groq:openai/gpt-oss-120b');
  });
});

describe('Human review of an interview score', () => {
  let demo: DemoApp;
  const tokens: Record<string, string> = {};
  const call = async (who: string, method: 'GET' | 'POST', url: string, body?: unknown) => {
    const res = await demo.app.inject({ method, url, headers: { authorization: `Bearer ${tokens[who]}` }, payload: body as any });
    return { status: res.statusCode, body: res.payload ? JSON.parse(res.payload) : null };
  };
  beforeAll(async () => {
    demo = await createDemoApp();
    for (const p of ['rahul', 'tpo']) tokens[p] = await demo.tokenFor(p);
  }, 300_000);

  it('a student asks, an officer changes the score with a reply, and the student sees it', async () => {
    const start = await call('rahul', 'POST', '/api/v2/student/mock/attempts', { role: 'Backend Developer' });
    const id = start.body.id;
    const attempt = (await call('rahul', 'GET', `/api/v2/student/mock/attempts/${id}`)).body;
    const answers = Object.fromEntries(attempt.interview.map((x: any) => [x.id, 'I am not sure.']));
    expect((await call('rahul', 'POST', `/api/v2/student/mock/attempts/${id}/review`, { reason: 'Too early to ask' })).status).toBe(409);
    const done = await call('rahul', 'POST', `/api/v2/student/mock/attempts/${id}/interview`, { answers });
    expect(done.status).toBe(200);
    expect(done.body.result.score).toBe(0);
    expect((await call('rahul', 'POST', `/api/v2/student/mock/attempts/${id}/review`, { reason: 'x' })).status).toBe(400);
    const ask = await call('rahul', 'POST', `/api/v2/student/mock/attempts/${id}/review`, { reason: 'My answer was in my own words, please read it.' });
    expect(ask.status).toBe(200);
    expect((await call('rahul', 'POST', `/api/v2/student/mock/attempts/${id}/review`, { reason: 'Asking a second time while waiting' })).status).toBe(409);

    const queue = (await call('tpo', 'GET', '/api/v2/tpo/mock-reviews')).body;
    const item = queue.find((x: any) => x.attemptId === id);
    expect(item.status).toBe('pending');
    const first = item.answers[0].questionId;
    const decided = await call('tpo', 'POST', `/api/v2/tpo/mock-reviews/${item.id}/decide`, { scores: { [first]: 7 }, note: 'Your explanation was correct in your own words.' });
    expect(decided.body).toEqual({ status: 'revised', score: 7 });
    const after = (await call('rahul', 'GET', `/api/v2/student/mock/attempts/${id}`)).body;
    expect(after.rounds.find((r: any) => r.round === 'interview').score).toBe(7);
    expect(after.reviews[0]).toMatchObject({ status: 'revised', previousScore: 0, revisedScore: 7 });
    expect((await call('tpo', 'POST', `/api/v2/tpo/mock-reviews/${item.id}/decide`, { note: 'again please' })).status).toBe(409);
    // Another student cannot ask for a review of this attempt.
    expect((await call('rahul', 'POST', '/api/v2/student/mock/attempts/00000000-0000-0000-0000-000000000000/review', { reason: 'not mine at all' })).status).toBe(404);
  });
});
