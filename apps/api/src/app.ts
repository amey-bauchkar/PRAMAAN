import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { TenantStore } from './services/tenant-store.js';
import { AuditService } from './services/audit-service.js';
import { ConsentService } from './services/consent-service.js';
import { AuthService } from './services/auth-service.js';
import { SessionContext } from '@pramaan/contracts';
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

  // Organizations / Tenants (Protected: requires valid session)
  app.get('/api/tenants', async (req, reply) => {
    const context = await resolveSessionContext(req, reply);
    if (!context) return;

    return tenantRepo.listOrganizations();
  });

  // Students under RLS & RBAC
  app.get('/api/students', async (req, reply) => {
    const context = await resolveSessionContext(req, reply);
    if (!context) return;

    return tenantRepo.listStudents(context);
  });

  // Consent API: Grant
  app.post('/api/consent/grant', async (req, reply) => {
    const context = await resolveSessionContext(req, reply);
    if (!context) return;

    const body = req.body as any;

    if (!body?.studentId || !body?.purpose) {
      return reply.status(400).send({ error: 'Missing studentId or purpose' });
    }

    // Role & Ownership Guards:
    // 1. Placement officers cannot grant consent on behalf of students
    if (context.role === 'officer' || context.role === 'mentor') {
      return reply.status(403).send({
        error: 'FORBIDDEN_ROLE: Placement officers and mentors cannot grant consent on behalf of students.'
      });
    }

    // 2. Students may only grant consent for their own student identity
    if (context.role === 'student' && body.studentId !== context.userId) {
      // Check if studentId is the student's record id or user id
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

  // Consent API: Revoke
  app.post('/api/consent/revoke', async (req, reply) => {
    const context = await resolveSessionContext(req, reply);
    if (!context) return;

    const body = req.body as any;

    if (!body?.grantId) {
      return reply.status(400).send({ error: 'Missing grantId' });
    }

    const result = await consentRepo.revokeConsent(context, body.grantId, body.reason);
    if (!result.success) {
      return reply.status(400).send(result);
    }

    return reply.send(result);
  });

  // Audit API: List (Restricted to officers, platform admins, university admins)
  app.get('/api/audit', async (req, reply) => {
    const context = await resolveSessionContext(req, reply);
    if (!context) return;

    if (context.role === 'student') {
      return reply.status(403).send({
        error: 'FORBIDDEN_ROLE: Audit ledger access is restricted to placement officers and compliance auditors.'
      });
    }

    return auditRepo.getEventsForTenant(context);
  });

  // Audit API: Verify Cryptographic Chain (Restricted to officers and admins)
  app.get('/api/audit/verify', async (req, reply) => {
    const context = await resolveSessionContext(req, reply);
    if (!context) return;

    if (context.role === 'student') {
      return reply.status(403).send({
        error: 'FORBIDDEN_ROLE: Audit chain verification is restricted to placement officers and compliance auditors.'
      });
    }

    return auditRepo.verifyIntegrity(context);
  });

  return app;
}
