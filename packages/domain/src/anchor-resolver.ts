import { createHash } from 'crypto';
import { CodeAnchor } from '@pramaan/contracts';

export interface ResolvedAnchorResult {
  valid: boolean;
  codeSpan?: string;
  computedHash?: string;
  error?: 'ANCHOR_INVALID' | 'OUT_OF_BOUNDS' | 'FILE_NOT_FOUND' | 'HASH_MISMATCH';
}

export class AnchorResolver {
  /**
   * Computes SHA-256 hash of a string with normalized line endings.
   */
  public static hashContent(content: string): string {
    const normalized = content.replace(/\r\n/g, '\n').trim();
    return createHash('sha256').update(normalized, 'utf8').digest('hex');
  }

  /**
   * Resolves a code span given the raw file content and the anchor definition.
   */
  public static resolve(fileContent: string, anchor: CodeAnchor): ResolvedAnchorResult {
    if (!fileContent) {
      return { valid: false, error: 'FILE_NOT_FOUND' };
    }

    const lines = fileContent.replace(/\r\n/g, '\n').split('\n');
    const { lineStart, lineEnd, contentHash } = anchor;

    // Line numbers are 1-indexed
    if (lineStart < 1 || lineEnd < lineStart || lineStart > lines.length) {
      return { valid: false, error: 'OUT_OF_BOUNDS' };
    }

    // Extract requested lines
    const spanLines = lines.slice(lineStart - 1, lineEnd);
    const codeSpan = spanLines.join('\n');
    const computedHash = this.hashContent(codeSpan);

    if (computedHash !== anchor.contentHash) {
      return {
        valid: false,
        codeSpan,
        computedHash,
        error: 'HASH_MISMATCH'
      };
    }

    return {
      valid: true,
      codeSpan,
      computedHash
    };
  }
}

