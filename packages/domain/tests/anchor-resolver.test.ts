import { describe, it, expect } from 'vitest';
import { AnchorResolver } from '../src/anchor-resolver.js';
import { CodeAnchor } from '@pramaan/contracts';

describe('AnchorResolver Invariants', () => {
  const sampleFileContent = `import math

def calculate_entropy(probabilities):
    """Calculates Shannon entropy given a list of probabilities."""
    entropy = 0.0
    for p in probabilities:
        if p > 0:
            entropy -= p * math.log2(p)
    return entropy

def normalize(values):
    total = sum(values)
    return [v / total for v in values]
`;

  it('correctly resolves and verifies valid code anchor', () => {
    // Lines 3 to 9: calculate_entropy implementation
    const lines = sampleFileContent.split('\n');
    const targetSpan = lines.slice(2, 9).join('\n');
    const targetHash = AnchorResolver.hashContent(targetSpan);

    const anchor: CodeAnchor = {
      commitSha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      path: 'src/ml/entropy.py',
      lineStart: 3,
      lineEnd: 9,
      contentHash: targetHash
    };

    const result = AnchorResolver.resolve(sampleFileContent, anchor);
    expect(result.valid).toBe(true);
    expect(result.codeSpan).toContain('def calculate_entropy');
    expect(result.computedHash).toBe(targetHash);
  });

  it('fails with HASH_MISMATCH if code lines have been altered', () => {
    const anchor: CodeAnchor = {
      commitSha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      path: 'src/ml/entropy.py',
      lineStart: 3,
      lineEnd: 9,
      contentHash: 'f'.repeat(64) // Fake/stale hash
    };

    const result = AnchorResolver.resolve(sampleFileContent, anchor);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('HASH_MISMATCH');
  });

  it('fails with OUT_OF_BOUNDS if lines exceed file length', () => {
    const anchor: CodeAnchor = {
      commitSha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      path: 'src/ml/entropy.py',
      lineStart: 50,
      lineEnd: 60,
      contentHash: '0'.repeat(64)
    };

    const result = AnchorResolver.resolve(sampleFileContent, anchor);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('OUT_OF_BOUNDS');
  });

  it('fails with FILE_NOT_FOUND if content is empty or null', () => {
    const anchor: CodeAnchor = {
      commitSha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      path: 'src/ml/entropy.py',
      lineStart: 1,
      lineEnd: 2,
      contentHash: '0'.repeat(64)
    };

    const result = AnchorResolver.resolve('', anchor);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('FILE_NOT_FOUND');
  });
});

