import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';

/**
 * The persona picker is a demo-only feature that lives in the demo server (apps/api/src/v2/demo.ts). The real API entry point
 * must never expose it: a visitor cannot sign in as another role, and every protected route needs a verified token.
 */
describe('Real API: no persona switching, no anonymous access', () => {
  // The real app refuses to start without a way to verify tokens (fail closed), so give it a test-only signing secret.
  process.env.SUPABASE_JWT_SECRET ??= 'test-only-secret-at-least-32-characters-long!!';
  const app = buildApp();

  it('has no demo sign-in or demo data routes', async () => {
    for (const [method, url] of [['GET', '/api/demo/personas'], ['POST', '/api/demo/login'], ['GET', '/api/demo/ledger'], ['POST', '/api/demo/ledger/tamper']] as const) {
      const res = await app.inject({ method, url, payload: method === 'POST' ? { persona: 'tpo' } : undefined });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
  });

  it('rejects protected routes without a token, with a forged token, or with a plain user id', async () => {
    for (const headers of [{}, { authorization: 'Bearer not.a.jwt' }, { authorization: 'Bearer ' }, { authorization: 'student' }, { 'x-user-id': 'tpo', 'x-org-id': 'any' }]) {
      const me = await app.inject({ method: 'GET', url: '/api/me', headers: headers as any });
      expect([401, 403]).toContain(me.statusCode);
      const list = await app.inject({ method: 'GET', url: '/api/students', headers: headers as any });
      expect([401, 403]).toContain(list.statusCode);
    }
  });
});
