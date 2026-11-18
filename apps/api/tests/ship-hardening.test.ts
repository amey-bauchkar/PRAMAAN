import { describe, it, expect, afterEach } from 'vitest';
import { buildApp } from '../src/app.js';

/** Ship-readiness: CORS allowlist, security headers, rate limiting and request size limits. */
process.env.SUPABASE_URL ??= 'https://qshujrddrzoemlzmleru.supabase.co';
const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

function prodEnv(extra: Record<string, string> = {}) {
  Object.assign(process.env, {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://fake:password@localhost:5432/db',
    SUPABASE_URL: 'https://qshujrddrzoemlzmleru.supabase.co',
    GITHUB_CLIENT_ID: 'real-client-id', GITHUB_CLIENT_SECRET: 'real-client-secret',
    GITHUB_OAUTH_REDIRECT_URI: 'https://pramaan.app/integrations/github/callback',
    GITHUB_TOKEN_ENCRYPTION_KEY: '0123456789abcdef'.repeat(4),
    ...extra,
  });
}

describe('Ship hardening', () => {
  it('production refuses to start without an explicit CORS allowlist', () => {
    prodEnv();
    delete process.env.CORS_ORIGINS;
    expect(() => buildApp()).toThrow(/CORS_ORIGINS/);
  });

  it('production only allows the configured web origin', async () => {
    prodEnv({ CORS_ORIGINS: 'https://app.pramaan.example' });
    const app = buildApp();
    const ok = await app.inject({ method: 'OPTIONS', url: '/health', headers: { origin: 'https://app.pramaan.example', 'access-control-request-method': 'GET' } });
    expect(ok.headers['access-control-allow-origin']).toBe('https://app.pramaan.example');
    const evil = await app.inject({ method: 'OPTIONS', url: '/health', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });

  it('sends security headers', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-frame-options']).toBeDefined();
    await app.close();
  });

  it('rate-limits a client that exceeds the per-minute budget', async () => {
    process.env.NODE_ENV = 'development';
    process.env.RATE_LIMIT_PER_MINUTE = '3';
    const app = buildApp();
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await app.inject({ method: 'GET', url: '/health' })).statusCode);
    expect(codes.slice(0, 3)).toEqual([200, 200, 200]);
    expect(codes[4]).toBe(429);
    await app.close();
  });

  it('rejects oversized request bodies', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/consent/grant', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ x: 'a'.repeat(1_200_000) }) });
    expect(res.statusCode).toBe(413);
    await app.close();
  });
});
