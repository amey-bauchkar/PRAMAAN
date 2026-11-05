import { jwtVerify, createRemoteJWKSet, JWTPayload, JWTVerifyGetKey } from 'jose';

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

export interface JwtVerifierConfig {
  jwksUri?: string;
  jwtSecret?: string;
  issuer?: string;
  audience?: string;
  allowedAlgorithms?: string[];
}

export class JwtVerifier {
  private keyOrJwks: Uint8Array | JWTVerifyGetKey;
  private isAsymmetric: boolean;
  private issuer?: string;
  private audience: string;
  private allowedAlgorithms: string[];

  constructor(config?: JwtVerifierConfig | string) {
    const isProduction = process.env.NODE_ENV === 'production';

    // Normalize config
    let resolvedConfig: JwtVerifierConfig = {};
    if (typeof config === 'string') {
      resolvedConfig = { jwtSecret: config };
    } else if (config) {
      resolvedConfig = { ...config };
    }

    let jwksUri: string | undefined;
    let jwtSecret: string | undefined;

    if (resolvedConfig.jwtSecret) {
      // Explicit symmetric secret provided
      jwtSecret = resolvedConfig.jwtSecret;
    } else if (resolvedConfig.jwksUri) {
      // Explicit JWKS URI provided
      jwksUri = resolvedConfig.jwksUri;
    } else {
      // Environment-based discovery
      if (process.env.SUPABASE_JWKS_URI) {
        jwksUri = process.env.SUPABASE_JWKS_URI;
      } else if (process.env.SUPABASE_URL) {
        const baseUrl = process.env.SUPABASE_URL.replace(/\/$/, '');
        jwksUri = `${baseUrl}/auth/v1/.well-known/jwks.json`;
      } else if (process.env.SUPABASE_JWT_SECRET) {
        jwtSecret = process.env.SUPABASE_JWT_SECRET;
      }
    }

    this.audience = resolvedConfig.audience || 'authenticated';

    if (jwksUri) {
      this.isAsymmetric = true;
      this.keyOrJwks = createRemoteJWKSet(new URL(jwksUri));
      this.allowedAlgorithms = resolvedConfig.allowedAlgorithms || ['ES256', 'RS256'];
      this.issuer = resolvedConfig.issuer || (process.env.SUPABASE_URL ? `${process.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1` : undefined);
    } else if (jwtSecret) {
      this.isAsymmetric = false;
      this.keyOrJwks = new TextEncoder().encode(jwtSecret);
      this.allowedAlgorithms = resolvedConfig.allowedAlgorithms || ['HS256'];
      this.issuer = resolvedConfig.issuer; // Only validate issuer for symmetric if explicitly requested
    } else {
      if (isProduction) {
        throw new Error(
          'FATAL: Production JWT verification configuration missing. ' +
          'Either SUPABASE_URL / SUPABASE_JWKS_URI (for asymmetric JWKS) or SUPABASE_JWT_SECRET (for symmetric HS256) must be configured.'
        );
      }
      throw new Error(
        'JWT verification configuration missing: provide jwksUri, jwtSecret, or set SUPABASE_URL / SUPABASE_JWT_SECRET in environment.'
      );
    }
  }

  /**
   * Cryptographically verifies a Supabase access token.
   * Enforces algorithm restrictions, signature validation, expiry (exp), not-before (nbf),
   * audience (default 'authenticated'), issuer (if configured), and mandatory 'sub' subject claim.
   */
  public async verifyToken(token: string): Promise<JwtVerifyResult> {
    if (!token || typeof token !== 'string') {
      return { valid: false, error: 'Token is missing or not a string.' };
    }

    const segments = token.split('.');
    if (segments.length !== 3) {
      return { valid: false, error: 'Malformed JWT: token must contain exactly 3 segments.' };
    }

    try {
      const verifyOptions: {
        algorithms: string[];
        audience?: string;
        issuer?: string;
      } = {
        algorithms: this.allowedAlgorithms
      };

      if (this.audience) {
        verifyOptions.audience = this.audience;
      }
      if (this.issuer) {
        verifyOptions.issuer = this.issuer;
      }

      let payload: JWTPayload;
      if (this.isAsymmetric) {
        const verifyRes = await jwtVerify(token, this.keyOrJwks as JWTVerifyGetKey, verifyOptions);
        payload = verifyRes.payload;
      } else {
        const verifyRes = await jwtVerify(token, this.keyOrJwks as Uint8Array, verifyOptions);
        payload = verifyRes.payload;
      }

      if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.trim() === '') {
        return { valid: false, error: 'Missing or empty subject claim (sub) in token payload.' };
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
      if (err.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
        return { valid: false, error: `Claim validation failed: ${err.message}` };
      }
      if (err.code === 'ERR_JWS_INVALID') {
        return { valid: false, error: 'Invalid JWT structure or unsupported algorithm.' };
      }
      return { valid: false, error: err.message || 'JWT verification failed.' };
    }
  }
}
