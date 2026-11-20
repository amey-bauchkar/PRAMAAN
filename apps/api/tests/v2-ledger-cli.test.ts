import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDemoApp, DemoApp } from '../src/v2/demo.js';
import { leafHash as domainLeafHash, inclusionProof } from '@pramaan/domain';
// The independent verifier shares no code with the platform. It is imported here only so it can be tested.
import { verifyLedgerAt, checkReceipt, leafHash as cliLeafHash, merkleRoot as cliRoot } from '../../../scripts/verify-ledger.mjs';

let demo: DemoApp;
let orgId = '';
const getJson = async (p: string) => {
  const res = await demo.app.inject({ method: 'GET', url: p });
  if (res.statusCode !== 200) throw new Error(`${p}: HTTP ${res.statusCode}`);
  return JSON.parse(res.payload);
};
const post = (p: string) => demo.app.inject({ method: 'POST', url: p });
const run = promisify(execFile);
const script = resolve(__dirname, '../../../scripts/verify-ledger.mjs');

describe('Independent ledger verifier (scripts/verify-ledger.mjs)', () => {
  beforeAll(async () => {
    demo = await createDemoApp();
    orgId = (await getJson('/api/demo/ledger')).orgId;
  }, 300_000);

  afterAll(async () => { await demo.app.close(); });

  it('hashes and roots agree with the platform code', async () => {
    const entry = { b: 1, a: [1, { z: 2, y: 3 }] };
    expect(cliLeafHash(entry)).toBe(domainLeafHash(entry));
    const { leaves } = await getJson(`/api/public/ledger/${orgId}/leaves`);
    expect(cliRoot(leaves.map((l: any) => l.leafHash))).toBe((await getJson(`/api/public/ledger/${orgId}`)).checkpoint.root);
  });

  it('gives each demo run its own log identity, so a browser that remembers an earlier run is not told history was rewritten', async () => {
    const head = await getJson(`/api/public/ledger/${orgId}`);
    expect(head.origin).toMatch(new RegExp(`^pramaan-ledger/${orgId}/[0-9a-f]{8}$`));
    expect(head.checkpoint.origin).toBe(head.origin);
  });

  it('passes on an untouched ledger, remembers the state, and proves history only grew', async () => {
    const first = await verifyLedgerAt(getJson, orgId);
    expect(first.ok).toBe(true);
    expect(first.results.some(r => /witnessed the first/.test(r.label))).toBe(true);
    const second = await verifyLedgerAt(getJson, orgId, { seen: first.state });
    expect(second.ok).toBe(true);
    expect(second.results.some(r => /only grew/.test(r.label) && r.ok === true)).toBe(true);
  });

  it('fails when a salary is changed and the entry hash recomputed', async () => {
    const before = await verifyLedgerAt(getJson, orgId);
    await post('/api/demo/ledger/tamper');
    const bad = await verifyLedgerAt(getJson, orgId, { seen: before.state });
    expect(bad.ok).toBe(false);
    expect(bad.results.find(r => /rebuilt from the fingerprints/.test(r.label))?.ok).toBe(false);
    await post('/api/demo/ledger/restore');
    expect((await verifyLedgerAt(getJson, orgId, { seen: before.state })).ok).toBe(true);
  });

  it('fails only on the witness line when the operator rewrites history and re-signs it', async () => {
    const before = await verifyLedgerAt(getJson, orgId);
    await post('/api/demo/ledger/rewrite');
    const bad = await verifyLedgerAt(getJson, orgId, { seen: before.state });
    expect(bad.ok).toBe(false);
    const failed = bad.results.filter(r => r.ok === false).map(r => r.label);
    expect(failed.some(l => /witnessed the first/.test(l))).toBe(true);
    // The operator's own checks all pass, which is the point of having a witness.
    expect(bad.results.find(r => /rebuilt from the fingerprints/.test(r.label))?.ok).toBe(true);
    expect(bad.results.find(r => /operator signature/.test(r.label))?.ok).toBe(true);
    await post('/api/demo/ledger/restore');
  });

  it('the demo cheat buttons always act on the college the demo ledger link points to, however often they are used', async () => {
    // Every demo college has a ledger. The buttons once picked the first matching entry of any college, so after one
    // use they could rewrite a different college's log from the one on screen.
    const leaves = async () => (await getJson(`/api/public/ledger/${orgId}/leaves`)).leaves.map((l: any) => l.leafHash).join(',');
    for (let round = 1; round <= 3; round++) {
      for (const what of ['tamper', 'rewrite'] as const) {
        const before = await leaves();
        await post(`/api/demo/ledger/${what}`);
        expect(await leaves(), `${what}, round ${round}`).not.toBe(before);
        await post('/api/demo/ledger/restore');
        expect(await leaves(), `restore after ${what}, round ${round}`).toBe(before);
      }
    }
  });

  it('as a real process over HTTP: exits 0 and saves its state when every check passes, exits 1 and keeps the old state when one fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pramaan-cli-'));
    try {
      const state = join(dir, 'state.json');
      await demo.app.listen({ port: 0, host: '127.0.0.1' });
      const base = `http://127.0.0.1:${(demo.app.server.address() as { port: number }).port}`;
      // The server runs in this process, so the CLI must be started without blocking the event loop.
      const cli = async () => {
        try { return { code: 0, out: (await run(process.execPath, [script, base, orgId, '--state', state])).stdout }; }
        catch (e: any) { return { code: e.code as number, out: String(e.stdout) }; }
      };
      const clean = await cli();
      expect(clean.code).toBe(0);
      expect(clean.out).toMatch(/All checks passed/);
      const saved = JSON.parse(readFileSync(state, 'utf8'));
      expect(saved[orgId].size).toBeGreaterThan(0);

      await post('/api/demo/ledger/rewrite');
      const bad = await cli();
      expect(bad.code).toBe(1);
      expect(bad.out).toMatch(/FAIL\s+.*witnessed the first/);
      expect(JSON.parse(readFileSync(state, 'utf8'))).toEqual(saved);

      await post('/api/demo/ledger/restore');
      expect((await cli()).code).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('checks a placement receipt and rejects one whose salary was changed', async () => {
    const admin = demo.db.admin;
    const rows = (await admin.query<any>(`SELECT seq, payload FROM ledger_entries WHERE org_id = $1 ORDER BY seq`, [orgId])).rows;
    const idx = rows.findIndex((r: any) => r.payload.kind === 'offer_accepted');
    const hashes = rows.map((r: any) => domainLeafHash(r.payload));
    const head = await getJson(`/api/public/ledger/${orgId}`);
    const receipt = { seq: idx + 1, entry: rows[idx].payload, leafHash: hashes[idx], treeSize: head.checkpoint.size, proof: inclusionProof(hashes.slice(0, head.checkpoint.size), idx), checkpoint: head.checkpoint };
    expect(checkReceipt(receipt, head.issuerPublicKeyPem).every(r => r.ok)).toBe(true);
    const forged = { ...receipt, entry: { ...receipt.entry, offer: { ...receipt.entry.offer, ctcInr: receipt.entry.offer.ctcInr * 2 } } };
    expect(checkReceipt(forged, head.issuerPublicKeyPem).some(r => !r.ok)).toBe(true);
  });
});
