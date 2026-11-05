import {
  User,
  Membership,
  SessionContext
} from '@pramaan/contracts';

export interface AuthResolutionResult {
  authenticated: boolean;
  context?: SessionContext;
  statusCode?: number;
  error?: string;
}

export class AuthService {
  private users: Map<string, User> = new Map();
  private memberships: Map<string, Membership[]> = new Map(); // userId -> memberships

  constructor() {
    this.seedDefaultUsers();
  }

  private seedDefaultUsers() {
    // TPO Priya Sharma (Apex Institute)
    const tpoUser: User = {
      id: '20000000-0000-0000-0000-000000000001',
      authSubject: 'auth0|tpo_priya',
      email: 'priya.sharma@apex.edu',
      fullName: 'Priya Sharma',
      createdAt: new Date().toISOString()
    };
    this.registerUser(tpoUser);
    this.addMembership({
      id: '30000000-0000-0000-0000-000000000001',
      userId: tpoUser.id,
      orgId: '00000000-0000-0000-0000-000000000001', // Apex
      role: 'officer',
      status: 'active',
      createdAt: new Date().toISOString()
    });

    // Student Aarav Patel (Apex Institute)
    const studentUser: User = {
      id: '20000000-0000-0000-0000-000000000003',
      authSubject: 'auth0|student_aarav',
      email: 'aarav.patel@apex.edu',
      fullName: 'Aarav Patel',
      createdAt: new Date().toISOString()
    };
    this.registerUser(studentUser);
    this.addMembership({
      id: '30000000-0000-0000-0000-000000000003',
      userId: studentUser.id,
      orgId: '00000000-0000-0000-0000-000000000001', // Apex
      departmentId: '10000000-0000-0000-0000-000000000001',
      role: 'student',
      status: 'active',
      createdAt: new Date().toISOString()
    });
  }

  public registerUser(user: User): User {
    this.users.set(user.id, user);
    return user;
  }

  public addMembership(membership: Membership): Membership {
    const list = this.memberships.get(membership.userId) || [];
    list.push(membership);
    this.memberships.set(membership.userId, list);
    return membership;
  }

  /**
   * Resolves session context strictly from authenticated user memberships.
   * If a client supplies a requestedOrgId, it is verified against active memberships.
   * Fails closed if unauthenticated or if user attempts to access an organization they do not belong to.
   */
  public resolveContext(
    authHeader?: string,
    requestedOrgId?: string
  ): AuthResolutionResult {
    if (!authHeader) {
      return {
        authenticated: false,
        statusCode: 401,
        error: 'AUTHENTICATION_REQUIRED: Missing authorization header.'
      };
    }

    // In production, verify JWT. In this mock/service layer, authHeader represents userId or Bearer token
    const userId = authHeader.replace(/^Bearer\s+/i, '').trim();
    const user = this.users.get(userId);
    if (!user) {
      return {
        authenticated: false,
        statusCode: 401,
        error: 'INVALID_CREDENTIALS: User identity could not be verified.'
      };
    }

    const userMemberships = (this.memberships.get(user.id) || []).filter(
      m => m.status === 'active'
    );

    if (userMemberships.length === 0) {
      return {
        authenticated: false,
        statusCode: 403,
        error: 'NO_ACTIVE_MEMBERSHIP: User holds no active memberships in any educational institution.'
      };
    }

    // If client requested a specific tenant, verify membership
    if (requestedOrgId) {
      const targetMembership = userMemberships.find(m => m.orgId === requestedOrgId);
      if (!targetMembership) {
        return {
          authenticated: false,
          statusCode: 403,
          error: `FORBIDDEN_TENANT_ACCESS: User '${user.id}' has no active membership in organization '${requestedOrgId}'. Client-supplied tenant ID rejected.`
        };
      }

      return {
        authenticated: true,
        context: {
          userId: user.id,
          orgId: targetMembership.orgId,
          role: targetMembership.role,
          departmentId: targetMembership.departmentId ?? null
        }
      };
    }

    // Default to user's first active membership
    const primary = userMemberships[0];
    return {
      authenticated: true,
      context: {
        userId: user.id,
        orgId: primary.orgId,
        role: primary.role,
        departmentId: primary.departmentId ?? null
      }
    };
  }
}
