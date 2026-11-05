import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { JwtVerifier } from '../src/services/jwt-verifier.js';
import { AuthService } from '../src/services/auth-service.js';
import { PgUserRepository } from '../src/repositories/user-repository.js';
import { getDbPool, closeDbPool } from '../src/db/pool.js';
import pg from 'pg';

describe('Real Supabase JWT Authentication & JWKS Verification (P0-1, P0-2)', () => {
  let supabase: SupabaseClient;
  let pool: pg.Pool;
  let pgUserRepo: PgUserRepository;
  let authService: AuthService;
  let jwtVerifier: JwtVerifier;

  let genuineAccessToken: string;
  let genuineAuthSubject: string;

  const TEST_COLLEGE_ID = 'd0000000-0000-0000-0000-000000000001';
  const TEST_USER_ID = 'd1000000-0000-0000-0000-000000000001';
  const TEST_MEMBERSHIP_ID = 'd2000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    try {
      process.loadEnvFile?.();
    } catch {}

    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be configured.');
    }

    supabase = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    // Sign in test user to obtain authentic ES256 Supabase token
    const { data, error } = await supabase.auth.signInWithPassword({
      email: 'test-real-auth@example.com',
      password: 'TestPassword123!'
    });

    if (error || !data.session?.access_token || !data.user?.id) {
      throw new Error(`Failed to obtain genuine Supabase token: ${error?.message}`);
    }

    genuineAccessToken = data.session.access_token;
    genuineAuthSubject = data.user.id;

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

    // Seed test identity and active membership in live PostgreSQL
    const client = await pool.connect();
    try {
      await client.query(`
        DELETE FROM memberships WHERE id = '${TEST_MEMBERSHIP_ID}';
        DELETE FROM users WHERE id = '${TEST_USER_ID}';
        DELETE FROM organizations WHERE id = '${TEST_COLLEGE_ID}';

        INSERT INTO organizations (id, name, kind)
        VALUES ('${TEST_COLLEGE_ID}', 'Supabase Auth Verification College', 'college');

        INSERT INTO users (id, auth_subject, email, full_name)
        VALUES ('${TEST_USER_ID}', '${genuineAuthSubject}', 'test-real-auth@example.com', 'Supabase Real User');

        INSERT INTO memberships (id, user_id, org_id, role, status)
        VALUES ('${TEST_MEMBERSHIP_ID}', '${TEST_USER_ID}', '${TEST_COLLEGE_ID}', 'officer', 'active');
      `);
    } finally {
      client.release();
    }
  }, 30000);

  afterAll(async () => {
    if (pool) {
      const client = await pool.connect();
      try {
        await client.query(`
          DELETE FROM memberships WHERE id = '${TEST_MEMBERSHIP_ID}';
          DELETE FROM users WHERE id = '${TEST_USER_ID}';
          DELETE FROM organizations WHERE id = '${TEST_COLLEGE_ID}';
        `);
      } finally {
        client.release();
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
    // Tamper signature segment
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
    // Unsigned base64 header {"alg":"none","typ":"JWT"} and payload {"sub":"fake","aud":"authenticated"}
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
    const client = await pool.connect();
    try {
      await client.query(`
        UPDATE memberships SET status = 'suspended' WHERE id = '${TEST_MEMBERSHIP_ID}';
      `);

      const authRes = await authService.resolveContext(`Bearer ${genuineAccessToken}`);
      expect(authRes.authenticated).toBe(false);
      expect(authRes.statusCode).toBe(403);
      expect(authRes.error).toMatch(/Membership is suspended/);
    } finally {
      // Restore active status
      await client.query(`
        UPDATE memberships SET status = 'active' WHERE id = '${TEST_MEMBERSHIP_ID}';
      `);
      client.release();
    }
  });

  it('9. Rejects identity when membership status is revoked in database', async () => {
    const client = await pool.connect();
    try {
      await client.query(`
        UPDATE memberships SET status = 'revoked' WHERE id = '${TEST_MEMBERSHIP_ID}';
      `);

      const authRes = await authService.resolveContext(`Bearer ${genuineAccessToken}`);
      expect(authRes.authenticated).toBe(false);
      expect(authRes.statusCode).toBe(403);
      expect(authRes.error).toMatch(/Membership is revoked/);
    } finally {
      // Restore active status
      await client.query(`
        UPDATE memberships SET status = 'active' WHERE id = '${TEST_MEMBERSHIP_ID}';
      `);
      client.release();
    }
  });
});
