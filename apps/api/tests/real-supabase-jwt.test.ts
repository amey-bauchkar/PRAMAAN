import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { JwtVerifier } from '../src/services/jwt-verifier.js';
import { AuthService } from '../src/services/auth-service.js';
import { PgUserRepository } from '../src/repositories/user-repository.js';
import { getDbPool } from '../src/db/pool.js';
import { runQuery } from '../../../scripts/supabase-runner.mjs';
import { createTestToken } from '../src/testing/test-jwt-utils.js';
import crypto from 'crypto';
import pg from 'pg';

describe('Real Supabase JWT Authentication & JWKS Verification (P0-1, P0-2, P0-4, P1-5)', () => {
  let supabase: SupabaseClient;
  let adminSupabase: SupabaseClient;
  let pool: pg.Pool;
  let pgUserRepo: PgUserRepository;
  let authService: AuthService;
  let jwtVerifier: JwtVerifier;

  let genuineAccessToken: string;
  let genuineAuthSubject: string;
  let ephemeralUserId: string;

  const TEST_COLLEGE_ID = crypto.randomUUID();
  const TEST_USER_ID = crypto.randomUUID();
  const TEST_MEMBERSHIP_ID = crypto.randomUUID();

  beforeAll(async () => {
    try {
      process.loadEnvFile?.();
    } catch {}

    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error('SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY must be configured.');
    }

    supabase = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    adminSupabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    // P0-4: Secure disposable test identity per run (zero hardcoded credentials)
    const testUuid = crypto.randomUUID();
    const tempEmail = `ephemeral-test-${testUuid}@pramaan-test.internal`;
    const tempPassword = crypto.randomBytes(24).toString('base64') + '!Aa1';

    const { data: createdUser, error: createError } = await adminSupabase.auth.admin.createUser({
      email: tempEmail,
      password: tempPassword,
      email_confirm: true
    });

    if (createError || !createdUser.user) {
      throw new Error(`Failed to create ephemeral test user: ${createError?.message}`);
    }

    ephemeralUserId = createdUser.user.id;
    genuineAuthSubject = createdUser.user.id;

    // Sign in ephemeral user to obtain authentic ES256 Supabase token
    const { data: sessionData, error: signInError } = await supabase.auth.signInWithPassword({
      email: tempEmail,
      password: tempPassword
    });

    if (signInError || !sessionData.session?.access_token) {
      throw new Error(`Failed to obtain genuine Supabase token: ${signInError?.message}`);
    }

    genuineAccessToken = sessionData.session.access_token;

    pool = getDbPool();
    pgUserRepo = new PgUserRepository(pool);

    // Instantiate verifier using remote JWKS discovery
    jwtVerifier = new JwtVerifier({
      jwksUri: `${supabaseUrl.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`,
      issuer: `${supabaseUrl.replace(/\/$/, '')}/auth/v1`,
      audience: 'authenticated'
    });

    authService = new AuthService({
      jwtVerifier,
      userRepository: pgUserRepo
    });

    // Seed test identity and active membership in live PostgreSQL via admin runner
    await runQuery(`
      DELETE FROM memberships WHERE id = '${TEST_MEMBERSHIP_ID}';
      DELETE FROM users WHERE id = '${TEST_USER_ID}';
      DELETE FROM organizations WHERE id = '${TEST_COLLEGE_ID}';

      INSERT INTO organizations (id, name, kind)
      VALUES ('${TEST_COLLEGE_ID}', 'Supabase Auth Verification College', 'college');

      INSERT INTO users (id, auth_subject, email, full_name)
      VALUES ('${TEST_USER_ID}', '${genuineAuthSubject}', '${tempEmail}', 'Supabase Real User');

      INSERT INTO memberships (id, user_id, org_id, role, status)
      VALUES ('${TEST_MEMBERSHIP_ID}', '${TEST_USER_ID}', '${TEST_COLLEGE_ID}', 'officer', 'active');
    `);
  }, 30000);

  afterAll(async () => {
    // 1. Cleanup database test records
    await runQuery(`
      DELETE FROM memberships WHERE id = '${TEST_MEMBERSHIP_ID}';
      DELETE FROM users WHERE id = '${TEST_USER_ID}';
      DELETE FROM organizations WHERE id = '${TEST_COLLEGE_ID}';
    `);

    // 2. P0-4: Delete ephemeral user from Supabase Auth
    if (adminSupabase && ephemeralUserId) {
      try {
        await adminSupabase.auth.admin.deleteUser(ephemeralUserId);
      } catch (err) {
        console.error('Error cleaning up ephemeral test user:', err);
      }
    }
  }, 30000);

  it('1. Authenticates genuine Supabase ES256 access token against live JWKS endpoint', async () => {
    const verifyRes = await jwtVerifier.verifyToken(genuineAccessToken);

    expect(verifyRes.valid).toBe(true);
    expect(verifyRes.payload).toBeDefined();
    expect(verifyRes.payload?.sub).toBe(genuineAuthSubject);
    expect(verifyRes.payload?.aud).toBe('authenticated');

    // Resolve context through AuthService and database membership lookup
    const authRes = await authService.resolveContext(`Bearer ${genuineAccessToken}`);
    expect(authRes.authenticated).toBe(true);
    expect(authRes.context).toBeDefined();
    expect(authRes.context?.userId).toBe(TEST_USER_ID);
    expect(authRes.context?.orgId).toBe(TEST_COLLEGE_ID);
    expect(authRes.context?.role).toBe('officer');
  });

  it('2. Rejects genuine token with tampered signature segment', async () => {
    const parts = genuineAccessToken.split('.');
    const tamperedToken = `${parts[0]}.${parts[1]}.tampered_signature_payload`;

    const verifyRes = await jwtVerifier.verifyToken(tamperedToken);
    expect(verifyRes.valid).toBe(false);
    expect(verifyRes.error).toMatch(/Signature verification failed/);
  });

  it('3. Rejects token when audience does not match expected "authenticated"', async () => {
    const wrongAudienceVerifier = new JwtVerifier({
      jwksUri: `${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
      audience: 'mismatched-aud-custom'
    });

    const verifyRes = await wrongAudienceVerifier.verifyToken(genuineAccessToken);
    expect(verifyRes.valid).toBe(false);
    expect(verifyRes.error).toMatch(/Claim validation failed/);
  });

  it('4. Rejects token when issuer does not match expected Supabase auth endpoint', async () => {
    const wrongIssuerVerifier = new JwtVerifier({
      jwksUri: `${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
      issuer: 'https://imposter-identity-service.com/auth/v1'
    });

    const verifyRes = await wrongIssuerVerifier.verifyToken(genuineAccessToken);
    expect(verifyRes.valid).toBe(false);
    expect(verifyRes.error).toMatch(/Claim validation failed/);
  });

  it('5. Rejects unsigned token ("alg": "none")', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: genuineAuthSubject, aud: 'authenticated' })).toString('base64url');
    const unsignedToken = `${header}.${payload}.`;

    const verifyRes = await jwtVerifier.verifyToken(unsignedToken);
    expect(verifyRes.valid).toBe(false);
  });

  it('6. Rejects symmetric HS256 algorithm confusion against asymmetric ES256 verifier', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: genuineAuthSubject, aud: 'authenticated' })).toString('base64url');
    const fakeHs256Token = `${header}.${payload}.fake_hs256_signature`;

    const verifyRes = await jwtVerifier.verifyToken(fakeHs256Token);
    expect(verifyRes.valid).toBe(false);
  });

  it('7. Rejects spoofed organization ID when user holds no membership in target tenant', async () => {
    const foreignOrgId = 'd0000000-0000-0000-0000-000000000099';
    const authRes = await authService.resolveContext(`Bearer ${genuineAccessToken}`, foreignOrgId);

    expect(authRes.authenticated).toBe(false);
    expect(authRes.statusCode).toBe(403);
    expect(authRes.error).toMatch(/FORBIDDEN_TENANT_ACCESS/);
  });

  it('8. Rejects identity when membership status is suspended in database', async () => {
    await runQuery(`
      UPDATE memberships SET status = 'suspended' WHERE id = '${TEST_MEMBERSHIP_ID}';
    `);

    try {
      const authRes = await authService.resolveContext(`Bearer ${genuineAccessToken}`);
      expect(authRes.authenticated).toBe(false);
      expect(authRes.statusCode).toBe(403);
      expect(authRes.error).toMatch(/Membership is suspended/);
    } finally {
      await runQuery(`
        UPDATE memberships SET status = 'active' WHERE id = '${TEST_MEMBERSHIP_ID}';
      `);
    }
  });

  it('9. Rejects identity when membership status is revoked in database', async () => {
    await runQuery(`
      UPDATE memberships SET status = 'revoked' WHERE id = '${TEST_MEMBERSHIP_ID}';
    `);

    try {
      const authRes = await authService.resolveContext(`Bearer ${genuineAccessToken}`);
      expect(authRes.authenticated).toBe(false);
      expect(authRes.statusCode).toBe(403);
      expect(authRes.error).toMatch(/Membership is revoked/);
    } finally {
      await runQuery(`
        UPDATE memberships SET status = 'active' WHERE id = '${TEST_MEMBERSHIP_ID}';
      `);
    }
  });

  // ==========================================================================
  // SECTION 2: ISOLATED CRYPTOGRAPHIC CLAIMS & ROLE VALIDATION TESTS (P1-5)
  // Uses an isolated, test-only signing key to prove individual claim validators
  // are reached AFTER signature verification succeeds.
  // NEVER uses the production Supabase JWT secret.
  // ==========================================================================

  const ISOLATED_TEST_SECRET = 'pramaan-claims-unit-test-isolated-secret-32-chars-minimum!';
  const ISOLATED_TEST_ISSUER = 'https://auth.isolated-claim-test.pramaan.edu/auth/v1';
  const claimsVerifier = new JwtVerifier({
    jwtSecret: ISOLATED_TEST_SECRET,
    issuer: ISOLATED_TEST_ISSUER,
    audience: 'authenticated'
  });

  it('10. Rejects token with missing expiration (exp) claim', async () => {
    const token = await createTestToken(
      { sub: 'isolated-test-subject-001' },
      { customSecret: ISOLATED_TEST_SECRET, issuer: ISOLATED_TEST_ISSUER, omitExp: true }
    );

    const verifyRes = await claimsVerifier.verifyToken(token);
    expect(verifyRes.valid).toBe(false);
    expect(verifyRes.error).toBe('Missing or invalid expiration claim (exp) in token payload.');
  });

  it('11. Rejects expired token', async () => {
    const token = await createTestToken(
      { sub: 'isolated-test-subject-001' },
      { customSecret: ISOLATED_TEST_SECRET, issuer: ISOLATED_TEST_ISSUER, expiresIn: -3600 }
    );

    const verifyRes = await claimsVerifier.verifyToken(token);
    expect(verifyRes.valid).toBe(false);
    expect(verifyRes.error).toBe('Token has expired.');
  });

  it('12. Rejects token with missing issuer (iss) claim', async () => {
    const token = await createTestToken(
      { sub: 'isolated-test-subject-001' },
      { customSecret: ISOLATED_TEST_SECRET, issuer: null }
    );

    const verifyRes = await claimsVerifier.verifyToken(token);
    expect(verifyRes.valid).toBe(false);
    expect(verifyRes.error).toMatch(/claim validation failed|missing issuer/i);
  });

  it('13. Rejects token with missing audience (aud) claim', async () => {
    const token = await createTestToken(
      { sub: 'isolated-test-subject-001' },
      { customSecret: ISOLATED_TEST_SECRET, issuer: ISOLATED_TEST_ISSUER, audience: null }
    );

    const verifyRes = await claimsVerifier.verifyToken(token);
    expect(verifyRes.valid).toBe(false);
    expect(verifyRes.error).toMatch(/claim validation failed|missing audience/i);
  });

  it('14. Rejects token with missing or empty subject (sub) claim', async () => {
    const token = await createTestToken(
      { sub: '' },
      { customSecret: ISOLATED_TEST_SECRET, issuer: ISOLATED_TEST_ISSUER }
    );

    const verifyRes = await claimsVerifier.verifyToken(token);
    expect(verifyRes.valid).toBe(false);
    expect(verifyRes.error).toBe('Missing or empty subject claim (sub) in token payload.');
  });

  it('15. Rejects token with future issued-at (iat) timestamp beyond clock skew', async () => {
    const futureIat = Math.floor(Date.now() / 1000) + 7200; // 2 hours in the future
    const token = await createTestToken(
      { sub: 'isolated-test-subject-001', iat: futureIat },
      { customSecret: ISOLATED_TEST_SECRET, issuer: ISOLATED_TEST_ISSUER }
    );

    const verifyRes = await claimsVerifier.verifyToken(token);
    expect(verifyRes.valid).toBe(false);
    expect(verifyRes.error).toBe('Token issued-at claim (iat) is in the future.');
  });

  it('16. Rejects token when role claim is "service_role" (prohibiting service key as user auth)', async () => {
    const token = await createTestToken(
      { sub: 'isolated-test-subject-001', role: 'service_role' },
      { customSecret: ISOLATED_TEST_SECRET, issuer: ISOLATED_TEST_ISSUER }
    );

    const verifyRes = await claimsVerifier.verifyToken(token);
    expect(verifyRes.valid).toBe(false);
    expect(verifyRes.error).toBe(
      "FORBIDDEN_TOKEN_ROLE: Token role 'service_role' is not permitted for user authentication (role must be exactly \"authenticated\")."
    );
  });

  it('17. Rejects token when role claim is "anon" (anonymous key prohibited)', async () => {
    const token = await createTestToken(
      { sub: 'isolated-test-subject-001', role: 'anon' },
      { customSecret: ISOLATED_TEST_SECRET, issuer: ISOLATED_TEST_ISSUER }
    );

    const verifyRes = await claimsVerifier.verifyToken(token);
    expect(verifyRes.valid).toBe(false);
    expect(verifyRes.error).toBe(
      "FORBIDDEN_TOKEN_ROLE: Token role 'anon' is not permitted for user authentication (role must be exactly \"authenticated\")."
    );
  });

  it('18. Rejects token with missing role claim', async () => {
    const token = await createTestToken(
      { sub: 'isolated-test-subject-001' },
      { customSecret: ISOLATED_TEST_SECRET, issuer: ISOLATED_TEST_ISSUER, omitRole: true }
    );

    const verifyRes = await claimsVerifier.verifyToken(token);
    expect(verifyRes.valid).toBe(false);
    expect(verifyRes.error).toBe(
      'MISSING_OR_EMPTY_ROLE: Token is missing a valid role claim (role must be "authenticated").'
    );
  });

  it('19. Rejects token with empty role claim', async () => {
    const token = await createTestToken(
      { sub: 'isolated-test-subject-001', role: '   ' },
      { customSecret: ISOLATED_TEST_SECRET, issuer: ISOLATED_TEST_ISSUER }
    );

    const verifyRes = await claimsVerifier.verifyToken(token);
    expect(verifyRes.valid).toBe(false);
    expect(verifyRes.error).toBe(
      'MISSING_OR_EMPTY_ROLE: Token is missing a valid role claim (role must be "authenticated").'
    );
  });

  it('20. Rejects token with invalid arbitrary role (e.g. "admin")', async () => {
    const token = await createTestToken(
      { sub: 'isolated-test-subject-001', role: 'admin' },
      { customSecret: ISOLATED_TEST_SECRET, issuer: ISOLATED_TEST_ISSUER }
    );

    const verifyRes = await claimsVerifier.verifyToken(token);
    expect(verifyRes.valid).toBe(false);
    expect(verifyRes.error).toBe(
      "FORBIDDEN_TOKEN_ROLE: Token role 'admin' is not permitted for user authentication (role must be exactly \"authenticated\")."
    );
  });

  it('21. Validates correctly signed token with role: "authenticated"', async () => {
    const token = await createTestToken(
      { sub: 'isolated-test-subject-001', role: 'authenticated' },
      { customSecret: ISOLATED_TEST_SECRET, issuer: ISOLATED_TEST_ISSUER }
    );

    const verifyRes = await claimsVerifier.verifyToken(token);
    expect(verifyRes.valid).toBe(true);
    expect(verifyRes.payload?.role).toBe('authenticated');
    expect(verifyRes.payload?.sub).toBe('isolated-test-subject-001');
  });
});
