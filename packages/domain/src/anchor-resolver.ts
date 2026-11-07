import { createHash } from 'crypto';
import {
  CodeAnchor,
  ExactCodeAnchor,
  SourceSnapshot,
  AnchorResolutionStatus,
  ResolutionResult,
} from '@pramaan/contracts';
import { ISourceSnapshotStore, normalizeFilePath } from './snapshot-store.js';
import { ParserRegistry } from './ast/parser-registry.js';

export interface ResolvedAnchorResult extends ResolutionResult {
  // Legacy compatibility fields
  valid: boolean;
  codeSpan?: string;
  computedHash?: string;
  error?: string;
}

export interface ResolverOptions {
  registry?: ParserRegistry;
  skipParserVersionCheck?: boolean;
}

export class AnchorResolver {
  /**
   * Computes SHA-256 hash of raw bytes (authoritative integrity check).
   */
  public static hashRawBytes(data: Buffer | Uint8Array | string): string {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
    return createHash('sha256').update(buf).digest('hex');
  }

  /**
   * Computes SHA-256 hash with normalized line endings and whitespace trimming (diagnostic only).
   * Note: Diagnostic only; NEVER overrides raw integrity failure.
   */
  public static hashNormalizedContent(content: string): string {
    const normalized = content.replace(/\r\n/g, '\n').trim();
    return createHash('sha256').update(normalized, 'utf8').digest('hex');
  }

  /**
   * Legacy helper retained for backwards compatibility with M0.
   */
  public static hashContent(content: string): string {
    return this.hashNormalizedContent(content);
  }

  /**
   * Resolves a code anchor against an immutable source snapshot or raw source content.
   *
   * Enforces:
   * 1. Repository identity and commit SHA match
   * 2. Canonical file path verification
   * 3. Authoritative raw file hash integrity
   * 4. Parser version availability (if specified)
   * 5. Exact code span extraction and authoritative content hash verification
   * 6. Diagnostic normalization without overriding integrity failure
   */
  public static resolve(
    sourceOrSnapshot: SourceSnapshot | string | Buffer | Uint8Array | null | undefined,
    anchor: ExactCodeAnchor | CodeAnchor,
    options: ResolverOptions = {}
  ): ResolvedAnchorResult {
    // 1. Missing snapshot check
    if (sourceOrSnapshot === null || sourceOrSnapshot === undefined || sourceOrSnapshot === '') {
      const isSnapshotExpected = this.isExactAnchor(anchor);
      const errorStatus: AnchorResolutionStatus = isSnapshotExpected
        ? 'SNAPSHOT_NOT_FOUND'
        : 'FILE_NOT_FOUND';
      return {
        status: errorStatus,
        valid: false,
        error: isSnapshotExpected ? 'SNAPSHOT_NOT_FOUND' : 'FILE_NOT_FOUND',
        diagnostics: { reason: 'No source content or snapshot provided' },
      };
    }

    const isSnapshot = this.isSourceSnapshot(sourceOrSnapshot);
    const snapshot = isSnapshot ? (sourceOrSnapshot as SourceSnapshot) : undefined;

    // 2. Exact anchor identity verification against snapshot
    if (this.isExactAnchor(anchor)) {
      const exactAnchor = anchor as ExactCodeAnchor;

      if (!snapshot) {
        return {
          status: 'SNAPSHOT_NOT_FOUND',
          valid: false,
          error: 'SNAPSHOT_NOT_FOUND',
          diagnostics: { reason: 'ExactCodeAnchor requires a valid SourceSnapshot' },
        };
      }

      // Check repository identity
      if (snapshot.repositoryId !== exactAnchor.repositoryId) {
        return {
          status: 'ANCHOR_INVALID',
          valid: false,
          error: 'REPOSITORY_MISMATCH',
          anchorId: exactAnchor.id,
          diagnostics: {
            reason: `Snapshot repositoryId (${snapshot.repositoryId}) does not match anchor repositoryId (${exactAnchor.repositoryId})`,
          },
        };
      }

      // Check commit SHA identity
      if (snapshot.commitSha.toLowerCase() !== exactAnchor.commitSha.toLowerCase()) {
        return {
          status: 'ANCHOR_INVALID',
          valid: false,
          error: 'COMMIT_MISMATCH',
          anchorId: exactAnchor.id,
          diagnostics: {
            reason: `Snapshot commitSha (${snapshot.commitSha}) does not match anchor commitSha (${exactAnchor.commitSha})`,
          },
        };
      }

      // Check file path with strict canonical validation
      let expectedPath: string;
      let actualPath: string;
      try {
        expectedPath = normalizeFilePath(exactAnchor.filePath || exactAnchor.path || '');
        actualPath = normalizeFilePath(snapshot.filePath);
      } catch (err: any) {
        return {
          status: 'ANCHOR_INVALID',
          valid: false,
          error: 'INVALID_FILE_PATH',
          anchorId: exactAnchor.id,
          diagnostics: {
            reason: `File path validation failed: ${err.message}`,
          },
        };
      }

      if (expectedPath !== actualPath) {
        return {
          status: 'FILE_NOT_FOUND',
          valid: false,
          error: 'FILE_NOT_FOUND',
          anchorId: exactAnchor.id,
          diagnostics: {
            reason: `Anchor file path '${expectedPath}' does not match snapshot file path '${actualPath}'`,
          },
        };
      }

      // Check Git blob identity if present in both
      if (exactAnchor.blobSha && snapshot.blobSha) {
        if (exactAnchor.blobSha.toLowerCase() !== snapshot.blobSha.toLowerCase()) {
          return {
            status: 'ANCHOR_INVALID',
            valid: false,
            error: 'BLOB_SHA_MISMATCH',
            anchorId: exactAnchor.id,
            diagnostics: {
              reason: `Anchor blobSha (${exactAnchor.blobSha}) does not match snapshot blobSha (${snapshot.blobSha})`,
            },
          };
        }
      }

      // Check tenant identity if present in both
      if (exactAnchor.orgId && snapshot.orgId && exactAnchor.orgId !== snapshot.orgId) {
        return {
          status: 'ANCHOR_INVALID',
          valid: false,
          error: 'CROSS_TENANT_ACCESS_REJECTED',
          anchorId: exactAnchor.id,
          diagnostics: {
            reason: `Snapshot orgId (${snapshot.orgId}) does not match anchor orgId (${exactAnchor.orgId})`,
          },
        };
      }

      // Check student ownership identity for student evidence
      if (exactAnchor.studentId) {
        if (!snapshot.studentId) {
          return {
            status: 'ANCHOR_INVALID',
            valid: false,
            error: 'STUDENT_OWNERSHIP_REQUIRED',
            anchorId: exactAnchor.id,
            diagnostics: {
              reason: 'Student-owned evidence anchor requires a snapshot with matching student ownership',
            },
          };
        }
        if (exactAnchor.studentId !== snapshot.studentId) {
          return {
            status: 'ANCHOR_INVALID',
            valid: false,
            error: 'STUDENT_OWNERSHIP_MISMATCH',
            anchorId: exactAnchor.id,
            diagnostics: {
              reason: `Snapshot studentId (${snapshot.studentId}) does not match anchor studentId (${exactAnchor.studentId})`,
            },
          };
        }
      }

      // 3. Parser version verification
      if (!options.skipParserVersionCheck && exactAnchor.parserName) {
        const registry = options.registry || ParserRegistry.getInstance();
        const parser = registry.getParserByName(exactAnchor.parserName, exactAnchor.parserVersion);
        if (!parser) {
          return {
            status: 'PARSER_VERSION_UNAVAILABLE',
            valid: false,
            error: 'PARSER_VERSION_UNAVAILABLE',
            anchorId: exactAnchor.id,
            diagnostics: {
              reason: `Parser '${exactAnchor.parserName}' version '${exactAnchor.parserVersion}' is not available in registry`,
            },
          };
        }
      }
    }

    // 4. Resolve raw file bytes and verify raw file hash
    const rawBytes = isSnapshot
      ? snapshot!.rawBytes instanceof Uint8Array
        ? Buffer.from(snapshot!.rawBytes)
        : Buffer.from(snapshot!.rawBytes, 'utf8')
      : typeof sourceOrSnapshot === 'string'
      ? Buffer.from(sourceOrSnapshot, 'utf8')
      : Buffer.from(sourceOrSnapshot as Buffer | Uint8Array);

    if (rawBytes.length === 0) {
      return {
        status: 'FILE_NOT_FOUND',
        valid: false,
        error: 'FILE_NOT_FOUND',
        diagnostics: { reason: 'Source file is empty (0 bytes)' },
      };
    }

    // Validate UTF-8 encoding of source bytes
    let fileText: string;
    try {
      const decoder = new TextDecoder('utf-8', { fatal: true });
      fileText = decoder.decode(rawBytes);
    } catch {
      return {
        status: 'ANCHOR_INVALID',
        valid: false,
        error: 'MALFORMED_UTF8_SOURCE',
        diagnostics: { reason: 'Source bytes are malformed UTF-8' },
      };
    }

    const computedFileHash = this.hashRawBytes(rawBytes);

    // If snapshot specifies rawFileHash, verify snapshot integrity
    if (snapshot && snapshot.rawFileHash && computedFileHash !== snapshot.rawFileHash) {
      return {
        status: 'ANCHOR_INVALID',
        valid: false,
        error: 'RAW_FILE_HASH_MISMATCH',
        computedFileHash,
        diagnostics: {
          reason: `Snapshot rawFileHash (${snapshot.rawFileHash}) does not match computed bytes (${computedFileHash})`,
        },
      };
    }

    // If anchor specifies rawFileHash, verify raw file integrity
    if ('rawFileHash' in anchor && anchor.rawFileHash && computedFileHash !== anchor.rawFileHash) {
      return {
        status: 'ANCHOR_INVALID',
        valid: false,
        error: 'RAW_FILE_HASH_MISMATCH',
        computedFileHash,
        anchorId: (anchor as ExactCodeAnchor).id,
        diagnostics: {
          reason: `Anchor expected raw file hash ${anchor.rawFileHash} but snapshot raw file hash is ${computedFileHash}`,
        },
      };
    }

    // 5. Extract code span
    const { lineStart, lineEnd } = anchor;
    let extractedSpan: string;
    const exactAnchor = this.isExactAnchor(anchor) ? (anchor as ExactCodeAnchor) : undefined;

    // Detect if file uses CRLF or LF and split lines
    const hasCRLF = fileText.includes('\r\n');
    const lines = fileText.split(/\r?\n/);

    // Validate line boundary constraints against total lines
    if (
      lineStart < 1 ||
      lineEnd < lineStart ||
      lineStart > lines.length ||
      lineEnd > lines.length
    ) {
      return {
        status: 'ANCHOR_INVALID',
        valid: false,
        error: 'OUT_OF_BOUNDS',
        anchorId: exactAnchor?.id,
        computedFileHash,
        diagnostics: {
          reason: `Line bounds [${lineStart}, ${lineEnd}] are out of range for total lines ${lines.length}`,
        },
      };
    }

    // Check byte offset presence: Incomplete byte offsets must be rejected
    const hasByteStart = exactAnchor?.byteStart !== undefined;
    const hasByteEnd = exactAnchor?.byteEnd !== undefined;

    if (hasByteStart !== hasByteEnd) {
      return {
        status: 'ANCHOR_INVALID',
        valid: false,
        error: 'INCOMPLETE_BYTE_OFFSETS',
        anchorId: exactAnchor?.id,
        computedFileHash,
        diagnostics: {
          reason: 'Both byteStart and byteEnd must be provided when byte offsets are specified',
        },
      };
    }

    // Prefer byte offsets if provided by AST parser
    if (hasByteStart && hasByteEnd && exactAnchor) {
      const bStart = exactAnchor.byteStart!;
      const bEnd = exactAnchor.byteEnd!;

      if (bStart < 0 || bEnd < bStart || bEnd > rawBytes.length) {
        return {
          status: 'ANCHOR_INVALID',
          valid: false,
          error: 'OUT_OF_BOUNDS',
          anchorId: exactAnchor.id,
          computedFileHash,
          diagnostics: {
            reason: `Byte offset bounds [${bStart}, ${bEnd}] are out of range for file length ${rawBytes.length}`,
          },
        };
      }

      // Validate UTF-8 boundary integrity: Byte offsets must not split multi-byte characters
      if (bStart < rawBytes.length && (rawBytes[bStart] & 0xc0) === 0x80) {
        return {
          status: 'ANCHOR_INVALID',
          valid: false,
          error: 'INVALID_UTF8_BYTE_BOUNDARY',
          anchorId: exactAnchor.id,
          computedFileHash,
          diagnostics: {
            reason: `byteStart (${bStart}) splits a multi-byte UTF-8 sequence (continuation byte)`,
          },
        };
      }

      if (bEnd < rawBytes.length && (rawBytes[bEnd] & 0xc0) === 0x80) {
        return {
          status: 'ANCHOR_INVALID',
          valid: false,
          error: 'INVALID_UTF8_BYTE_BOUNDARY',
          anchorId: exactAnchor.id,
          computedFileHash,
          diagnostics: {
            reason: `byteEnd (${bEnd}) splits a multi-byte UTF-8 sequence (continuation byte)`,
          },
        };
      }

      // Verify that line boundaries and byte offsets are consistent
      const precedingText = rawBytes.subarray(0, bStart).toString('utf8');
      const computedLineStart = precedingText.split(/\r?\n/).length;
      extractedSpan = rawBytes.subarray(bStart, bEnd).toString('utf8');
      const spanLineCount = extractedSpan.split(/\r?\n/).length;
      const computedLineEnd = computedLineStart + spanLineCount - 1;

      if (lineStart !== computedLineStart || lineEnd !== computedLineEnd) {
        return {
          status: 'ANCHOR_INVALID',
          valid: false,
          error: 'LINE_BYTE_METADATA_INCONSISTENT',
          anchorId: exactAnchor.id,
          computedFileHash,
          diagnostics: {
            reason: `Supplied lines [${lineStart}, ${lineEnd}] do not match byte offset lines [${computedLineStart}, ${computedLineEnd}]`,
          },
        };
      }
    } else {
      // Line-based extraction
      const spanLines = lines.slice(lineStart - 1, lineEnd);
      // Join preserving newline convention
      extractedSpan = spanLines.join(hasCRLF ? '\r\n' : '\n');
    }

    // 6. Verify stored source span hash
    const computedRawHash = this.hashRawBytes(extractedSpan);
    
    // Pure line-ending normalization (CRLF -> LF without trimming whitespace)
    const lfSpan = extractedSpan.replace(/\r\n/g, '\n');
    const computedLfHash = createHash('sha256').update(Buffer.from(lfSpan, 'utf8')).digest('hex');

    // Whitespace-trimmed normalization
    const wsSpan = lfSpan.trim();
    const computedWsHash = createHash('sha256').update(Buffer.from(wsSpan, 'utf8')).digest('hex');

    // Is anchor hash matched by raw hash?
    let isHashMatch = computedRawHash === anchor.contentHash;

    // For legacy M0 anchors, hashContent was normalized hash
    if (!isHashMatch && !this.isExactAnchor(anchor)) {
      if (computedLfHash === anchor.contentHash || computedWsHash === anchor.contentHash) {
        isHashMatch = true;
      }
    }

    if (!isHashMatch) {
      // Diagnostic check: check if it matches pure line ending normalization
      const isLineEndingMismatch = Boolean(
        computedLfHash === anchor.contentHash ||
        (exactAnchor?.normalizedContentHash && computedLfHash === exactAnchor.normalizedContentHash)
      );

      // Separate diagnostic check: whitespace alterations
      const isWhitespaceMismatch = !isLineEndingMismatch && Boolean(
        computedWsHash === anchor.contentHash ||
        (exactAnchor?.normalizedContentHash && computedWsHash === exactAnchor.normalizedContentHash)
      );

      return {
        status: 'ANCHOR_INVALID',
        valid: false,
        codeSpan: extractedSpan,
        computedHash: computedRawHash,
        computedFileHash,
        error: 'HASH_MISMATCH',
        anchorId: exactAnchor?.id,
        diagnostics: {
          lineEndingMismatch: isLineEndingMismatch,
          whitespaceMismatch: isWhitespaceMismatch,
          reason: isLineEndingMismatch
            ? 'Source content matches normalized text but failed raw byte integrity check (line-ending difference)'
            : isWhitespaceMismatch
            ? 'Source content matches trimmed text but failed raw byte integrity check (whitespace difference)'
            : 'Extracted code span hash does not match anchor contentHash',
        },
      };
    }

    return {
      status: 'RESOLVED',
      valid: true,
      codeSpan: extractedSpan,
      computedHash: computedRawHash,
      computedFileHash,
      anchorId: exactAnchor?.id,
    };
  }

  /**
   * Resolves an anchor from a registered ISourceSnapshotStore.
   */
  public static async resolveFromStore(
    store: ISourceSnapshotStore,
    anchor: ExactCodeAnchor,
    options: ResolverOptions = {}
  ): Promise<ResolvedAnchorResult> {
    const snapshot = await store.getSnapshot(
      anchor.repositoryId,
      anchor.commitSha,
      anchor.filePath,
      anchor.orgId,
      anchor.studentId
    );
    if (!snapshot) {
      return {
        status: 'SNAPSHOT_NOT_FOUND',
        valid: false,
        error: 'SNAPSHOT_NOT_FOUND',
        anchorId: anchor.id,
        diagnostics: {
          reason: `No snapshot found for repository '${anchor.repositoryId}', commit '${anchor.commitSha}', file '${anchor.filePath}'`,
        },
      };
    }
    return this.resolve(snapshot, anchor, options);
  }

  private static isSourceSnapshot(obj: unknown): boolean {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      'snapshotId' in obj &&
      'repositoryId' in obj &&
      'commitSha' in obj &&
      'rawBytes' in obj
    );
  }

  private static isExactAnchor(obj: unknown): boolean {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      'id' in obj &&
      'orgId' in obj &&
      'repositoryId' in obj &&
      'rawFileHash' in obj
    );
  }
}
