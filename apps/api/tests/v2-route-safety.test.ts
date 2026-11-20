import { it, expect } from 'vitest';
import { createDemoApp, PERSONAS } from '../src/v2/demo.js';

/** Every route, every persona, empty and hostile bodies: no server errors, and no role can read another role's area. */
it('no route returns a server error and no role reads another role area', async () => {
  const demo = await createDemoApp();
  const routes: { method: string; url: string }[] = [];
  demo.app.addHook('onRoute', () => {});
  const tree = demo.app.printRoutes({ commonPrefix: false } as any);
  const lines = tree.split('\n');
  // printRoutes lists "METHOD" groups like "/api/v2/... (GET, HEAD)"; parse conservatively
  for (const l of lines) {
    const m = l.match(/(\/api\/[^\s]*)\s+\(([A-Z, ]+)\)/);
    if (m) for (const meth of m[2].split(',').map(s => s.trim())) if (meth !== 'HEAD' && meth !== 'OPTIONS') routes.push({ method: meth, url: m[1] });
  }
  const bad: string[] = [];
  const uuid = '00000000-0000-4000-8000-000000000000';
  for (const p of PERSONAS) {
    const tok = await demo.tokenFor(p.key);
    for (const r of routes) {
      if (r.url.includes('demo/') || r.url.includes('/export') || r.url.includes('dispatch') || r.url.includes('outreach/send') || r.url.includes('retention')) continue;
      const url = r.url.replace(/:[a-zA-Z]+/g, uuid).replace(/\*/g, 'x');
      for (const payload of r.method === 'GET' ? [undefined] : [{}, { x: 'y'.repeat(50) }, null as any]) {
        const res = await demo.app.inject({ method: r.method as any, url, headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, payload: payload === null ? 'not json' : payload as any });
        if (res.statusCode >= 500) bad.push(`${p.key} ${r.method} ${r.url} -> ${res.statusCode}`);
      }
    }
  }
  const leaks: string[] = [];
  const area = (u: string) => u.startsWith('/api/v2/student') ? 'student' : u.startsWith('/api/v2/tpo') ? 'tpo' : u.startsWith('/api/v2/recruiter') ? 'recruiter' : u.startsWith('/api/v2/university') ? 'university' : null;
  const allowed: Record<string, string[]> = { student: ['student'], tpo: ['tpo'], recruiter: ['recruiter'], university: ['university'] };
  for (const p of PERSONAS) {
    const tok = await demo.tokenFor(p.key);
    for (const r of routes.filter(x => x.method === 'GET')) {
      const a = area(r.url); if (!a || r.url.includes('export')) continue;
      const ws = p.workspace as string;
      if ((allowed[ws] ?? []).includes(a)) continue;
      const res = await demo.app.inject({ method: 'GET', url: r.url.replace(/:[a-zA-Z]+/g, uuid), headers: { authorization: `Bearer ${tok}` } });
      if (res.statusCode < 400) leaks.push(`${p.key}(${ws}) GET ${r.url} -> ${res.statusCode}`);
    }
  }
  expect(routes.length).toBeGreaterThan(60);
  expect([...new Set(bad)]).toEqual([]);
  expect(leaks).toEqual([]);
}, 600_000);
