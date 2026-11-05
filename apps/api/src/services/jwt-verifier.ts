import { jwtVerify, SignJWT, JWTPayload } from 'jose';

export interface VerifiedTokenPayload extends JWTPayload {
  sub: string;
  email?: string;
  role?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
}

export interface JwtVerifyResult {
  valid: boolean;
  payload?: VerifiedTokenPayload;
  error?: string;
}

export class JwtVerifier {
  private secretKey: Uint8Array;

  constructor(secret?: string) {
    const rawSecret = secret || process.env.SUPABASE_JWT_SECRET || 'pramaan-default-dev-secret-32-chars-minimum!';
    this.secretKey = new TextEncoder().encode(rawSecret);
  }

  /**
   * Cryptographically verifies a Supabase access token (HS256).
   * Validates signature, expiry (exp), not-before (nbf), and checks that 'sub' exists.
   */
  public async verifyToken(token: string): Promise<JwtVerifyResult> {
    if (!token || typeof token !== 'string') {
      return { valid: false, error: 'Token is missing or not a string.' };
    }

    const segments = token.split('.');
    if (segments.length !== 3) {
      return { valid: false, error: 'Malformed JWT: token must contain 3 segments.' };
    }

    try {
      const { payload } = await jwtVerify(token, this.secretKey, {
        algorithms: ['HS256']
      });

      if (!payload.sub) {
        return { valid: false, error: 'Missing subject claim (sub) in token payload.' };
      }

      return {
        valid: true,
        payload: payload as VerifiedTokenPayload
      };
    } catch (err: any) {
      if (err.code === 'ERR_JWT_EXPIRED') {
        return { valid: false, error: 'Token has expired.' };
      }
      if (err.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
        return { valid: false, error: 'Signature verification failed: forged or modified token.' };
      }
      return { valid: false, error: err.message || 'JWT verification failed.' };
    }
  }

  /**
   * Helper to generate cryptographically signed test tokens for integration and unit testing.
   */
  public async createTestToken(
    claims: { sub: string; email?: string; [key: string]: unknown },
    options: { expiresIn?: string | number; customSecret?: string } = {}
  ): Promise<string> {
    const key = options.customSecret 
      ? new TextEncoder().encode(options.customSecret) 
      : this.secretKey;

    const jwtBuilder = new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt();

    if (options.expiresIn !== undefined) {
      jwtBuilder.setExpirationTime(options.expiresIn);
    } else {
      jwtBuilder.setExpirationTime('2h');
    }

    return await jwtBuilder.sign(key);
  }
}
