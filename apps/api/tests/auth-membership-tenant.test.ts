import { describe, it, expect, beforeEach } from 'vitest';
import { AuthService } from '../src/services/auth-service.js';

describe('AuthService: Membership-Derived Tenancy & Fail-Closed Defense', () => {
  let authService: AuthService;

  const apexOrgId = '00000000-0000-0000-0000-000000000001';
  const zenithOrgId = '00000000-0000-0000-0000-000000000002';

  const tpoUserId = '20000000-0000-0000-0000-000000000001'; // Member of Apex only
  const studentUserId = '20000000-0000-0000-0000-000000000003'; // Member of Apex only

  beforeEach(() => {
    authService = new AuthService();
  });

  it('fails closed with 401 when authorization header is absent', () => {
    const res = authService.resolveContext(undefined);
    expect(res.authenticated).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.error).toMatch(/AUTHENTICATION_REQUIRED/);
    expect(res.context).toBeUndefined();
  });

  it('fails closed with 401 when token/userId does not match any registered user', () => {
    const res = authService.resolveContext('unregistered-user-token');
    expect(res.authenticated).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.error).toMatch(/INVALID_CREDENTIALS/);
  });

  it('derives tenant identity strictly from active membership when no org is requested', () => {
    const res = authService.resolveContext(tpoUserId);
    expect(res.authenticated).toBe(true);
    expect(res.context?.userId).toBe(tpoUserId);
    expect(res.context?.orgId).toBe(apexOrgId);
    expect(res.context?.role).toBe('officer');
  });

  it('rejects spoofed client-supplied x-org-id when user holds no membership in that organization', () => {
    // TPO is a member of Apex, but client sends x-org-id for Zenith
    const res = authService.resolveContext(tpoUserId, zenithOrgId);
    expect(res.authenticated).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.error).toMatch(/FORBIDDEN_TENANT_ACCESS.*Client-supplied tenant ID rejected/);
    expect(res.context).toBeUndefined();
  });

  it('accepts requested x-org-id when user holds a valid multi-college membership', () => {
    // Add multi-college membership for an auditor/officer
    authService.addMembership({
      id: '30000000-0000-0000-0000-000000000099',
      userId: tpoUserId,
      orgId: zenithOrgId, // Also active in Zenith
      role: 'officer',
      status: 'active',
      createdAt: new Date().toISOString()
    });

    // Now requesting Zenith is permitted
    const res = authService.resolveContext(tpoUserId, zenithOrgId);
    expect(res.authenticated).toBe(true);
    expect(res.context?.orgId).toBe(zenithOrgId);
  });

  it('fails closed when user membership is suspended or revoked', () => {
    const rogueUserId = '20000000-0000-0000-0000-000000000088';
    authService.registerUser({
      id: rogueUserId,
      authSubject: 'auth0|rogue',
      email: 'rogue@apex.edu',
      fullName: 'Rogue User',
      createdAt: new Date().toISOString()
    });
    authService.addMembership({
      id: '30000000-0000-0000-0000-000000000088',
      userId: rogueUserId,
      orgId: apexOrgId,
      role: 'student',
      status: 'suspended', // Suspended!
      createdAt: new Date().toISOString()
    });

    const res = authService.resolveContext(rogueUserId);
    expect(res.authenticated).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.error).toMatch(/NO_ACTIVE_MEMBERSHIP/);
  });
});
