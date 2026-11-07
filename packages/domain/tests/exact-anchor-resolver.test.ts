import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID, createHash } from 'crypto';
import {
  ExactCodeAnchor,
  SourceSnapshot,
} from '@pramaan/contracts';
import {
  AnchorResolver,
  InMemorySourceSnapshotStore,
  TypeScriptAstParser,
} from '../src/index.js';

describe('Exact Code Anchor Resolver (P0-05) — Domain & Integrity Test Suite', () => {
  const currentParserVersion = new TypeScriptAstParser().parserVersion;
  const sampleOrgId = '00000000-0000-0000-0000-000000000001';
  const sampleRepoId = '11111111-1111-1111-1111-111111111111';
  const sampleCommitSha = '4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b';
  const sampleFilePath = 'src/algorithms/entropy.ts';

  const sampleTypeScriptContent = `/**
 * Information theory utilities for computing data dispersion.
 */
export function calculateShannonEntropy(probabilities: number[]): number {
  let entropy = 0;
  for (const p of probabilities) {
    if (p > 0) {
      entropy -= p * Math.log2(p);
    }
  }
  return entropy;
}

export class DistributionAnalyzer {
  public normalize(values: number[]): number[] {
    const total = values.reduce((acc, curr) => acc + curr, 0);
    if (total === 0) return values.map(() => 0);
    return values.map(v => v / total);
  }

  public computeKLDivergence(p: number[], q: number[]): number {
    return p.reduce((sum, pVal, i) => {
      const qVal = q[i];
      if (pVal > 0 && qVal > 0) {
        return sum + pVal * Math.log2(pVal / qVal);
      }
      return sum;
    }, 0);
  }
}
`;

  let snapshotStore: InMemorySourceSnapshotStore;
  let sampleSnapshot: SourceSnapshot;
  let rawFileHash: string;
  let rawFileBytes: Buffer;

  beforeEach(() => {
    snapshotStore = new InMemorySourceSnapshotStore();
    rawFileBytes = Buffer.from(sampleTypeScriptContent, 'utf8');
    rawFileHash = createHash('sha256').update(rawFileBytes).digest('hex');

    sampleSnapshot = {
      snapshotId: randomUUID(),
      orgId: sampleOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: rawFileBytes,
      rawFileHash,
      capturedAt: new Date().toISOString(),
    };

    snapshotStore.saveSnapshot(sampleSnapshot);
  });

  // --------------------------------------------------------------------------
  // Core Matrix Scenarios from Specification
  // --------------------------------------------------------------------------

  it('1. Original source and correct anchor -> RESOLVED', () => {
    // calculateShannonEntropy is lines 4 to 12
    const lines = sampleTypeScriptContent.split('\n');
    const targetSpan = lines.slice(3, 12).join('\n');
    const contentHash = AnchorResolver.hashRawBytes(targetSpan);

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: sampleOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 4,
      lineEnd: 12,
      contentHash,
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const result = AnchorResolver.resolve(sampleSnapshot, anchor);
    expect(result.status).toBe('RESOLVED');
    expect(result.valid).toBe(true);
    expect(result.codeSpan).toContain('function calculateShannonEntropy');
    expect(result.computedHash).toBe(contentHash);
    expect(result.computedFileHash).toBe(rawFileHash);
  });

  it('2. Source content modified -> ANCHOR_INVALID (RAW_FILE_HASH_MISMATCH)', () => {
    const tamperedContent = sampleTypeScriptContent + '\n// Tampered comment at bottom\n';
    const tamperedBytes = Buffer.from(tamperedContent, 'utf8');

    const tamperedSnapshot: SourceSnapshot = {
      ...sampleSnapshot,
      rawBytes: tamperedBytes,
      rawFileHash: createHash('sha256').update(tamperedBytes).digest('hex'),
    };

    const lines = sampleTypeScriptContent.split('\n');
    const targetSpan = lines.slice(3, 12).join('\n');
    const contentHash = AnchorResolver.hashRawBytes(targetSpan);

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: sampleOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 4,
      lineEnd: 12,
      contentHash,
      rawFileHash, // Expects original file hash
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const result = AnchorResolver.resolve(tamperedSnapshot, anchor);
    expect(result.status).toBe('ANCHOR_INVALID');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('RAW_FILE_HASH_MISMATCH');
  });

  it('3. Anchored function content modified -> ANCHOR_INVALID (HASH_MISMATCH)', () => {
    // Modify entropy formula inside the function
    const tamperedSource = sampleTypeScriptContent.replace(
      'entropy -= p * Math.log2(p);',
      'entropy -= p * Math.log10(p); // Injected subtle bug'
    );
    const tamperedBytes = Buffer.from(tamperedSource, 'utf8');
    const tamperedFileHash = createHash('sha256').update(tamperedBytes).digest('hex');

    const tamperedSnapshot: SourceSnapshot = {
      ...sampleSnapshot,
      rawBytes: tamperedBytes,
      rawFileHash: tamperedFileHash,
    };

    const lines = sampleTypeScriptContent.split('\n');
    const originalSpan = lines.slice(3, 12).join('\n');
    const originalHash = AnchorResolver.hashRawBytes(originalSpan);

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: sampleOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 4,
      lineEnd: 12,
      contentHash: originalHash,
      rawFileHash: tamperedFileHash, // File hash matches, but function was tampered
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const result = AnchorResolver.resolve(tamperedSnapshot, anchor);
    expect(result.status).toBe('ANCHOR_INVALID');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('HASH_MISMATCH');
    expect(result.codeSpan).toContain('Math.log10(p)');
  });

  it('4. Wrong commit SHA -> Rejected (ANCHOR_INVALID / COMMIT_MISMATCH)', () => {
    const lines = sampleTypeScriptContent.split('\n');
    const targetSpan = lines.slice(3, 12).join('\n');
    const contentHash = AnchorResolver.hashRawBytes(targetSpan);

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: sampleOrgId,
      repositoryId: sampleRepoId,
      commitSha: '9999999999999999999999999999999999999999', // Divergent commit
      filePath: sampleFilePath,
      lineStart: 4,
      lineEnd: 12,
      contentHash,
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const result = AnchorResolver.resolve(sampleSnapshot, anchor);
    expect(result.status).toBe('ANCHOR_INVALID');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('COMMIT_MISMATCH');
  });

  it('5. Wrong file path -> Rejected (FILE_NOT_FOUND)', () => {
    const lines = sampleTypeScriptContent.split('\n');
    const targetSpan = lines.slice(3, 12).join('\n');
    const contentHash = AnchorResolver.hashRawBytes(targetSpan);

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: sampleOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/other/different-path.ts',
      lineStart: 4,
      lineEnd: 12,
      contentHash,
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const result = AnchorResolver.resolve(sampleSnapshot, anchor);
    expect(result.status).toBe('FILE_NOT_FOUND');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('FILE_NOT_FOUND');
  });

  it('6. Missing snapshot -> Explicit failure (SNAPSHOT_NOT_FOUND)', () => {
    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: sampleOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 4,
      lineEnd: 12,
      contentHash: 'a'.repeat(64),
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const result = AnchorResolver.resolve(null, anchor);
    expect(result.status).toBe('SNAPSHOT_NOT_FOUND');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('SNAPSHOT_NOT_FOUND');
  });

  it('7. Wrong raw file hash claimed in anchor -> ANCHOR_INVALID', () => {
    const lines = sampleTypeScriptContent.split('\n');
    const targetSpan = lines.slice(3, 12).join('\n');
    const contentHash = AnchorResolver.hashRawBytes(targetSpan);

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: sampleOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 4,
      lineEnd: 12,
      contentHash,
      rawFileHash: 'e'.repeat(64), // Mismatched raw file hash
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const result = AnchorResolver.resolve(sampleSnapshot, anchor);
    expect(result.status).toBe('ANCHOR_INVALID');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('RAW_FILE_HASH_MISMATCH');
  });

  it('8. Wrong source-span hash -> ANCHOR_INVALID', () => {
    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: sampleOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 4,
      lineEnd: 12,
      contentHash: 'b'.repeat(64), // Wrong span hash
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const result = AnchorResolver.resolve(sampleSnapshot, anchor);
    expect(result.status).toBe('ANCHOR_INVALID');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('HASH_MISMATCH');
  });

  it('9. Line-ending changes: Raw integrity mismatch detected with diagnostic flag', () => {
    // Convert source file to Windows CRLF line endings
    const crlfContent = sampleTypeScriptContent.replace(/\r?\n/g, '\r\n');
    const crlfBytes = Buffer.from(crlfContent, 'utf8');
    const crlfFileHash = createHash('sha256').update(crlfBytes).digest('hex');

    const crlfSnapshot: SourceSnapshot = {
      ...sampleSnapshot,
      rawBytes: crlfBytes,
      rawFileHash: crlfFileHash,
    };

    // Calculate LF span hash (e.g. from developer on Linux)
    const lines = sampleTypeScriptContent.split('\n');
    const lfSpan = lines.slice(3, 12).join('\n');
    const lfSpanHash = AnchorResolver.hashRawBytes(lfSpan);

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: sampleOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 4,
      lineEnd: 12,
      contentHash: lfSpanHash, // LF raw hash
      rawFileHash: crlfFileHash,
      normalizedContentHash: AnchorResolver.hashNormalizedContent(lfSpan),
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const result = AnchorResolver.resolve(crlfSnapshot, anchor);
    // Raw integrity fails!
    expect(result.status).toBe('ANCHOR_INVALID');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('HASH_MISMATCH');
    // Diagnostic indicates line ending mismatch
    expect(result.diagnostics?.lineEndingMismatch).toBe(true);
  });

  it('10. Normalized hash comparison is diagnostic only and never overrides raw integrity failure', () => {
    // Add extra trailing whitespace and altered newline
    const alteredSpan = 'export function calculateShannonEntropy(probabilities: number[]): number { \r\n';
    const normHash = AnchorResolver.hashNormalizedContent(alteredSpan);
    const rawHash = AnchorResolver.hashRawBytes(alteredSpan);

    expect(normHash).not.toBe(rawHash);

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: sampleOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 4,
      lineEnd: 12,
      contentHash: 'f'.repeat(64), // Mismatched raw hash
      rawFileHash,
      normalizedContentHash: normHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const result = AnchorResolver.resolve(sampleSnapshot, anchor);
    // MUST NOT resolve merely because a normalized hash exists
    expect(result.status).toBe('ANCHOR_INVALID');
    expect(result.valid).toBe(false);
  });

  it('11. File renamed -> No silent fallback (FILE_NOT_FOUND)', () => {
    const lines = sampleTypeScriptContent.split('\n');
    const targetSpan = lines.slice(3, 12).join('\n');
    const contentHash = AnchorResolver.hashRawBytes(targetSpan);

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: sampleOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/algorithms/entropy-renamed.ts',
      lineStart: 4,
      lineEnd: 12,
      contentHash,
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const result = AnchorResolver.resolve(sampleSnapshot, anchor);
    expect(result.status).toBe('FILE_NOT_FOUND');
    expect(result.valid).toBe(false);
  });

  it('12. Empty or invalid source -> Graceful failure', () => {
    const emptySnapshot: SourceSnapshot = {
      ...sampleSnapshot,
      rawBytes: Buffer.from('', 'utf8'),
      rawFileHash: createHash('sha256').update(Buffer.from('', 'utf8')).digest('hex'),
    };

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: sampleOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 1,
      lineEnd: 5,
      contentHash: 'a'.repeat(64),
      rawFileHash: emptySnapshot.rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const result = AnchorResolver.resolve(emptySnapshot, anchor);
    expect(result.status).toBe('FILE_NOT_FOUND');
    expect(result.valid).toBe(false);
  });

  it('13. Parser version unavailable -> Explicit failure (PARSER_VERSION_UNAVAILABLE)', () => {
    const lines = sampleTypeScriptContent.split('\n');
    const targetSpan = lines.slice(3, 12).join('\n');
    const contentHash = AnchorResolver.hashRawBytes(targetSpan);

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: sampleOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 4,
      lineEnd: 12,
      contentHash,
      rawFileHash,
      parserName: 'unregistered-custom-parser',
      parserVersion: '99.0.0', // Not present in registry
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const result = AnchorResolver.resolve(sampleSnapshot, anchor);
    expect(result.status).toBe('PARSER_VERSION_UNAVAILABLE');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('PARSER_VERSION_UNAVAILABLE');
  });

  it('14. Repository history rewritten or remote commit unavailable -> Retained snapshot still resolves', async () => {
    // Simulate remote git repository deletion or force push
    // PRAMAAN resolves from retained immutable snapshot in store
    const lines = sampleTypeScriptContent.split('\n');
    const targetSpan = lines.slice(3, 12).join('\n');
    const contentHash = AnchorResolver.hashRawBytes(targetSpan);

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: sampleOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 4,
      lineEnd: 12,
      contentHash,
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    // Resolve purely from store without any network or git call
    const result = await AnchorResolver.resolveFromStore(snapshotStore, anchor);
    expect(result.status).toBe('RESOLVED');
    expect(result.valid).toBe(true);
    expect(result.codeSpan).toContain('calculateShannonEntropy');
  });

  it('15. Snapshot store enforces immutability and rejects divergent overwrites', () => {
    const duplicateTamperedSnapshot: SourceSnapshot = {
      ...sampleSnapshot,
      snapshotId: randomUUID(),
      rawBytes: Buffer.from('console.log("tampered")', 'utf8'),
      rawFileHash: createHash('sha256').update('console.log("tampered")', 'utf8').digest('hex'),
    };

    expect(() => {
      snapshotStore.saveSnapshot(duplicateTamperedSnapshot);
    }).toThrow(/IMMUTABLE_SNAPSHOT_MUTATION_REJECTED/);
  });

  // --------------------------------------------------------------------------
  // AST-Based Code Location & Language Parser (TypeScriptAstParser)
  // --------------------------------------------------------------------------

  it('16. TypeScriptAstParser identifies functions, classes, and methods with exact offsets', () => {
    const parser = new TypeScriptAstParser();
    expect(parser.supports('src/algorithms/entropy.ts')).toBe(true);
    expect(parser.supports('src/components/Card.tsx')).toBe(true);
    expect(parser.supports('scripts/runner.py')).toBe(false);

    const parseResult = parser.parse(sampleTypeScriptContent, sampleFilePath);
    expect(parseResult.success).toBe(true);
    expect(parseResult.parserName).toBe('typescript-ast');
    expect(parseResult.parserVersion).toBe(currentParserVersion);
    expect(parseResult.errors.length).toBe(0);

    // Identify symbols
    const func = parseResult.symbols.find(s => s.name === 'calculateShannonEntropy');
    expect(func).toBeDefined();
    expect(func?.kind).toBe('function');
    expect(func?.lineStart).toBe(4);
    expect(func?.lineEnd).toBe(12);
    expect(func?.codeSpan).toContain('function calculateShannonEntropy');
    expect(func?.contentHash).toBe(AnchorResolver.hashRawBytes(func!.codeSpan));

    // Identify class and method
    const cls = parseResult.symbols.find(s => s.name === 'DistributionAnalyzer');
    expect(cls).toBeDefined();
    expect(cls?.kind).toBe('class');

    const method = parseResult.symbols.find(s => s.name === 'normalize');
    expect(method).toBeDefined();
    expect(method?.kind).toBe('method');
    expect(method?.containerName).toBe('DistributionAnalyzer');
    expect(method?.lineStart).toBe(15);
    expect(method?.lineEnd).toBe(19);
  });

  it('17. Byte-offset based anchor resolution with AST parser results', () => {
    const parser = new TypeScriptAstParser();
    const parseResult = parser.parse(sampleTypeScriptContent, sampleFilePath);
    const funcSymbol = parseResult.symbols.find(s => s.name === 'calculateShannonEntropy')!;

    // Create anchor using exact byte offsets from AST
    const byteAnchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: sampleOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: funcSymbol.lineStart,
      lineEnd: funcSymbol.lineEnd,
      byteStart: funcSymbol.byteStart,
      byteEnd: funcSymbol.byteEnd,
      contentHash: funcSymbol.contentHash,
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const result = AnchorResolver.resolve(sampleSnapshot, byteAnchor);
    expect(result.status).toBe('RESOLVED');
    expect(result.valid).toBe(true);
    expect(result.codeSpan).toBe(funcSymbol.codeSpan);
    expect(result.computedHash).toBe(funcSymbol.contentHash);
  });

  it('18. Gracefully handles syntax errors in untrusted source without crashing', () => {
    const brokenSource = `
      function brokenSyntax( {
        const x = ;
        return x;
    `;
    const parser = new TypeScriptAstParser();
    const parseResult = parser.parse(brokenSource, 'src/broken.ts');
    // Parser does not throw; records errors gracefully
    expect(parseResult.parserName).toBe('typescript-ast');
    expect(parseResult.errors.length).toBeGreaterThan(0);
    expect(parseResult.success).toBe(false);
  });

  it('19. Handles Unicode and non-ASCII characters accurately in spans and hashes', () => {
    const unicodeSource = `// भारतीय प्रौद्योगिकी संस्थान (IIT) — प्लेसमेंट कोड
export function greetCandidate(naam: string): string {
  const greeting = \`नमस्ते \${naam}! आपका PRAMAAN सत्यापन सफल हुआ।\`;
  return greeting;
}
`;
    const unicodeBytes = Buffer.from(unicodeSource, 'utf8');
    const unicodeHash = createHash('sha256').update(unicodeBytes).digest('hex');

    const unicodeSnapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/hindi-test.ts',
      rawBytes: unicodeBytes,
      rawFileHash: unicodeHash,
      capturedAt: new Date().toISOString(),
    };

    const parser = new TypeScriptAstParser();
    const parseResult = parser.parse(unicodeBytes, 'src/hindi-test.ts');
    expect(parseResult.success).toBe(true);
    const func = parseResult.symbols.find(s => s.name === 'greetCandidate')!;
    expect(func).toBeDefined();
    expect(func.codeSpan).toContain('नमस्ते');

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: sampleOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/hindi-test.ts',
      lineStart: func.lineStart,
      lineEnd: func.lineEnd,
      byteStart: func.byteStart,
      byteEnd: func.byteEnd,
      contentHash: func.contentHash,
      rawFileHash: unicodeHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const result = AnchorResolver.resolve(unicodeSnapshot, anchor);
    expect(result.status).toBe('RESOLVED');
    expect(result.valid).toBe(true);
    expect(result.codeSpan).toContain('नमस्ते');
    expect(result.computedHash).toBe(func.contentHash);
  });

  it('20. Determinism & repeated resolution idempotency', () => {
    const lines = sampleTypeScriptContent.split('\n');
    const targetSpan = lines.slice(3, 12).join('\n');
    const contentHash = AnchorResolver.hashRawBytes(targetSpan);

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: sampleOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 4,
      lineEnd: 12,
      contentHash,
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    // Run 100 consecutive resolutions to prove 100% determinism
    for (let i = 0; i < 100; i++) {
      const res = AnchorResolver.resolve(sampleSnapshot, anchor);
      expect(res.status).toBe('RESOLVED');
      expect(res.valid).toBe(true);
      expect(res.computedHash).toBe(contentHash);
    }
  });

  it('21. Mutation testing: Single-character mutations anywhere in the span trigger ANCHOR_INVALID', () => {
    const lines = sampleTypeScriptContent.split('\n');
    const originalSpan = lines.slice(3, 12).join('\n');
    const originalHash = AnchorResolver.hashRawBytes(originalSpan);

    // Mutate various characters inside the span
    const mutations = [
      originalSpan.replace('entropy = 0', 'entropy = 1'),
      originalSpan.replace('p > 0', 'p >= 0'),
      originalSpan.replace('probabilities', 'probs'),
      originalSpan.replace('Math.log2', 'Math.log'),
      originalSpan + ' ',
    ];

    for (const mutatedSpan of mutations) {
      const tamperedFileText = sampleTypeScriptContent.replace(originalSpan, mutatedSpan);
      const tamperedBytes = Buffer.from(tamperedFileText, 'utf8');
      const tamperedFileHash = createHash('sha256').update(tamperedBytes).digest('hex');

      const tamperedSnapshot: SourceSnapshot = {
        ...sampleSnapshot,
        rawBytes: tamperedBytes,
        rawFileHash: tamperedFileHash,
      };

      const anchor: ExactCodeAnchor = {
        id: randomUUID(),
        orgId: sampleOrgId,
        repositoryId: sampleRepoId,
        commitSha: sampleCommitSha,
        filePath: sampleFilePath,
        lineStart: 4,
        lineEnd: 12,
        contentHash: originalHash,
        rawFileHash: tamperedFileHash,
        parserName: 'typescript-ast',
        parserVersion: currentParserVersion,
        createdAt: new Date().toISOString(),
        status: 'RESOLVED',
      };

      const result = AnchorResolver.resolve(tamperedSnapshot, anchor);
      expect(result.status).toBe('ANCHOR_INVALID');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('HASH_MISMATCH');
    }
  });

  it('22. Backward compatibility: legacy CodeAnchor resolves seamlessly', () => {
    const lines = sampleTypeScriptContent.split('\n');
    const targetSpan = lines.slice(3, 12).join('\n');
    const targetHash = AnchorResolver.hashContent(targetSpan);

    const legacyAnchor = {
      commitSha: sampleCommitSha,
      path: sampleFilePath,
      lineStart: 4,
      lineEnd: 12,
      contentHash: targetHash,
    };

    const result = AnchorResolver.resolve(sampleTypeScriptContent, legacyAnchor);
    expect(result.valid).toBe(true);
    expect(result.codeSpan).toContain('function calculateShannonEntropy');
    expect(result.computedHash).toBe(targetHash);
  });

  // --------------------------------------------------------------------------
  // HARDENING TESTS (Sections 6, 7, 8, 9)
  // --------------------------------------------------------------------------

  it('23. Rejects lineEnd beyond total source lines (OUT_OF_BOUNDS)', () => {
    const lines = sampleTypeScriptContent.split('\n');
    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: sampleOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 4,
      lineEnd: lines.length + 50, // Beyond end of file!
      contentHash: 'a'.repeat(64),
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const result = AnchorResolver.resolve(sampleSnapshot, anchor);
    expect(result.status).toBe('ANCHOR_INVALID');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('OUT_OF_BOUNDS');
  });

  it('24. Rejects lineStart beyond total source lines (OUT_OF_BOUNDS)', () => {
    const lines = sampleTypeScriptContent.split('\n');
    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: sampleOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: lines.length + 10,
      lineEnd: lines.length + 20,
      contentHash: 'a'.repeat(64),
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const result = AnchorResolver.resolve(sampleSnapshot, anchor);
    expect(result.status).toBe('ANCHOR_INVALID');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('OUT_OF_BOUNDS');
  });

  it('25. Incomplete byte offsets: rejects when only byteStart is provided', () => {
    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: sampleOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 4,
      lineEnd: 12,
      byteStart: 75,
      // byteEnd omitted
      contentHash: 'a'.repeat(64),
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const result = AnchorResolver.resolve(sampleSnapshot, anchor);
    expect(result.status).toBe('ANCHOR_INVALID');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('INCOMPLETE_BYTE_OFFSETS');
  });

  it('26. Incomplete byte offsets: rejects when only byteEnd is provided', () => {
    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: sampleOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 4,
      lineEnd: 12,
      // byteStart omitted
      byteEnd: 250,
      contentHash: 'a'.repeat(64),
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const result = AnchorResolver.resolve(sampleSnapshot, anchor);
    expect(result.status).toBe('ANCHOR_INVALID');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('INCOMPLETE_BYTE_OFFSETS');
  });

  it('27. Rejects byte boundary splitting a multi-byte UTF-8 character (INVALID_UTF8_BYTE_BOUNDARY)', () => {
    // Unicode text with Hindi characters (3 bytes per character in UTF-8)
    const unicodeSource = '// गणना उपयोगिता\nexport function calculate(): number { return 42; }\n';
    const unicodeBytes = Buffer.from(unicodeSource, 'utf8');
    const uRawHash = createHash('sha256').update(unicodeBytes).digest('hex');

    const uSnapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/unicode.ts',
      rawBytes: unicodeBytes,
      rawFileHash: uRawHash,
      capturedAt: new Date().toISOString(),
    };

    // The character 'ग' starts at byte 3, continuation bytes are 4 and 5
    // Byte offset 4 is inside 'ग'!
    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: sampleOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/unicode.ts',
      lineStart: 1,
      lineEnd: 1,
      byteStart: 4, // Inside multi-byte UTF-8 character!
      byteEnd: 10,
      contentHash: 'a'.repeat(64),
      rawFileHash: uRawHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const result = AnchorResolver.resolve(uSnapshot, anchor);
    expect(result.status).toBe('ANCHOR_INVALID');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('INVALID_UTF8_BYTE_BOUNDARY');
  });

  it('28. Rejects malformed non-UTF-8 source bytes safely (MALFORMED_UTF8_SOURCE)', () => {
    // Invalid UTF-8 sequence (e.g. lone continuation bytes or invalid start byte 0xFF)
    const invalidBytes = Buffer.from([0x65, 0x78, 0xff, 0xfe, 0x80, 0x81]);
    const invalidHash = createHash('sha256').update(invalidBytes).digest('hex');

    const malformedSnapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/malformed.ts',
      rawBytes: invalidBytes,
      rawFileHash: invalidHash,
      capturedAt: new Date().toISOString(),
    };

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: sampleOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/malformed.ts',
      lineStart: 1,
      lineEnd: 1,
      contentHash: 'a'.repeat(64),
      rawFileHash: invalidHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const result = AnchorResolver.resolve(malformedSnapshot, anchor);
    expect(result.status).toBe('ANCHOR_INVALID');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('MALFORMED_UTF8_SOURCE');
  });

  it('29. Rejects inconsistent line and byte offset metadata (LINE_BYTE_METADATA_INCONSISTENT)', () => {
    // Valid symbol byte range is lines 4-12, but anchor metadata claims lines 1-3
    const parser = new TypeScriptAstParser();
    const parseRes = parser.parse(sampleTypeScriptContent, sampleFilePath);
    const entropySymbol = parseRes.symbols.find(s => s.name === 'calculateShannonEntropy')!;

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: sampleOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 1, // Inconsistent! Should be 4
      lineEnd: 3,   // Inconsistent! Should be 12
      byteStart: entropySymbol.byteStart,
      byteEnd: entropySymbol.byteEnd,
      contentHash: entropySymbol.contentHash,
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const result = AnchorResolver.resolve(sampleSnapshot, anchor);
    expect(result.status).toBe('ANCHOR_INVALID');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('LINE_BYTE_METADATA_INCONSISTENT');
  });

  it('30. Rejects Git blobSha mismatch when present in anchor and snapshot', () => {
    const snapshotWithBlob: SourceSnapshot = {
      ...sampleSnapshot,
      blobSha: '1111111111111111111111111111111111111111',
    };

    const lines = sampleTypeScriptContent.split('\n');
    const targetSpan = lines.slice(3, 12).join('\n');
    const contentHash = createHash('sha256').update(Buffer.from(targetSpan, 'utf8')).digest('hex');

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: sampleOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      blobSha: '2222222222222222222222222222222222222222', // Mismatch!
      lineStart: 4,
      lineEnd: 12,
      contentHash,
      rawFileHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const result = AnchorResolver.resolve(snapshotWithBlob, anchor);
    expect(result.status).toBe('ANCHOR_INVALID');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('BLOB_SHA_MISMATCH');
  });

  it('31. Whitespace alterations are flagged as whitespaceMismatch, NOT lineEndingMismatch', () => {
    const lines = sampleTypeScriptContent.split('\n');
    const targetSpan = lines.slice(3, 12).join('\n');
    // Content hash based on untrimmed text
    const contentHash = createHash('sha256').update(Buffer.from(targetSpan, 'utf8')).digest('hex');

    // Create modified content where indentation is changed (whitespace alteration)
    const modifiedContent = sampleTypeScriptContent.replace('let entropy = 0;', '    let entropy = 0;   ');
    const modBytes = Buffer.from(modifiedContent, 'utf8');
    const modHash = createHash('sha256').update(modBytes).digest('hex');

    const modSnapshot: SourceSnapshot = {
      snapshotId: randomUUID(),
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      rawBytes: modBytes,
      rawFileHash: modHash,
      capturedAt: new Date().toISOString(),
    };

    const anchor: ExactCodeAnchor = {
      id: randomUUID(),
      orgId: sampleOrgId,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: sampleFilePath,
      lineStart: 4,
      lineEnd: 12,
      contentHash,
      rawFileHash: modHash,
      parserName: 'typescript-ast',
      parserVersion: currentParserVersion,
      createdAt: new Date().toISOString(),
      status: 'RESOLVED',
    };

    const result = AnchorResolver.resolve(modSnapshot, anchor);
    expect(result.status).toBe('ANCHOR_INVALID');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('HASH_MISMATCH');
    // Should NOT be classified as line-ending mismatch!
    expect(result.diagnostics?.lineEndingMismatch).toBe(false);
  });

  it('32. normalizeFilePath strictly rejects path traversal, null bytes, and absolute paths', async () => {
    const { normalizeFilePath } = await import('../src/snapshot-store.js');

    // Path traversal
    expect(() => normalizeFilePath('../secret.ts')).toThrow(/Path traversal segment '\.\.' is prohibited/);
    expect(() => normalizeFilePath('src/../../etc/passwd')).toThrow(/Path traversal segment '\.\.' is prohibited/);
    expect(() => normalizeFilePath('./local.ts')).toThrow(/Path traversal segment '\.' is prohibited/);

    // Null bytes
    expect(() => normalizeFilePath('src/math.ts\0.js')).toThrow(/File path contains null bytes/);

    // Absolute Unix paths
    expect(() => normalizeFilePath('/etc/hosts')).toThrow(/Absolute paths are prohibited/);
    expect(() => normalizeFilePath('\\windows\\system32')).toThrow(/Absolute paths are prohibited/);

    // Absolute Windows drive paths
    expect(() => normalizeFilePath('C:/boot.ini')).toThrow(/Absolute Windows drive paths are prohibited/);
    expect(() => normalizeFilePath('D:\\data\\file.ts')).toThrow(/Absolute Windows drive paths are prohibited/);

    // Empty and whitespace paths
    expect(() => normalizeFilePath('')).toThrow(/cannot be empty/);
    expect(() => normalizeFilePath('   ')).toThrow(/cannot be empty/);

    // Duplicate slashes
    expect(() => normalizeFilePath('src//math.ts')).toThrow(/Duplicate path separators are prohibited/);

    // Valid canonical paths
    expect(normalizeFilePath('src/algorithms/entropy.ts')).toBe('src/algorithms/entropy.ts');
    expect(normalizeFilePath('src\\algorithms\\entropy.ts')).toBe('src/algorithms/entropy.ts');
  });

  it('33. InMemorySourceSnapshotStore defensive byte copying prevents external Buffer mutation', () => {
    const store = new InMemorySourceSnapshotStore();
    const originalBuffer = Buffer.from('console.log("immutable");', 'utf8');
    const originalHash = createHash('sha256').update(originalBuffer).digest('hex');

    const snap: SourceSnapshot = {
      snapshotId: randomUUID(),
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/test-immutable.ts',
      rawBytes: originalBuffer,
      rawFileHash: originalHash,
      capturedAt: new Date().toISOString(),
    };

    store.saveSnapshot(snap);

    // 1. Mutate the caller's original buffer
    originalBuffer[0] = 0x58; // 'X'

    // 2. Fetch snapshot from store and verify stored bytes were NOT mutated!
    const retrieved = store.getSnapshot(sampleRepoId, sampleCommitSha, 'src/test-immutable.ts');
    expect(retrieved).toBeDefined();
    expect(retrieved!.rawBytes.toString('utf8')).toBe('console.log("immutable");');
    expect(retrieved!.rawBytes[0]).toBe(0x63); // 'c'

    // 3. Mutate the retrieved buffer
    (retrieved!.rawBytes as Buffer)[0] = 0x5a; // 'Z'

    // 4. Fetch again and verify store remains pristine!
    const retrievedAgain = store.getSnapshot(sampleRepoId, sampleCommitSha, 'src/test-immutable.ts');
    expect(retrievedAgain!.rawBytes.toString('utf8')).toBe('console.log("immutable");');
  });

  it('34. Tenant A retrieves its own snapshot from store', () => {
    const store = new InMemorySourceSnapshotStore();
    const collegeA = '00000000-0000-0000-0000-000000000001';

    const snapA: SourceSnapshot = {
      snapshotId: randomUUID(),
      orgId: collegeA,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/secretA.ts',
      rawBytes: Buffer.from('college A secret', 'utf8'),
      rawFileHash: createHash('sha256').update('college A secret').digest('hex'),
      capturedAt: new Date().toISOString(),
    };

    store.saveSnapshot(snapA);
    const retrieved = store.getSnapshot(sampleRepoId, sampleCommitSha, 'src/secretA.ts', collegeA);
    expect(retrieved).toBeDefined();
    expect(retrieved!.orgId).toBe(collegeA);
    expect(store.hasSnapshot(sampleRepoId, sampleCommitSha, 'src/secretA.ts', collegeA)).toBe(true);
  });

  it('35. Tenant B cannot retrieve Tenant A snapshot (cross-tenant isolation)', () => {
    const store = new InMemorySourceSnapshotStore();
    const collegeA = '00000000-0000-0000-0000-000000000001';
    const collegeB = '00000000-0000-0000-0000-000000000002';

    const snapA: SourceSnapshot = {
      snapshotId: randomUUID(),
      orgId: collegeA,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/secretA.ts',
      rawBytes: Buffer.from('college A secret', 'utf8'),
      rawFileHash: createHash('sha256').update('college A secret').digest('hex'),
      capturedAt: new Date().toISOString(),
    };

    store.saveSnapshot(snapA);
    expect(store.getSnapshot(sampleRepoId, sampleCommitSha, 'src/secretA.ts', collegeB)).toBeUndefined();
    expect(store.hasSnapshot(sampleRepoId, sampleCommitSha, 'src/secretA.ts', collegeB)).toBe(false);
  });

  it('36. Tenant A cannot retrieve Tenant B snapshot (bidirectional isolation)', () => {
    const store = new InMemorySourceSnapshotStore();
    const collegeA = '00000000-0000-0000-0000-000000000001';
    const collegeB = '00000000-0000-0000-0000-000000000002';

    const snapB: SourceSnapshot = {
      snapshotId: randomUUID(),
      orgId: collegeB,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/secretB.ts',
      rawBytes: Buffer.from('college B secret', 'utf8'),
      rawFileHash: createHash('sha256').update('college B secret').digest('hex'),
      capturedAt: new Date().toISOString(),
    };

    store.saveSnapshot(snapB);
    expect(store.getSnapshot(sampleRepoId, sampleCommitSha, 'src/secretB.ts', collegeA)).toBeUndefined();
    expect(store.hasSnapshot(sampleRepoId, sampleCommitSha, 'src/secretB.ts', collegeA)).toBe(false);
  });

  it('37. Tenant A cannot retrieve an unscoped snapshot (no silent fallback to unscoped)', () => {
    const store = new InMemorySourceSnapshotStore();
    const collegeA = '00000000-0000-0000-0000-000000000001';

    const unscopedSnap: SourceSnapshot = {
      snapshotId: randomUUID(),
      orgId: undefined, // Unscoped!
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/unscoped.ts',
      rawBytes: Buffer.from('unscoped legacy code', 'utf8'),
      rawFileHash: createHash('sha256').update('unscoped legacy code').digest('hex'),
      capturedAt: new Date().toISOString(),
    };

    store.saveSnapshot(unscopedSnap);

    // Tenant-scoped query MUST NOT fall back to unscoped snapshot
    expect(store.getSnapshot(sampleRepoId, sampleCommitSha, 'src/unscoped.ts', collegeA)).toBeUndefined();
    expect(store.hasSnapshot(sampleRepoId, sampleCommitSha, 'src/unscoped.ts', collegeA)).toBe(false);
  });

  it('38. Tenant B cannot retrieve an unscoped snapshot (no silent fallback to unscoped)', () => {
    const store = new InMemorySourceSnapshotStore();
    const collegeB = '00000000-0000-0000-0000-000000000002';

    const unscopedSnap: SourceSnapshot = {
      snapshotId: randomUUID(),
      orgId: undefined,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/unscoped2.ts',
      rawBytes: Buffer.from('unscoped code 2', 'utf8'),
      rawFileHash: createHash('sha256').update('unscoped code 2').digest('hex'),
      capturedAt: new Date().toISOString(),
    };

    store.saveSnapshot(unscopedSnap);

    expect(store.getSnapshot(sampleRepoId, sampleCommitSha, 'src/unscoped2.ts', collegeB)).toBeUndefined();
    expect(store.hasSnapshot(sampleRepoId, sampleCommitSha, 'src/unscoped2.ts', collegeB)).toBe(false);
  });

  it('39. Hash-based lookup cannot bypass tenant isolation', () => {
    const store = new InMemorySourceSnapshotStore();
    const collegeA = '00000000-0000-0000-0000-000000000001';
    const collegeB = '00000000-0000-0000-0000-000000000002';

    const bytesA = Buffer.from('hash test content A', 'utf8');
    const hashA = createHash('sha256').update(bytesA).digest('hex');

    const snapA: SourceSnapshot = {
      snapshotId: randomUUID(),
      orgId: collegeA,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/hashA.ts',
      rawBytes: bytesA,
      rawFileHash: hashA,
      capturedAt: new Date().toISOString(),
    };
    store.saveSnapshot(snapA);

    // Tenant A finds by hash with its orgId
    expect(store.getSnapshotByHash(hashA, collegeA)).toBeDefined();

    // Tenant B cannot find Tenant A's snapshot by hash
    expect(store.getSnapshotByHash(hashA, collegeB)).toBeUndefined();

    // Unscoped snapshot by hash
    const bytesUnscoped = Buffer.from('unscoped hash content', 'utf8');
    const hashUnscoped = createHash('sha256').update(bytesUnscoped).digest('hex');
    const unscopedSnap: SourceSnapshot = {
      snapshotId: randomUUID(),
      orgId: undefined,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/unscopedHash.ts',
      rawBytes: bytesUnscoped,
      rawFileHash: hashUnscoped,
      capturedAt: new Date().toISOString(),
    };
    store.saveSnapshot(unscopedSnap);

    // Tenant A cannot find unscoped snapshot by hash (no fallback)
    expect(store.getSnapshotByHash(hashUnscoped, collegeA)).toBeUndefined();
    // Explicitly unscoped lookup finds it
    expect(store.getSnapshotByHash(hashUnscoped, undefined)).toBeDefined();
  });

  it('40. Unscoped lookup only works through explicitly unscoped path and never leaks tenant snapshots', () => {
    const store = new InMemorySourceSnapshotStore();
    const collegeA = '00000000-0000-0000-0000-000000000001';

    const tenantSnap: SourceSnapshot = {
      snapshotId: randomUUID(),
      orgId: collegeA,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/scoped.ts',
      rawBytes: Buffer.from('scoped content', 'utf8'),
      rawFileHash: createHash('sha256').update('scoped content').digest('hex'),
      capturedAt: new Date().toISOString(),
    };
    store.saveSnapshot(tenantSnap);

    // Unscoped query (orgId: undefined) must NOT return Tenant A's scoped snapshot
    expect(store.getSnapshot(sampleRepoId, sampleCommitSha, 'src/scoped.ts', undefined)).toBeUndefined();
    expect(store.hasSnapshot(sampleRepoId, sampleCommitSha, 'src/scoped.ts', undefined)).toBe(false);
  });

  it('41. deleteSnapshot removes newly added snapshot and preserves existing snapshots during rollback', () => {
    const store = new InMemorySourceSnapshotStore();
    const collegeA = '00000000-0000-0000-0000-000000000001';

    const snap: SourceSnapshot = {
      snapshotId: randomUUID(),
      orgId: collegeA,
      repositoryId: sampleRepoId,
      commitSha: sampleCommitSha,
      filePath: 'src/temp.ts',
      rawBytes: Buffer.from('temporary bytes', 'utf8'),
      rawFileHash: createHash('sha256').update('temporary bytes').digest('hex'),
      capturedAt: new Date().toISOString(),
    };

    store.saveSnapshot(snap);
    expect(store.hasSnapshot(sampleRepoId, sampleCommitSha, 'src/temp.ts', collegeA)).toBe(true);

    // Rollback deletes the newly added snapshot
    const deleted = store.deleteSnapshot(sampleRepoId, sampleCommitSha, 'src/temp.ts', collegeA);
    expect(deleted).toBe(true);
    expect(store.hasSnapshot(sampleRepoId, sampleCommitSha, 'src/temp.ts', collegeA)).toBe(false);
    expect(store.getSnapshot(sampleRepoId, sampleCommitSha, 'src/temp.ts', collegeA)).toBeUndefined();

    // Deleting again returns false (idempotent / non-destructive)
    expect(store.deleteSnapshot(sampleRepoId, sampleCommitSha, 'src/temp.ts', collegeA)).toBe(false);
  });
});
