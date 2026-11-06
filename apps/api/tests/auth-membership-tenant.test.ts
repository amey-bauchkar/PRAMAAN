import { describe, it, expect, beforeEach } from 'vitest';
import { AuthService } from '../src/services/auth-service.js';
import { JwtVerifier } from '../src/services/jwt-verifier.js';
import { createTestToken, TEST_JWT_SECRET } from '../src/testing/test-jwt-utils.js';
import { InMemoryUserRepository } from '../src/repositories/user-repository.js';
import { User } from '@pramaan/contracts';

describe('AuthService: Genuine Supabase JWT Verification & Membership Derivation', () => {
  let authService: AuthService;
  let jwtVerifier: JwtVerifier;
  let userRepo: InMemoryUserRepository;

  const testSecret = TEST_JWT_SECRET;
  const apexOrgId = '00000000-0000-0000-0000-000000000001';
  const zenithOrgId = '00000000-0000-0000-0000-000000000002';

  const tpoUser: User = {
    id: '20000000-0000-0000-0000-000000000001',
    authSubject: 'supabase-auth-tpo-priya-uuid',
    email: 'priya.sharma@apex.edu',
    fullName: 'Priya Sharma',
    createdAt: new Date().toISOString()
  };

  const studentUser: User = {
    id: '20000000-0000-0000-0000-000000000003',
    authSubject: 'supabase-auth-student-aarav-uuid',
    email: 'aarav.patel@apex.edu',
    fullName: 'Aarav Patel',
    createdAt: new Date().toISOString()
  };

  beforeEach(async () => {
    jwtVerifier = new JwtVerifier(testSecret);
    userRepo = new InMemoryUserRepository();
    authService = new AuthService({ jwtVerifier, userRepository: userRepo });

    await userRepo.registerUser(tpoUser);
    await userRepo.addMembership({
      id: '30000000-0000-0000-0000-000000000001',
      userId: tpoUser.id,
      orgId: apexOrgId,
      role: 'officer',
      status: 'active',
      createdAt: new Date().toISOString()
    });

    await userRepo.registerUser(studentUser);
    await userRepo.addMembership({
      id: '30000000-0000-0000-0000-000000000003',
      userId: studentUser.id,
      orgId: apexOrgId,
      departmentId: '10000000-0000-0000-0000-000000000001',
      role: 'student',
      status: 'active',
      createdAt: new Date().toISOString()
    });
  });

  it('1. Fails closed with 401 when Authorization header is absent', async () => {
    const res = await authService.resolveContext(undefined);
    expect(res.authenticated).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.error).toMatch(/AUTHENTICATION_REQUIRED/);
    expect(res.context).toBeUndefined();
  });

  it('2. Fails closed with 401 when Authorization header does not use Bearer scheme', async () => {
    // Sending plain string without Bearer scheme
    const res = await authService.resolveContext(`Basic ${tpoUser.id}`);
    expect(res.authenticated).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.error).toMatch(/INVALID_TOKEN_SCHEME/);
  });

  it('3. Rejects plain user ID supplied directly as token value', async () => {
    // Passing plain user ID instead of JWT
    const res1 = await authService.resolveContext(tpoUser.id);
    expect(res1.authenticated).toBe(false);
    expect(res1.statusCode).toBe(401);
    expect(res1.error).toMatch(/INVALID_TOKEN_SCHEME/);

    const res2 = await authService.resolveContext(`Bearer ${tpoUser.id}`);
    expect(res2.authenticated).toBe(false);
    expect(res2.statusCode).toBe(401);
    expect(res2.error).toMatch(/Malformed JWT/);
  });

  it('4. Rejects malformed JWT (less or more than 3 segments)', async () => {
    const res = await authService.resolveContext('Bearer header.payload_only');
    expect(res.authenticated).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.error).toMatch(/Malformed JWT/);
  });

  it('5. Rejects expired JWT token', async () => {
    const expiredToken = await createTestToken(
      { sub: tpoUser.authSubject, email: tpoUser.email },
      { expiresIn: '-10s' } // Expired 10 seconds ago
    );

    const res = await authService.resolveContext(`Bearer ${expiredToken}`);
    expect(res.authenticated).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.error).toMatch(/Token has expired/);
  });

  it('6. Rejects forged JWT token signed with an invalid secret', async () => {
    const forgedToken = await createTestToken(
      { sub: tpoUser.authSubject, email: tpoUser.email },
      { customSecret: 'wrong-attacker-secret-key-32chars!' }
    );

    const res = await authService.resolveContext(`Bearer ${forgedToken}`);
    expect(res.authenticated).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.error).toMatch(/Signature verification failed/);
  });

  it('7. Rejects authenticated identity not registered in PRAMAAN institution database', async () => {
    const unknownToken = await createTestToken({
      sub: 'supabase-unregistered-user-999',
      email: 'stranger@external.com'
    });

    const res = await authService.resolveContext(`Bearer ${unknownToken}`);
    expect(res.authenticated).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.error).toMatch(/UNREGISTERED_IDENTITY/);
  });

  it('8. Rejects authenticated user who holds NO memberships in any institution', async () => {
    const orphanUser: User = {
      id: '20000000-0000-0000-0000-000000000099',
      authSubject: 'supabase-orphan-uuid',
      email: 'orphan@apex.edu',
      fullName: 'Orphan User',
      createdAt: new Date().toISOString()
    };
    await userRepo.registerUser(orphanUser);

    const token = await createTestToken({
      sub: orphanUser.authSubject,
      email: orphanUser.email
    });

    const res = await authService.resolveContext(`Bearer ${token}`);
    expect(res.authenticated).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.error).toMatch(/NO_ACTIVE_MEMBERSHIP/);
  });

  it('9. Rejects user whose membership is suspended', async () => {
    const suspendedUser: User = {
      id: '20000000-0000-0000-0000-000000000088',
      authSubject: 'supabase-suspended-uuid',
      email: 'suspended@apex.edu',
      fullName: 'Suspended Student',
      createdAt: new Date().toISOString()
    };
    await userRepo.registerUser(suspendedUser);
    await userRepo.addMembership({
      id: '30000000-0000-0000-0000-000000000088',
      userId: suspendedUser.id,
      orgId: apexOrgId,
      role: 'student',
      status: 'suspended', // Suspended!
      createdAt: new Date().toISOString()
    });

    const token = await createTestToken({
      sub: suspendedUser.authSubject,
      email: suspendedUser.email
    });

    const res = await authService.resolveContext(`Bearer ${token}`);
    expect(res.authenticated).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.error).toMatch(/Membership is suspended/);
  });

  it('10. Rejects user whose membership is revoked', async () => {
    const revokedUser: User = {
      id: '20000000-0000-0000-0000-000000000077',
      authSubject: 'supabase-revoked-uuid',
      email: 'revoked@apex.edu',
      fullName: 'Revoked Officer',
      createdAt: new Date().toISOString()
    };
    await userRepo.registerUser(revokedUser);
    await userRepo.addMembership({
      id: '30000000-0000-0000-0000-000000000077',
      userId: revokedUser.id,
      orgId: apexOrgId,
      role: 'officer',
      status: 'revoked', // Revoked!
      createdAt: new Date().toISOString()
    });

    const token = await createTestToken({
      sub: revokedUser.authSubject,
      email: revokedUser.email
    });

    const res = await authService.resolveContext(`Bearer ${token}`);
    expect(res.authenticated).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.error).toMatch(/Membership is revoked/);
  });

  it('11. Derives tenant and role strictly from verified active membership (Valid login)', async () => {
    const token = await createTestToken({
      sub: tpoUser.authSubject,
      email: tpoUser.email
    });

    const res = await authService.resolveContext(`Bearer ${token}`);
    expect(res.authenticated).toBe(true);
    expect(res.context?.userId).toBe(tpoUser.id);
    expect(res.context?.orgId).toBe(apexOrgId);
    expect(res.context?.role).toBe('officer');
  });

  it('12. Rejects spoofed client x-org-id when user holds no membership in that organization', async () => {
    const token = await createTestToken({
      sub: tpoUser.authSubject,
      email: tpoUser.email
    });

    // TPO is only in Apex, but requests Zenith org ID
    const res = await authService.resolveContext(`Bearer ${token}`, zenithOrgId);
    expect(res.authenticated).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.error).toMatch(/FORBIDDEN_TENANT_ACCESS.*Client-supplied tenant ID rejected/);
  });

  it('13. Supports legitimate multi-college membership when requested via x-org-id', async () => {
    // Add valid active membership in Zenith for TPO
    await userRepo.addMembership({
      id: '30000000-0000-0000-0000-000000000055',
      userId: tpoUser.id,
      orgId: zenithOrgId,
      role: 'officer',
      status: 'active',
      createdAt: new Date().toISOString()
    });

    const token = await createTestToken({
      sub: tpoUser.authSubject,
      email: tpoUser.email
    });

    // Explicitly select Zenith
    const res = await authService.resolveContext(`Bearer ${token}`, zenithOrgId);
    expect(res.authenticated).toBe(true);
    expect(res.context?.orgId).toBe(zenithOrgId);
    expect(res.context?.role).toBe('officer');
  });
});
