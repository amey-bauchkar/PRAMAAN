import { describe, it, expect, beforeAll } from 'vitest';
import { createDemoApp, DemoApp } from '../src/v2/demo.js';

/** Publish-time fairness simulation and less-discriminatory-alternative repair, through the API. */
let demo: DemoApp;
let token: string;
let driveId: string;
let current: any;

const post = (url: string, body: unknown) => demo.app.inject({ method: 'POST', url, payload: body as any, headers: { authorization: `Bearer ${token}` } })
  .then(r => ({ status: r.statusCode, body: JSON.parse(r.payload) }));

beforeAll(async () => {
  demo = await createDemoApp({ publishDrives: false });
  token = await demo.tokenFor('tpo');
  const drives = await demo.app.inject({ method: 'GET', url: '/api/v2/tpo/drives', headers: { authorization: `Bearer ${token}` } });
  driveId = JSON.parse(drives.payload).drives.find((d: any) => d.title === 'Software Engineer Trainee').id;
  const rules = await demo.app.inject({ method: 'GET', url: `/api/v2/tpo/drives/${driveId}/rules`, headers: { authorization: `Bearer ${token}` } });
  current = JSON.parse(rules.payload).versions[0].rules;
}, 300_000);

describe('Fairness simulation and repair', () => {
  it('compares within allowed branches, not across branches the drive excludes on purpose', async () => {
    const r = await post(`/api/v2/tpo/drives/${driveId}/rules/preview`, { rules: current });
    expect(r.status).toBe(200);
    expect(r.body.populationNote).toMatch(/within the allowed branches/);
    expect(Object.keys(r.body.fairness)).not.toContain('branch');
  });

  it('flags a school-marks cutoff with adverse impact, and repair finds a smaller cutoff that keeps every required skill', async () => {
    const strict = { ...current, academics: { ...current.academics, minTenthPct: 75, minTwelfthOrDiplomaPct: 75 } };
    const prev = await post(`/api/v2/tpo/drives/${driveId}/rules/preview`, { rules: strict });
    expect(prev.body.adverseDimensions).toContain('category');
    expect(prev.body.shortfall).toBeGreaterThan(0);

    const rep = await post(`/api/v2/tpo/drives/${driveId}/rules/repair`, { rules: strict });
    expect(rep.status).toBe(200);
    expect(rep.body.searched).toBeGreaterThan(5);
    const best = rep.body.options[0];
    expect(best).toBeDefined();
    // Either removes the flag, or narrows it: fewer flagged dimensions or a smaller total gap below 0.80.
    expect(best.fixesAdverseImpact || best.ratioGap <= prev.body.ratioGap - 0.05).toBe(true);
    expect(best.ratioGap).toBeLessThan(rep.body.baseline.ratioGap);
    expect(best.eligible).toBeGreaterThan(prev.body.eligible);
    expect(best.rules.skills.map((s: any) => s.skillId).sort()).toEqual(strict.skills.map((s: any) => s.skillId).sort());
    // The obvious remedy (relax the school-marks cutoffs) must be found before any skill relaxation.
    expect(best.touchesSkills).toBe(false);
    expect(best.description.join(' ')).toMatch(/10th|12th/);
  }, 120_000);
});
