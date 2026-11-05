import {
  User,
  Membership,
  SessionContext
} from '@pramaan/contracts';
import { JwtVerifier, VerifiedTokenPayload } from './jwt-verifier.js';
import { IUserRepository, InMemoryUserRepository } from '../repositories/user-repository.js';

export interface AuthResolutionResult {
  authenticated: boolean;
  context?: SessionContext;
  tokenClaims?: VerifiedTokenPayload;
  statusCode?: number;
  error?: string;
}

export interface AuthServiceOptions {
  jwtVerifier?: JwtVerifier;
  userRepository?: IUserRepository;
}

export class AuthService {
  private jwtVerifier: JwtVerifier;
  private userRepository: IUserRepository;

  constructor(opts: AuthServiceOptions = {}) {
    this.jwtVerifier = opts.jwtVerifier ?? new JwtVerifier();
    this.userRepository = opts.userRepository ?? new InMemoryUserRepository();
  }

  public getJwtVerifier(): JwtVerifier {
    return this.jwtVerifier;
  }

  public getUserRepository(): IUserRepository {
    return this.userRepository;
  }

  // Delegation helpers for testing convenience
  public async registerUser(user: User): Promise<User> {
    return this.userRepository.registerUser(user);
  }

  public async addMembership(membership: Membership): Promise<Membership> {
    return this.userRepository.addMembership(membership);
  }

  /**
   * Resolves and verifies session context:
   * 1. Requires standard 'Authorization: Bearer <JWT>' header.
   * 2. Rejects plain user IDs, malformed tokens, or fallback headers (x-user-id).
   * 3. Cryptographically verifies JWT signature, expiry (exp), and claims.
   * 4. Resolves authenticated identity against PRAMAAN users and active memberships.
   * 5. Enforces tenant scope: requestedOrgId must match an active membership.
   * 6. Fails closed with 401/403 for any violation.
   */
  public async resolveContext(
    authHeader?: string,
    requestedOrgId?: string
  ): Promise<AuthResolutionResult> {
    // 1. Check for authorization header
    if (!authHeader || typeof authHeader !== 'string') {
      return {
        authenticated: false,
        statusCode: 401,
        error: 'AUTHENTICATION_REQUIRED: Missing Authorization header.'
      };
    }

    // 2. Enforce Bearer scheme (Reject plain user IDs or other schemes)
    if (!authHeader.startsWith('Bearer ')) {
      return {
        authenticated: false,
        statusCode: 401,
        error: 'INVALID_TOKEN_SCHEME: Authorization header must use Bearer scheme (Authorization: Bearer <JWT>).'
      };
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      return {
        authenticated: false,
        statusCode: 401,
        error: 'EMPTY_TOKEN: Bearer token is empty.'
      };
    }

    // 3. Cryptographic JWT Verification (Signature, Exp, Structure)
    const verifyResult = await this.jwtVerifier.verifyToken(token);
    if (!verifyResult.valid || !verifyResult.payload) {
      return {
        authenticated: false,
        statusCode: 401,
        error: `INVALID_OR_EXPIRED_JWT: ${verifyResult.error}`
      };
    }

    const claims = verifyResult.payload;
    const authSubject = claims.sub;

    // 4. Resolve Identity in Database strictly by verified authSubject (prevents email takeover)
    const userRecord = await this.userRepository.findByAuthSubject(authSubject);
    if (!userRecord || !userRecord.user) {
      return {
        authenticated: false,
        statusCode: 403,
        error: `UNREGISTERED_IDENTITY: Authenticated identity '${authSubject}' is not registered with any institution.`
      };
    }

    const user = userRecord.user;

    // 5. Evaluate Memberships & Tenancy
    const allMemberships = userRecord.memberships;
    const activeMemberships = allMemberships.filter(m => m.status === 'active');

    if (activeMemberships.length === 0) {
      const hasSuspended = allMemberships.some(m => m.status === 'suspended');
      const hasRevoked = allMemberships.some(m => m.status === 'revoked');
      const reason = hasSuspended ? 'Membership is suspended.' : hasRevoked ? 'Membership is revoked.' : 'User holds no active memberships in any educational institution.';
      return {
        authenticated: false,
        statusCode: 403,
        error: `NO_ACTIVE_MEMBERSHIP: ${reason}`
      };
    }

    // 6. Handle Client-Requested Tenant Scope
    if (requestedOrgId) {
      const targetMembership = activeMemberships.find(m => m.orgId === requestedOrgId);
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
        },
        tokenClaims: claims
      };
    }

    // 7. Default to User's Primary Active Membership
    const primary = activeMemberships[0];
    return {
      authenticated: true,
      context: {
        userId: user.id,
        orgId: primary.orgId,
        role: primary.role,
        departmentId: primary.departmentId ?? null
      },
      tokenClaims: claims
    };
  }
}
