import crypto from 'crypto';

export interface TokenCipherOptions {
  encryptionKey?: string;
  keyVersion?: string;
  isProduction?: boolean;
}

export interface EncryptedPayload {
  version: string;
  iv: string; // hex
  tag: string; // hex
  data: string; // hex
  serialized: string;
}

export interface ITokenCipher {
  encrypt(plaintext: string): EncryptedPayload;
  decrypt(serializedOrPayload: string | EncryptedPayload): string;
  getKeyVersion(): string;
}

export class AesGcmTokenCipher implements ITokenCipher {
  private key: Buffer;
  private keyVersion: string;

  constructor(opts: TokenCipherOptions = {}) {
    const rawKey = opts.encryptionKey ?? process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
    const isProd = opts.isProduction ?? process.env.NODE_ENV === 'production';
    this.keyVersion = opts.keyVersion ?? 'v1';

    if (!rawKey) {
      if (isProd) {
        throw new Error(
          'FATAL: GITHUB_TOKEN_ENCRYPTION_KEY is required in production environment for token encryption.'
        );
      }
      // Deterministic fallback for non-production development / unit tests
      this.key = crypto.createHash('sha256').update('pramaan-dev-default-encryption-key-32b!').digest();
    } else if (rawKey.length === 64 && /^[0-9a-fA-F]+$/.test(rawKey)) {
      this.key = Buffer.from(rawKey, 'hex');
    } else {
      // If arbitrary string is supplied, derive 256-bit key using SHA-256
      this.key = crypto.createHash('sha256').update(rawKey, 'utf8').digest();
    }
  }

  public getKeyVersion(): string {
    return this.keyVersion;
  }

  public encrypt(plaintext: string): EncryptedPayload {
    if (typeof plaintext !== 'string' || plaintext.length === 0) {
      throw new Error('INVALID_PLAINTEXT: Token to encrypt cannot be empty');
    }

    // 12-byte initialization vector recommended for AES-GCM
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);

    const encrypted = Buffer.concat([
      cipher.update(Buffer.from(plaintext, 'utf8')),
      cipher.final(),
    ]);

    const tag = cipher.getAuthTag();

    const ivHex = iv.toString('hex');
    const tagHex = tag.toString('hex');
    const dataHex = encrypted.toString('hex');
    const serialized = `${this.keyVersion}:${ivHex}:${tagHex}:${dataHex}`;

    return {
      version: this.keyVersion,
      iv: ivHex,
      tag: tagHex,
      data: dataHex,
      serialized,
    };
  }

  public decrypt(serializedOrPayload: string | EncryptedPayload): string {
    let version: string;
    let ivHex: string;
    let tagHex: string;
    let dataHex: string;

    if (typeof serializedOrPayload === 'string') {
      const parts = serializedOrPayload.split(':');
      if (parts.length !== 4) {
        throw new Error('MALFORMED_ENCRYPTED_PAYLOAD: Expected version:iv:tag:data');
      }
      [version, ivHex, tagHex, dataHex] = parts;
    } else {
      version = serializedOrPayload.version;
      ivHex = serializedOrPayload.iv;
      tagHex = serializedOrPayload.tag;
      dataHex = serializedOrPayload.data;
    }

    if (version !== this.keyVersion) {
      throw new Error(`UNSUPPORTED_KEY_VERSION: Cannot decrypt payload with key version '${version}'`);
    }

    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const encrypted = Buffer.from(dataHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);

    try {
      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);
      return decrypted.toString('utf8');
    } catch (err: any) {
      throw new Error(`AUTHENTICATED_DECRYPTION_FAILED: Token tampering detected or invalid key: ${err.message}`, {
        cause: err,
      });
    }
  }
}
