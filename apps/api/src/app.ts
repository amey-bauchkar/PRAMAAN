import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { TenantStore } from './services/tenant-store.js';
import { AuditService } from './services/audit-service.js';
import { ConsentService } from './services/consent-service.js';
import { AuthService } from './services/auth-service.js';
import { SessionContext, UserRole } from '@pramaan/contracts';
import { ITenantRepository, InMemoryTenantRepository, PgTenantRepository } from './repositories/tenant-repository.js';
import { IAuditRepository, InMemoryAuditRepository, PgAuditRepository } from './repositories/audit-repository.js';
import { IConsentRepository, InMemoryConsentRepository, PgConsentRepository } from './repositories/consent-repository.js';
import { IUserRepository, InMemoryUserRepository, PgUserRepository } from './repositories/user-repository.js';
import { getDbPool } from './db/pool.js';

export interface AppOptions {
  tenantRepository?: ITenantRepository;
  auditRepository?: IAuditRepository;
  consentRepository?: IConsentRepository;
  authService?: AuthService;
  userRepository?: IUserRepository;
  // Legacy / convenience options for tests:
  tenantStore?: TenantStore;
  auditService?: AuditService;
  consentService?: ConsentService;
}

export function buildApp(opts: AppOptions = {}): FastifyInstance {
  const isProduction = process.env.NODE_ENV === 'production';

  // Production Fail-Closed Guards: In-memory fallback and missing database/JWT credentials strictly prohibited
  if (isProduction) {
    if (!process.env.DATABASE_URL) {
      throw new Error('FATAL: Production mode requires a valid DATABASE_URL. In-memory storage is prohibited.');
    }
    if (
      opts.tenantStore || 
      opts.auditService || 
      opts.consentService ||
      opts.tenantRepository instanceof InMemoryTenantRepository ||
      opts.auditRepository instanceof InMemoryAuditRepository ||
      opts.consentRepository instanceof InMemoryConsentRepository ||
      opts.userRepository instanceof InMemoryUserRepository
    ) {
      throw new Error('FATAL: Production mode prohibits in-memory repositories or mock stores.');
    }
    if (!process.env.SUPABASE_URL && !process.env.SUPABASE_JWKS_URI && !process.env.SUPABASE_JWT_SECRET) {
      throw new Error('FATAL: Production mode requires Supabase JWT configuration (SUPABASE_URL, SUPABASE_JWKS_URI, or SUPABASE_JWT_SECRET).');
    }
  }

  const app = Fastify({ logger: false });

  // Resolve repositories (PostgreSQL if DATABASE_URL configured and not explicitly using memory/legacy opts)
  const isPostgresConfigured = Boolean(process.env.DATABASE_URL) && !opts.tenantStore && !opts.tenantRepository;

  let tenantRepo: ITenantRepository;
  let auditRepo: IAuditRepository;
  let consentRepo: IConsentRepository;
  let userRepo: IUserRepository;

  if (opts.tenantRepository) {
    tenantRepo = opts.tenantRepository;
  } else if (opts.tenantStore) {
    tenantRepo = new InMemoryTenantRepository(opts.tenantStore);
  } else if (isPostgresConfigured) {
    tenantRepo = new PgTenantRepository(getDbPool());
  } else {
    tenantRepo = new InMemoryTenantRepository(new TenantStore());
  }

  if (opts.auditRepository) {
    auditRepo = opts.auditRepository;
  } else if (opts.auditService) {
    auditRepo = new InMemoryAuditRepository(opts.auditService);
  } else if (isPostgresConfigured) {
    auditRepo = new PgAuditRepository(getDbPool());
  } else {
    auditRepo = new InMemoryAuditRepository(new AuditService());
  }

  if (opts.consentRepository) {
    consentRepo = opts.consentRepository;
  } else if (opts.consentService) {
    consentRepo = new InMemoryConsentRepository(opts.consentService);
  } else if (isPostgresConfigured) {
    consentRepo = new PgConsentRepository(getDbPool(), auditRepo);
  } else {
    const rawAudit = opts.auditService ?? new AuditService();
    consentRepo = new InMemoryConsentRepository(new ConsentService(rawAudit));
  }

  if (opts.userRepository) {
    userRepo = opts.userRepository;
  } else if (isPostgresConfigured) {
    userRepo = new PgUserRepository(getDbPool());
  } else {
    userRepo = new InMemoryUserRepository();
  }

  const authService = opts.authService ?? new AuthService({ userRepository: userRepo });

  app.register(cors, { origin: true });

  app.register(swagger, {
    openapi: {
      info: {
        title: 'PRAMAAN Placement Intelligence API',
        description: 'Skills you can defend. Evidence recruiters can trust.',
        version: '1.0.0'
      }
    }
  });

  app.register(swaggerUi, {
    routePrefix: '/docs'
  });

  // Health endpoint (Public)
  app.get('/health', async () => {
    return {
      status: 'healthy',
      service: 'pramaan-api',
      timestamp: new Date().toISOString()
    };
  });

  // Helper to extract & cryptographically verify session context
  const resolveSessionContext = async (req: FastifyRequest, reply: FastifyReply): Promise<SessionContext | null> => {
    const authHeader = req.headers['authorization'];
    const requestedOrgId = req.headers['x-org-id'] as string | undefined;

    const authRes = await authService.resolveContext(authHeader, requestedOrgId);
    if (!authRes.authenticated || !authRes.context) {
      reply.status(authRes.statusCode || 401).send({ error: authRes.error });
      return null;
    }
    return authRes.context;
  };

  // Organizations / Tenants (Protected: requires valid session, returns discovery DTO only)
  app.get('/api/tenants', async (req, reply) => {
    const context = await resolveSessionContext(req, reply);
    if (!context) return;

    return tenantRepo.listOrganizations();
  });

  // Students under RLS & Positive RBAC Allowlists
  // Allowed: student (own record only), officer (cohort), mentor (cohort)
  app.get('/api/students', async (req, reply) => {
    const context = await resolveSessionContext(req, reply);
    if (!context) return;

    const allowedRoles: UserRole[] = ['student', 'officer', 'mentor'];
    if (!allowedRoles.includes(context.role as UserRole)) {
      return reply.status(403).send({
        error: `FORBIDDEN_ROLE: Role '${context.role}' is not authorized to list students.`
      });
    }

    const students = await tenantRepo.listStudents(context);

    // If caller is student, return strictly their own student record
    if (context.role === 'student') {
      return students.filter(s => s.userId === context.userId);
    }

    return students;
  });

  // Consent API: Grant (Restricted strictly to students for their own identity)
  app.post('/api/consent/grant', async (req, reply) => {
    const context = await resolveSessionContext(req, reply);
    if (!context) return;

    const body = req.body as any;

    if (!body?.studentId || !body?.purpose) {
      return reply.status(400).send({ error: 'Missing studentId or purpose' });
    }

    // Positive RBAC: Student ONLY
    if (context.role !== 'student') {
      return reply.status(403).send({
        error: 'FORBIDDEN_ROLE: Placement officers and mentors cannot grant consent on behalf of students. Only students may grant consent for their own data.'
      });
    }

    // Ownership check: studentId must belong to the authenticated student
    if (body.studentId !== context.userId) {
      const studentRec = await tenantRepo.getStudent(context, body.studentId);
      if (!studentRec || studentRec.userId !== context.userId) {
        return reply.status(403).send({
          error: 'FORBIDDEN_OWNERSHIP: Students may only grant consent for their own account.'
        });
      }
    }

    const grant = await consentRepo.grantConsent(
      context,
      body.studentId,
      body.purpose,
      body.noticeVersion || 1,
      body.scope || {}
    );

    return reply.status(201).send(grant);
  });

  // Consent API: Revoke (Allowed for student [own grant] or officer [documented reason])
  app.post('/api/consent/revoke', async (req, reply) => {
    const context = await resolveSessionContext(req, reply);
    if (!context) return;

    const allowedRoles: UserRole[] = ['student', 'officer'];
    if (!allowedRoles.includes(context.role as UserRole)) {
      return reply.status(403).send({
        error: `FORBIDDEN_ROLE: Role '${context.role}' cannot revoke consent.`
      });
    }

    const body = req.body as any;

    if (!body?.grantId) {
      return reply.status(400).send({ error: 'Missing grantId' });
    }

    if (context.role === 'officer' && (!body.reason || typeof body.reason !== 'string' || body.reason.trim() === '')) {
      return reply.status(400).send({
        error: 'OFFICER_REASON_REQUIRED: Placement officers must supply a documented reason for revoking student consent.'
      });
    }

    if (context.role === 'student') {
      const grant = await consentRepo.getGrant(context, body.grantId);
      if (grant) {
        const studentRec = await tenantRepo.getStudent(context, grant.studentId);
        if (studentRec && studentRec.userId !== context.userId) {
          return reply.status(403).send({
            error: 'FORBIDDEN_OWNERSHIP: Students may only revoke their own consent grants.'
          });
        }
      }
    }

    const result = await consentRepo.revokeConsent(context, body.grantId, body.reason);
    if (!result.success) {
      return reply.status(400).send(result);
    }

    return reply.send(result);
  });

  // Audit API: List (Restricted strictly to officer, platform_admin, university_admin)
  app.get('/api/audit', async (req, reply) => {
    const context = await resolveSessionContext(req, reply);
    if (!context) return;

    const allowedRoles: UserRole[] = ['officer', 'platform_admin', 'university_admin'];
    if (!allowedRoles.includes(context.role as UserRole)) {
      return reply.status(403).send({
        error: `FORBIDDEN_ROLE: Audit ledger access is restricted to placement officers and compliance auditors.`
      });
    }

    return auditRepo.getEventsForTenant(context);
  });

  // Audit API: Verify Cryptographic Chain (Restricted strictly to officer, platform_admin)
  app.get('/api/audit/verify', async (req, reply) => {
    const context = await resolveSessionContext(req, reply);
    if (!context) return;

    const allowedRoles: UserRole[] = ['officer', 'platform_admin'];
    if (!allowedRoles.includes(context.role as UserRole)) {
      return reply.status(403).send({
        error: `FORBIDDEN_ROLE: Audit chain verification is restricted to placement officers and platform administrators.`
      });
    }

    return auditRepo.verifyIntegrity(context);
  });

  return app;
}
