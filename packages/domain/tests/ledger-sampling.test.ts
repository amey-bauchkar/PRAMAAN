import { describe, it, expect } from 'vitest';
import { sampleIndices, witnessText, checkpointText, sha256Hex } from '../src/transparency-log.js';

const root = sha256Hex('some root');

describe('Reproducible audit sampling', () => {
  it('gives the same distinct indices for the same seed and root, in range', () => {
    const a = sampleIndices(40, 8, 'seed-1', root), b = sampleIndices(40, 8, 'seed-1', root);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(8);
    expect(a.every(i => i >= 0 && i < 40)).toBe(true);
  });
  it('changes with the seed and with the root, so the operator cannot predict it before the auditor picks a seed', () => {
    expect(sampleIndices(1000, 10, 'seed-1', root)).not.toEqual(sampleIndices(1000, 10, 'seed-2', root));
    expect(sampleIndices(1000, 10, 'seed-1', root)).not.toEqual(sampleIndices(1000, 10, 'seed-1', sha256Hex('another root')));
  });
  it('never asks for more than exist, and covers everything when k reaches n', () => {
    expect(sampleIndices(3, 10, 's', root).sort()).toEqual([0, 1, 2]);
    expect(sampleIndices(0, 5, 's', root)).toEqual([]);
  });
  it('is roughly uniform over many seeds', () => {
    const counts = new Array(10).fill(0);
    for (let s = 0; s < 2000; s++) counts[sampleIndices(10, 1, `s${s}`, root)[0]]++;
    for (const c of counts) expect(c).toBeGreaterThan(120);
  });
});

describe('Witness text', () => {
  const cp = { origin: 'pramaan-ledger/x', size: 5, root, at: '2026-11-19T10:00:00.000Z' };
  it('binds the checkpoint, the witness key and the witness time', () => {
    const t = witnessText(cp, 'abcd1234abcd1234', '2026-11-19T10:05:00.000Z');
    expect(t.startsWith(checkpointText(cp))).toBe(true);
    expect(t).toContain('witnessed-by:abcd1234abcd1234\n');
    expect(t).toContain('witnessed-at:2026-11-19T10:05:00.000Z\n');
    expect(witnessText(cp, 'abcd1234abcd1234', '2026-11-19T10:05:01.000Z')).not.toBe(t);
  });
});
