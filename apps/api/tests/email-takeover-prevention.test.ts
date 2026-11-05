import { describe, it, expect, beforeEach } from 'vitest';
import { AuthService } from '../src/services/auth-service.js';
import { JwtVerifier } from '../src/services/jwt-verifier.js';
import { InMemoryUserRepository } from '../src/repositories/user-repository.js';
import { createTestToken, TEST_JWT_SECRET } from '../src/testing/test-jwt-utils.js';
import { User } from '@pramaan/contracts';

describe('Security Hardening: Account Takeover & Insecure Email-Linking Prevention (P0-3)', () => {
  let authService: AuthService;
  let userRepo: InMemoryUserRepository;
  let jwtVerifier: JwtVerifier;

  const apexOrgId = '00000000-0000-0000-0000-000000000001';

  const legitimateStudent: User = {
    id: '20000000-0000-0000-0000-000000000003',
    authSubject: 'supabase-legit-aarav-uuid-12345',
    email: 'aarav.patel@apex.edu',
    fullName: 'Aarav Patel',
    createdAt: new Date().toISOString()
  };

  beforeEach(async () => {
    jwtVerifier = new JwtVerifier(TEST_JWT_SECRET);
    userRepo = new InMemoryUserRepository();
    authService = new AuthService({ jwtVerifier, userRepository: userRepo });

    // Register legitimate student in Apex Institute
    await userRepo.registerUser(legitimateStudent);
    await userRepo.addMembership({
      id: '30000000-0000-0000-0000-000000000003',
      userId: legitimateStudent.id,
      orgId: apexOrgId,
      departmentId: '10000000-0000-0000-0000-000000000001',
      role: 'student',
      status: 'active',
      createdAt: new Date().toISOString()
    });
  });

  it('1. Legitimate user authenticates successfully with matching verified authSubject claim', async () => {
    const validToken = await createTestToken({
      sub: legitimateStudent.authSubject,
      email: legitimateStudent.email
    });

    const res = await authService.resolveContext(`Bearer ${validToken}`);
    expect(res.authenticated).toBe(true);
    expect(res.context?.userId).toBe(legitimateStudent.id);
    expect(res.context?.orgId).toBe(apexOrgId);
    expect(res.context?.role).toBe('student');
  });

  it('2. Attacker presenting identical email but different authSubject is strictly rejected (Account Takeover Blocked)', async () => {
    // Malicious actor acquires or forges a token from an identity provider with their own sub
    // but spoofing/matching the victim student's email address
    const attackerSpoofedToken = await createTestToken({
      sub: 'supabase-attacker-rogue-uuid-66666',
      email: legitimateStudent.email // Identical email!
    });

    const res = await authService.resolveContext(`Bearer ${attackerSpoofedToken}`);

    // Must FAIL closed: email address must NEVER be used for automatic identity linking!
    expect(res.authenticated).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.error).toMatch(/UNREGISTERED_IDENTITY/);
    expect(res.context).toBeUndefined();
  });

  it('3. User without email claim but with valid registered authSubject resolves correctly', async () => {
    // Supabase or OAuth provider without email scope
    const noEmailToken = await createTestToken({
      sub: legitimateStudent.authSubject
    });

    const res = await authService.resolveContext(`Bearer ${noEmailToken}`);
    expect(res.authenticated).toBe(true);
    expect(res.context?.userId).toBe(legitimateStudent.id);
  });

  it('4. Attacker with completely unrelated authSubject and unverified email is rejected', async () => {
    const randomToken = await createTestToken({
      sub: 'supabase-unknown-random-uuid',
      email: 'hacker@attacker-domain.org'
    });

    const res = await authService.resolveContext(`Bearer ${randomToken}`);
    expect(res.authenticated).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.error).toMatch(/UNREGISTERED_IDENTITY/);
  });
});
