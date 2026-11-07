import { describe, it, expect } from 'vitest';
import {
  computeGitBlobSha,
  computeRawFileHash,
  verifyGitBlob,
  evaluateFileEligibility,
  isBinaryContent,
} from '../src/git-object.js';
import { createHash } from 'crypto';

describe('Git Object & Raw Byte Cryptographic Verification (P0-04)', () => {
  it('1. Computes canonical Git blob SHA-1 matching git hash-object spec for empty file', () => {
    const emptyBytes = Buffer.from('');
    // git hash-object -t blob --stdin <<< "" (or empty string):
    // SHA-1("blob 0\0") = e69de29bb2d1d6434b8b29ae775ad8c2e48c5391
    const blobSha = computeGitBlobSha(emptyBytes);
    expect(blobSha).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  });

  it('2. Computes canonical Git blob SHA-1 matching known Git CLI hash for sample text', () => {
    // "hello world\n" has 12 bytes
    // git hash-object produces 3b18e512dba79e4c8300dd08aeb37f8e728b8dad
    const content = Buffer.from('hello world\n', 'utf8');
    const blobSha = computeGitBlobSha(content);
    expect(blobSha).toBe('3b18e512dba79e4c8300dd08aeb37f8e728b8dad');

    // Authoritative SHA-256 of "hello world\n"
    const rawHash = computeRawFileHash(content);
    expect(rawHash).toBe(createHash('sha256').update(content).digest('hex'));
  });

  it('3. verifyGitBlob succeeds when both Git blob SHA and raw SHA-256 match', () => {
    const content = Buffer.from('export const add = (a: number, b: number) => a + b;\n', 'utf8');
    const blobSha = computeGitBlobSha(content);
    const rawHash = computeRawFileHash(content);

    const result = verifyGitBlob(content, blobSha, rawHash);
    expect(result.valid).toBe(true);
    expect(result.blobSha).toBe(blobSha);
    expect(result.rawFileHash).toBe(rawHash);
    expect(result.byteSize).toBe(content.length);
  });

  it('4. verifyGitBlob fails closed when Git blob SHA mismatches', () => {
    const content = Buffer.from('console.log("hello");', 'utf8');
    const tamperedBlobSha = '0000000000000000000000000000000000000000';

    const result = verifyGitBlob(content, tamperedBlobSha);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('GIT_BLOB_SHA_MISMATCH');
  });

  it('5. verifyGitBlob fails closed when raw SHA-256 mismatches', () => {
    const content = Buffer.from('const x = 42;\n', 'utf8');
    const blobSha = computeGitBlobSha(content);
    const fakeRawHash = 'a'.repeat(64);

    const result = verifyGitBlob(content, blobSha, fakeRawHash);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('RAW_FILE_HASH_MISMATCH');
  });

  it('6. evaluateFileEligibility accepts supported text source files with canonical paths', () => {
    expect(evaluateFileEligibility('src/index.ts').eligible).toBe(true);
    expect(evaluateFileEligibility('lib/utils.tsx').eligible).toBe(true);
    expect(evaluateFileEligibility('components/Button.jsx').eligible).toBe(true);
    expect(evaluateFileEligibility('server.mjs').eligible).toBe(true);
    expect(evaluateFileEligibility('legacy.cjs').eligible).toBe(true);
    expect(evaluateFileEligibility('app.js').eligible).toBe(true);
  });

  it('7. evaluateFileEligibility rejects symlinks (mode 120000) and submodules (mode 160000)', () => {
    expect(evaluateFileEligibility('src/link.ts', '120000').eligible).toBe(false);
    expect(evaluateFileEligibility('src/link.ts', '120000').reason).toContain('EXCLUDED_SYMLINK');

    expect(evaluateFileEligibility('submodules/repo', '160000').eligible).toBe(false);
    expect(evaluateFileEligibility('submodules/repo', '160000').reason).toContain('EXCLUDED_SUBMODULE');
  });

  it('8. evaluateFileEligibility rejects vendor/build directories and path traversals', () => {
    expect(evaluateFileEligibility('node_modules/pkg/index.js').eligible).toBe(false);
    expect(evaluateFileEligibility('dist/bundle.js').eligible).toBe(false);
    expect(evaluateFileEligibility('.next/server/pages.js').eligible).toBe(false);
    expect(evaluateFileEligibility('../src/index.ts').eligible).toBe(false);
  });

  it('9. evaluateFileEligibility rejects secret, credential, and env files', () => {
    expect(evaluateFileEligibility('.env').eligible).toBe(false);
    expect(evaluateFileEligibility('.env.production').eligible).toBe(false);
    expect(evaluateFileEligibility('certs/server.pem').eligible).toBe(false);
    expect(evaluateFileEligibility('keys/id_rsa').eligible).toBe(false);
    expect(evaluateFileEligibility('config/credentials.json').eligible).toBe(false);
  });

  it('10. isBinaryContent identifies null bytes in binary payloads', () => {
    const textBuffer = Buffer.from('function main() { return 0; }', 'utf8');
    expect(isBinaryContent(textBuffer)).toBe(false);

    const binaryBuffer = Buffer.concat([
      Buffer.from('PNG\r\n\x1a\n'),
      Buffer.from([0x00, 0x00, 0x00, 0x0d]),
    ]);
    expect(isBinaryContent(binaryBuffer)).toBe(true);
  });
});
