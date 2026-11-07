import crypto from 'crypto';

export interface TokenCipherOptions {
  encryptionKey?: string;
  keyRing?: Record<string, string | Buffer>;
  keyVersion?: string;
  activeKeyVersion?: string;
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
  getActiveKeyVersion(): string;
  hasKeyVersion(version: string): boolean;
}

export class AesGcmTokenCipher implements ITokenCipher {
  private keyRing = new Map<string, Buffer>();
  private activeKeyVersion: string;

  constructor(opts: TokenCipherOptions = {}) {
    const isProd = opts.isProduction ?? process.env.NODE_ENV === 'production';
    this.activeKeyVersion = opts.activeKeyVersion ?? opts.keyVersion ?? process.env.GITHUB_TOKEN_ACTIVE_KEY_VERSION ?? 'v1';

    // 1. Ingest from explicit keyRing map if provided
    if (opts.keyRing && Object.keys(opts.keyRing).length > 0) {
      for (const [ver, keyVal] of Object.entries(opts.keyRing)) {
        this.addKeyToRing(ver, keyVal, isProd);
      }
    }

    // 2. Ingest from serialized keyring env or options e.g. "v1:hex1,v2:hex2"
    const keyringStr = process.env.GITHUB_TOKEN_KEYRING;
    if (keyringStr && keyringStr.includes(':')) {
      for (const pair of keyringStr.split(',')) {
        const [ver, hex] = pair.trim().split(':');
        if (ver && hex) {
          this.addKeyToRing(ver.trim(), hex.trim(), isProd);
        }
      }
    }

    // 3. Ingest single key from opts.encryptionKey or GITHUB_TOKEN_ENCRYPTION_KEY if not already in ring
    const singleRawKey = opts.encryptionKey ?? process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
    if (singleRawKey) {
      if (singleRawKey.includes(',') || (singleRawKey.includes(':') && singleRawKey.length > 64)) {
        // Multi-key serialized format
        for (const pair of singleRawKey.split(',')) {
          const [ver, hex] = pair.trim().split(':');
          if (ver && hex) {
            this.addKeyToRing(ver.trim(), hex.trim(), isProd);
          }
        }
      } else {
        // Single key mapped to activeKeyVersion
        this.addKeyToRing(this.activeKeyVersion, singleRawKey, isProd);
      }
    }

    // 4. Validate production requirements
    if (isProd) {
      if (this.keyRing.size === 0) {
        throw new Error(
          'FATAL: GITHUB_TOKEN_ENCRYPTION_KEY is required in production environment for token encryption.'
        );
      }
      if (!this.keyRing.has(this.activeKeyVersion)) {
        throw new Error(
          `FATAL: Active encryption key version '${this.activeKeyVersion}' is not configured in production key ring.`
        );
      }
    } else {
      // Non-production fallback if no keys configured
      if (this.keyRing.size === 0) {
        const defaultDevKey = crypto.createHash('sha256').update('pramaan-dev-default-encryption-key-32b!').digest();
        this.keyRing.set('v1', defaultDevKey);
        if (!this.keyRing.has(this.activeKeyVersion)) {
          this.keyRing.set(this.activeKeyVersion, defaultDevKey);
        }
      }
    }

    if (!this.keyRing.has(this.activeKeyVersion)) {
      throw new Error(
        `ACTIVE_KEY_VERSION_MISSING: Active key version '${this.activeKeyVersion}' is not present in key ring.`
      );
    }
  }

  private addKeyToRing(version: string, keyInput: string | Buffer, isProd: boolean): void {
    if (!version || typeof version !== 'string') {
      throw new Error('INVALID_KEY_VERSION: Key version must be a non-empty string.');
    }

    if (Buffer.isBuffer(keyInput)) {
      if (keyInput.length !== 32) {
        throw new Error(`INVALID_KEY_LENGTH: Key buffer for version '${version}' must be exactly 32 bytes (received ${keyInput.length}).`);
      }
      this.keyRing.set(version, keyInput);
      return;
    }

    if (typeof keyInput !== 'string') {
      throw new Error(`INVALID_KEY_TYPE: Key for version '${version}' must be a string or Buffer.`);
    }

    const trimmed = keyInput.trim();
    if (trimmed.length === 64 && /^[0-9a-fA-F]{64}$/.test(trimmed)) {
      this.keyRing.set(version, Buffer.from(trimmed, 'hex'));
      return;
    }

    if (isProd) {
      throw new Error(
        `FATAL: GITHUB_TOKEN_ENCRYPTION_KEY for version '${version}' must be a 64-character hexadecimal string in production.`
      );
    } else {
      // In non-production, disallow invalid hex if length looks like an intended hex key
      if (trimmed.length === 64) {
        throw new Error(`INVALID_KEY_HEX: Key for version '${version}' contains non-hex characters.`);
      }
      throw new Error(`INVALID_KEY_LENGTH: Key for version '${version}' must be a 64-character hex string (received ${trimmed.length} chars).`);
    }
  }

  public getKeyVersion(): string {
    return this.activeKeyVersion;
  }

  public getActiveKeyVersion(): string {
    return this.activeKeyVersion;
  }

  public hasKeyVersion(version: string): boolean {
    return this.keyRing.has(version);
  }

  public encrypt(plaintext: string): EncryptedPayload {
    if (typeof plaintext !== 'string' || plaintext.length === 0) {
      throw new Error('INVALID_PLAINTEXT: Token to encrypt cannot be empty');
    }

    const activeKey = this.keyRing.get(this.activeKeyVersion);
    if (!activeKey) {
      throw new Error(`ACTIVE_KEY_NOT_FOUND: Key for active version '${this.activeKeyVersion}' not found in key ring.`);
    }

    // 12-byte initialization vector recommended for AES-GCM
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', activeKey, iv);

    const encrypted = Buffer.concat([
      cipher.update(Buffer.from(plaintext, 'utf8')),
      cipher.final(),
    ]);

    const tag = cipher.getAuthTag();

    const ivHex = iv.toString('hex');
    const tagHex = tag.toString('hex');
    const dataHex = encrypted.toString('hex');
    const serialized = `${this.activeKeyVersion}:${ivHex}:${tagHex}:${dataHex}`;

    return {
      version: this.activeKeyVersion,
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

    const key = this.keyRing.get(version);
    if (!key) {
      throw new Error(`UNKNOWN_KEY_VERSION: Encryption key version '${version}' is not in the configured key ring.`);
    }

    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const encrypted = Buffer.from(dataHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
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
