import { SignJWT } from 'jose';

export const TEST_JWT_SECRET = 'pramaan-test-secret-at-least-32-chars-long-for-testing!';

export interface CreateTestTokenOptions {
  expiresIn?: string | number;
  customSecret?: string;
  alg?: string;
  issuer?: string;
  audience?: string;
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

  const jwtBuilder = new SignJWT({
    aud: options.audience !== undefined ? options.audience : 'authenticated',
    ...claims
  })
    .setProtectedHeader({ alg, typ: 'JWT' })
    .setIssuedAt();

  if (options.issuer) {
    jwtBuilder.setIssuer(options.issuer);
  }

  if (options.expiresIn !== undefined) {
    jwtBuilder.setExpirationTime(options.expiresIn);
  } else {
    jwtBuilder.setExpirationTime('2h');
  }

  return await jwtBuilder.sign(key);
}
