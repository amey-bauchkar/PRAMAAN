import { describe, it, expect } from 'vitest';
import { createGhFetch, looksLikeGithubToken, looksLikeTestPath, pickSampleFiles, pool, scanProfile, GhFetch } from '../src/v2/github-scan.js';

const blob = (path: string, size = 2000) => ({ path, type: 'blob', size });

describe('choosing which files to read', () => {
  // The tree of a small real library (sindresorhus/p-map) plus the usual project clutter.
  const tree = [blob('index.js', 3800), blob('index.d.ts', 2500), blob('index.test-d.ts', 1200), blob('test.js', 4000), blob('package.json', 900), blob('readme.md', 5000), blob('.github/workflows/main.yml', 400),
    blob('.env', 100), blob('server/config/secrets.json', 300), blob('node_modules/x/index.js', 9000), blob('dist/bundle.min.js', 9000), blob('src/routes/rides.js', 5000), blob('src/models/Ride.js', 3000),
    blob('src/services/payment.js', 4000), blob('src/utils/format.js', 800), blob('src/__tests__/rides.test.js', 900), blob('docs/big.js', 90_000), { path: 'src', type: 'tree' }];
  it('picks central source files and skips tests, type tests, generated, vendor, oversized and sensitive files', () => {
    const picked = pickSampleFiles(tree, 4);
    expect(picked).toEqual(expect.arrayContaining(['src/routes/rides.js']));
    for (const bad of ['index.test-d.ts', 'test.js', 'index.d.ts', '.env', 'server/config/secrets.json', 'node_modules/x/index.js', 'dist/bundle.min.js', 'src/__tests__/rides.test.js', 'docs/big.js']) expect(picked, bad).not.toContain(bad);
    expect(picked.length).toBeLessThanOrEqual(4);
  });
  it('spreads the picks across directories instead of reading one folder', () => {
    const many = Array.from({ length: 6 }, (_, i) => blob(`src/routes/route${i}.js`, 3000));
    expect(new Set(pickSampleFiles([...many, blob('src/models/User.js', 3000), blob('src/auth/login.js', 3000)], 4).map(p => p.split('/').slice(0, -1).join('/'))).size).toBeGreaterThan(1);
  });
  it('recognises tests in the layouts people use', () => {
    for (const p of ['test.js', 'tests/a.js', 'src/__tests__/a.js', 'src/a.test.ts', 'src/a.spec.js', 'src/test_utils.py', 'pkg/a_test.go', 'src/main/java/CartTests.java', 'cypress/e2e/a.cy.js']) expect(looksLikeTestPath(p), p).toBe(true);
    for (const p of ['src/latest.js', 'index.js', 'src/contest.py', 'README.md']) expect(looksLikeTestPath(p), p).toBe(false);
  });
});

describe('GitHub access', () => {
  it('only ever talks to api.github.com, refuses odd paths, and sends the token as a bearer header', async () => {
    const seen: { url: string; auth?: string }[] = [];
    const f = createGhFetch({ token: 'ghp_' + 'x'.repeat(36), fetchImpl: (async (url: string, init: any) => { seen.push({ url, auth: init.headers.Authorization }); return { ok: true, status: 200, headers: new Headers({ 'x-ratelimit-remaining': '4999' }), json: async () => ({}) }; }) as any });
    const r = await f('/users/octocat');
    expect(r).toMatchObject({ status: 200, rateRemaining: 4999 });
    expect(seen[0].url).toBe('https://api.github.com/users/octocat');
    expect(seen[0].auth).toMatch(/^Bearer ghp_/);
    for (const bad of ['https://evil.example/x', '//evil.example', '/users/../admin', 'users/x']) await expect(f(bad)).rejects.toThrow();
  });
  it('treats a network failure as status 0 instead of throwing', async () => {
    const f = createGhFetch({ fetchImpl: (async () => { throw new Error('down'); }) as any });
    expect((await f('/users/x')).status).toBe(0);
  });
  it('accepts the token shapes GitHub issues and nothing else', () => {
    for (const t of ['ghp_' + 'a'.repeat(36), 'gho_' + 'a'.repeat(36), 'github_pat_' + 'a'.repeat(50), 'a'.repeat(40)]) expect(looksLikeGithubToken(t), t).toBe(true);
    for (const t of ['', 'short', 'not a token', 'ghp_x', null, undefined, 42, 'Bearer ' + 'a'.repeat(40)]) expect(looksLikeGithubToken(t as any), String(t)).toBe(false);
  });
});

describe('listing repositories', () => {
  const user = { login: 'big', name: 'Big', public_repos: 130, followers: 1, created_at: '2020-01-01T00:00:00Z', type: 'User' };
  const repo = (i: number) => ({ name: `repo-${i}`, full_name: `big/repo-${i}`, html_url: `https://github.com/big/repo-${i}`, topics: ['a'], fork: false, stargazers_count: 0, size: 1, default_branch: 'main' });
  it('reads a second page when there are more than 100 repositories, and ignores entries with unsafe names', async () => {
    const gh: GhFetch = async path => {
      if (path === '/users/big') return { status: 200, json: user, rateRemaining: 50 };
      if (path.endsWith('&page=1')) return { status: 200, json: Array.from({ length: 100 }, (_, i) => repo(i)), rateRemaining: 49 };
      if (path.endsWith('&page=2')) return { status: 200, json: [...Array.from({ length: 29 }, (_, i) => repo(100 + i)), { ...repo(999), name: '../evil' }], rateRemaining: 48 };
      return { status: 404 };
    };
    const s = await scanProfile(gh, 'big');
    expect(s.repos).toHaveLength(129);
    expect(s.repos.some(r => r.name.includes('..'))).toBe(false);
    expect(s.rateRemaining).toBe(48);
  });
  it('rejects bad usernames before any request is made', async () => {
    let calls = 0;
    const gh: GhFetch = async () => { calls++; return { status: 200, json: {} }; };
    for (const bad of ['', 'a b', '../x', 'x'.repeat(40), '-x']) await expect(scanProfile(gh, bad)).rejects.toMatchObject({ status: 400 });
    expect(calls).toBe(0);
  });
});

describe('pool', () => {
  it('runs at most n at a time and keeps the order of results', async () => {
    let running = 0, peak = 0;
    const out = await pool([1, 2, 3, 4, 5, 6], 2, async x => { running++; peak = Math.max(peak, running); await new Promise(r => setTimeout(r, 5)); running--; return x * 10; });
    expect(out).toEqual([10, 20, 30, 40, 50, 60]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});
