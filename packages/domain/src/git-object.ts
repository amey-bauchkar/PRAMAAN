import { createHash } from 'crypto';
import { normalizeFilePath } from './snapshot-store.js';

export interface GitObjectVerificationResult {
  valid: boolean;
  blobSha: string;
  rawFileHash: string;
  byteSize: number;
  reason?: string;
}

/**
 * Computes the official Git blob object SHA-1 hash:
 * SHA1("blob " + byteLength + "\0" + rawBytes)
 * Exactly reproduces Git's canonical object hash format.
 */
export function computeGitBlobSha(rawBytes: Buffer | Uint8Array): string {
  const bytes = Buffer.isBuffer(rawBytes) ? rawBytes : Buffer.from(rawBytes);
  const header = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
  return createHash('sha1')
    .update(header)
    .update(bytes)
    .digest('hex')
    .toLowerCase();
}

/**
 * Computes the authoritative SHA-256 hash of raw file bytes.
 */
export function computeRawFileHash(rawBytes: Buffer | Uint8Array): string {
  const bytes = Buffer.isBuffer(rawBytes) ? rawBytes : Buffer.from(rawBytes);
  return createHash('sha256').update(bytes).digest('hex').toLowerCase();
}

/**
 * Cryptographically verifies raw file bytes against expected Git blob SHA and raw SHA-256.
 * Guarantees zero byte mutations or newline re-encodings before hash validation.
 */
export function verifyGitBlob(
  rawBytes: Buffer | Uint8Array,
  expectedBlobSha?: string,
  expectedRawHash?: string
): GitObjectVerificationResult {
  const bytes = Buffer.isBuffer(rawBytes) ? rawBytes : Buffer.from(rawBytes);
  const byteSize = bytes.length;
  const computedBlobSha = computeGitBlobSha(bytes);
  const computedRawHash = computeRawFileHash(bytes);

  if (expectedBlobSha !== undefined) {
    const expectedLower = expectedBlobSha.toLowerCase();
    if (computedBlobSha !== expectedLower) {
      return {
        valid: false,
        blobSha: computedBlobSha,
        rawFileHash: computedRawHash,
        byteSize,
        reason: `GIT_BLOB_SHA_MISMATCH: Computed blob SHA '${computedBlobSha}' does not match expected '${expectedLower}'`,
      };
    }
  }

  if (expectedRawHash !== undefined) {
    const expectedLower = expectedRawHash.toLowerCase();
    if (computedRawHash !== expectedLower) {
      return {
        valid: false,
        blobSha: computedBlobSha,
        rawFileHash: computedRawHash,
        byteSize,
        reason: `RAW_FILE_HASH_MISMATCH: Computed raw hash '${computedRawHash}' does not match expected '${expectedLower}'`,
      };
    }
  }

  return {
    valid: true,
    blobSha: computedBlobSha,
    rawFileHash: computedRawHash,
    byteSize,
  };
}

/**
 * Checks if a file path is a supported text source format for static analysis.
 */
export const SUPPORTED_SOURCE_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
]);

/**
 * Standard excluded directories (vendor, build, output, VCS).
 */
export const EXCLUDED_DIRECTORY_SEGMENTS = new Set([
  'node_modules',
  'vendor',
  '.git',
  '.github',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
  '__pycache__',
]);

/**
 * Patterns matching sensitive/secret-bearing file names.
 */
const SENSITIVE_FILE_PATTERNS = [
  /^\.env(?:\..+)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.pfx$/i,
  /\.p12$/i,
  /^id_rsa(?:\.pub)?$/i,
  /^id_ecdsa(?:\.pub)?$/i,
  /^id_ed25519(?:\.pub)?$/i,
  /(?:^|[._-])credentials(?:\.[a-z0-9]+)?$/i,
  /(?:^|[._-])secrets?(?:\.[a-z0-9]+)?$/i,
];

/**
 * Evaluates whether a file is eligible for static repository ingestion.
 * Rejects non-canonical paths, unsupported extensions, excluded directories, symlinks, submodules, and secret files.
 */
export function evaluateFileEligibility(
  filePath: string,
  gitMode?: string
): { eligible: boolean; canonicalPath?: string; reason?: string } {
  // 1. Git object mode checks (symlinks mode 120000, submodules mode 160000)
  if (gitMode === '120000') {
    return { eligible: false, reason: 'EXCLUDED_SYMLINK: Symbolic links are not followed' };
  }
  if (gitMode === '160000') {
    return { eligible: false, reason: 'EXCLUDED_SUBMODULE: Git submodules are excluded' };
  }

  // 2. Canonical path validation
  let canonical: string;
  try {
    canonical = normalizeFilePath(filePath);
  } catch (err: any) {
    return { eligible: false, reason: `INVALID_PATH: ${err.message}` };
  }

  const segments = canonical.split('/');
  const fileName = segments[segments.length - 1];

  // 3. Excluded directories
  for (let i = 0; i < segments.length - 1; i++) {
    if (EXCLUDED_DIRECTORY_SEGMENTS.has(segments[i])) {
      return { eligible: false, reason: `EXCLUDED_DIRECTORY: Directory '${segments[i]}' is excluded` };
    }
  }

  // 4. Secret / sensitive files
  for (const pattern of SENSITIVE_FILE_PATTERNS) {
    if (pattern.test(fileName)) {
      return { eligible: false, reason: `EXCLUDED_SENSITIVE_FILE: Sensitive credential or secret pattern matched` };
    }
  }

  // 5. Supported source extensions
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex === -1) {
    return { eligible: false, reason: 'UNSUPPORTED_EXTENSION: File has no extension' };
  }
  const ext = fileName.slice(dotIndex).toLowerCase();
  if (!SUPPORTED_SOURCE_EXTENSIONS.has(ext)) {
    return { eligible: false, reason: `UNSUPPORTED_EXTENSION: Extension '${ext}' is not supported` };
  }

  return { eligible: true, canonicalPath: canonical };
}

/**
 * Inspects raw bytes to detect binary content (looks for null bytes in initial chunk).
 */
export function isBinaryContent(rawBytes: Buffer | Uint8Array, maxScanBytes = 8000): boolean {
  const bytes = Buffer.isBuffer(rawBytes) ? rawBytes : Buffer.from(rawBytes);
  const scanLimit = Math.min(bytes.length, maxScanBytes);
  for (let i = 0; i < scanLimit; i++) {
    if (bytes[i] === 0) {
      return true;
    }
  }
  return false;
}
