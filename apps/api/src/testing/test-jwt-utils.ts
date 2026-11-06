import { SignJWT } from 'jose';

export const TEST_JWT_SECRET = 'pramaan-test-secret-at-least-32-chars-long-for-testing!';

export interface CreateTestTokenOptions {
  expiresIn?: string | number;
  customSecret?: string;
  alg?: string;
  issuer?: string | null;
  audience?: string | null;
}

/**
 * Test utility for generating cryptographically signed tokens for testing.
 * NOT part of production verifier code.
 */
export async function createTestToken(
  claims: { sub: string; email?: string; [key: string]: unknown },
  options: CreateTestTokenOptions = {}
): Promise<string> {
  const secret = options.customSecret || TEST_JWT_SECRET;
  const key = new TextEncoder().encode(secret);
  const alg = options.alg || 'HS256';

  const defaultIssuer = process.env.SUPABASE_URL
    ? `${process.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`
    : undefined;
  const issuer = options.issuer === null ? undefined : (options.issuer ?? defaultIssuer);

  const payload: Record<string, unknown> = {
    role: (claims as any).role !== undefined ? (claims as any).role : 'authenticated',
    ...claims
  };

  if (options.audience !== null) {
    payload.aud = options.audience !== undefined ? options.audience : 'authenticated';
  }

  const jwtBuilder = new SignJWT(payload)
    .setProtectedHeader({ alg, typ: 'JWT' })
    .setIssuedAt();

  if (issuer) {
    jwtBuilder.setIssuer(issuer);
  }

  if (options.expiresIn !== undefined) {
    jwtBuilder.setExpirationTime(options.expiresIn);
  } else {
    jwtBuilder.setExpirationTime('2h');
  }

  return await jwtBuilder.sign(key);
}
