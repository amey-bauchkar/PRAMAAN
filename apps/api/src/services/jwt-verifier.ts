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

    // Resolve issuer
    this.issuer = resolvedConfig.issuer;
    if (!this.issuer) {
      if (process.env.SUPABASE_URL) {
        this.issuer = `${process.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`;
      }
    }

    // In production, never skip issuer validation
    if (isProduction && !this.issuer) {
      throw new Error(
        'FATAL: Production JWT verification requires an explicit issuer (SUPABASE_URL or config.issuer). Never skip issuer validation in production.'
      );
    }

    if (jwksUri) {
      this.isAsymmetric = true;
      this.keyOrJwks = createRemoteJWKSet(new URL(jwksUri));
      this.allowedAlgorithms = resolvedConfig.allowedAlgorithms || ['ES256', 'RS256'];
    } else if (jwtSecret) {
      this.isAsymmetric = false;
      this.keyOrJwks = new TextEncoder().encode(jwtSecret);
      this.allowedAlgorithms = resolvedConfig.allowedAlgorithms || ['HS256'];
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
   * Enforces algorithm restrictions, signature validation, expiry (exp), issued-at (iat),
   * not-before (nbf), audience ('authenticated'), issuer (if configured/production),
   * mandatory 'sub' subject claim, and rejects service_role/anon tokens.
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

      // 1. Mandatory sub claim
      if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.trim() === '') {
        return { valid: false, error: 'Missing or empty subject claim (sub) in token payload.' };
      }

      // 2. Mandatory exp claim
      if (typeof payload.exp !== 'number') {
        return { valid: false, error: 'Missing or invalid expiration claim (exp) in token payload.' };
      }

      // 3. Mandatory iat claim
      if (typeof payload.iat !== 'number') {
        return { valid: false, error: 'Missing or invalid issued-at claim (iat) in token payload.' };
      }
      const nowSec = Math.floor(Date.now() / 1000);
      if (payload.iat > nowSec + 60) {
        return { valid: false, error: 'Token issued-at claim (iat) is in the future.' };
      }

      // 4. Mandatory aud claim
      if (!payload.aud) {
        return { valid: false, error: 'Missing audience claim (aud) in token payload.' };
      }

      // 5. Mandatory iss claim when issuer is configured
      if (this.issuer && !payload.iss) {
        return { valid: false, error: 'Missing issuer claim (iss) in token payload.' };
      }

      // 6. Role check: Reject service_role or anonymous tokens from user-facing authentication
      const tokenRole = (payload as any).role;
      if (tokenRole && tokenRole !== 'authenticated') {
        return {
          valid: false,
          error: `FORBIDDEN_TOKEN_ROLE: Token role '${tokenRole}' is not permitted for user authentication (service-role and anonymous tokens are rejected).`
        };
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
