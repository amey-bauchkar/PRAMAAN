import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { JwtVerifier } from '../src/services/jwt-verifier.js';
import { AuthService } from '../src/services/auth-service.js';
import { PgUserRepository } from '../src/repositories/user-repository.js';
import { getDbPool } from '../src/db/pool.js';
import { runQuery } from '../../../scripts/supabase-runner.mjs';
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

  const TEST_COLLEGE_ID = 'd0000000-0000-0000-0000-000000000001';
  const TEST_USER_ID = 'd1000000-0000-0000-0000-000000000001';
  const TEST_MEMBERSHIP_ID = 'd2000000-0000-0000-0000-000000000001';

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

  // --- P1-5 Strict Claims Validation Tests ---

  it('10. Rejects token with missing expiration (exp) claim', async () => {
    // Decode genuine token segments and tamper payload to remove exp
    const parts = genuineAccessToken.split('.');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    delete claims.exp;

    // Use test signer without exp to simulate un-expiring token
    const tamperedPayload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const tokenWithoutExp = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    const verifyRes = await jwtVerifier.verifyToken(tokenWithoutExp);
    expect(verifyRes.valid).toBe(false);
    expect(verifyRes.error).toBeDefined();
  });

  it('11. Rejects token when role claim is "service_role" (prohibiting service key as user auth)', async () => {
    const parts = genuineAccessToken.split('.');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    claims.role = 'service_role'; // Imposter service role

    const tamperedPayload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const serviceToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    const verifyRes = await jwtVerifier.verifyToken(serviceToken);
    expect(verifyRes.valid).toBe(false);
  });

  it('12. Rejects token when role claim is "anon" (anonymous key prohibited)', async () => {
    const parts = genuineAccessToken.split('.');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    claims.role = 'anon';

    const tamperedPayload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const anonToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    const verifyRes = await jwtVerifier.verifyToken(anonToken);
    expect(verifyRes.valid).toBe(false);
  });

  it('13. Rejects token with missing issuer (iss) claim', async () => {
    const parts = genuineAccessToken.split('.');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    delete claims.iss;

    const tamperedPayload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const tokenWithoutIss = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    const verifyRes = await jwtVerifier.verifyToken(tokenWithoutIss);
    expect(verifyRes.valid).toBe(false);
    expect(verifyRes.error).toBeDefined();
  });

  it('14. Rejects token with missing audience (aud) claim', async () => {
    const parts = genuineAccessToken.split('.');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    delete claims.aud;

    const tamperedPayload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const tokenWithoutAud = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    const verifyRes = await jwtVerifier.verifyToken(tokenWithoutAud);
    expect(verifyRes.valid).toBe(false);
    expect(verifyRes.error).toBeDefined();
  });

  it('15. Rejects token with future issued-at (iat) timestamp beyond clock skew', async () => {
    const parts = genuineAccessToken.split('.');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    claims.iat = Math.floor(Date.now() / 1000) + 7200; // 2 hours in the future

    const tamperedPayload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const tokenWithFutureIat = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    const verifyRes = await jwtVerifier.verifyToken(tokenWithFutureIat);
    expect(verifyRes.valid).toBe(false);
    expect(verifyRes.error).toBeDefined();
  });

  it('16. Rejects expired token', async () => {
    const parts = genuineAccessToken.split('.');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    claims.exp = Math.floor(Date.now() / 1000) - 3600; // Expired 1 hour ago

    const tamperedPayload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const expiredToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    const verifyRes = await jwtVerifier.verifyToken(expiredToken);
    expect(verifyRes.valid).toBe(false);
    expect(verifyRes.error).toBeDefined();
  });

  it('17. Rejects token with missing or empty subject (sub) claim', async () => {
    const parts = genuineAccessToken.split('.');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    delete claims.sub;

    const tamperedPayload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const tokenWithoutSub = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    const verifyRes = await jwtVerifier.verifyToken(tokenWithoutSub);
    expect(verifyRes.valid).toBe(false);
    expect(verifyRes.error).toBeDefined();
  });
});
