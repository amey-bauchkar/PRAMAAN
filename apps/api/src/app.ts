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
import { AnchorService } from './services/anchor-service.js';
import { ExactCodeAnchorSchema, SourceSnapshotSchema } from '@pramaan/contracts';
import { getDbPool } from './db/pool.js';

export interface AppOptions {
  persistenceMode?: 'postgres' | 'in-memory';
  tenantRepository?: ITenantRepository;
  auditRepository?: IAuditRepository;
  consentRepository?: IConsentRepository;
  authService?: AuthService;
  userRepository?: IUserRepository;
  anchorService?: AnchorService;
  // Legacy / convenience options for tests:
  tenantStore?: TenantStore;
  auditService?: AuditService;
  consentService?: ConsentService;
}

export function buildApp(opts: AppOptions = {}): FastifyInstance & { persistenceMode?: 'postgres' | 'in-memory' } {
  const isProduction = process.env.NODE_ENV === 'production';

  // Production Fail-Closed Guards: In-memory fallback and missing database/JWT credentials strictly prohibited
  if (isProduction) {
    if (opts.persistenceMode === 'in-memory') {
      throw new Error('FATAL: Production mode prohibits in-memory persistenceMode.');
    }
    if (!process.env.DATABASE_URL) {
      throw new Error('FATAL: Production mode requires a valid DATABASE_URL. In-memory storage is prohibited.');
    }
    if (
      opts.tenantStore || 
      opts.auditService || 
      opts.consentService ||
      opts.tenantRepository ||
      opts.auditRepository ||
      opts.consentRepository ||
      opts.userRepository ||
      opts.anchorService
    ) {
      throw new Error(
        'FATAL: Production mode prohibits injecting custom repositories or mock stores. All production repositories must be constructed internally using the restricted runtime pool.'
      );
    }
    if (opts.authService) {
      throw new Error(
        'FATAL: Production mode prohibits injecting custom authService. Production authentication must use internally constructed AuthService with verified PostgreSQL repository and Supabase JWKS configuration.'
      );
    }
    if (!process.env.SUPABASE_URL && !process.env.SUPABASE_JWKS_URI && !process.env.SUPABASE_JWT_SECRET) {
      throw new Error('FATAL: Production mode requires Supabase JWT configuration (SUPABASE_URL, SUPABASE_JWKS_URI, or SUPABASE_JWT_SECRET).');
    }
  }

  // Explicit persistence mode selection
  if (opts.persistenceMode === 'postgres' && !process.env.DATABASE_URL) {
    throw new Error('FATAL: persistenceMode is set to \'postgres\' but DATABASE_URL is not configured.');
  }

  // Resolve active persistence mode:
  let activePersistenceMode: 'postgres' | 'in-memory';
  if (isProduction) {
    activePersistenceMode = 'postgres';
  } else if (opts.persistenceMode) {
    activePersistenceMode = opts.persistenceMode;
  } else if (
    opts.tenantStore || 
    opts.auditService || 
    opts.consentService ||
    opts.tenantRepository instanceof InMemoryTenantRepository ||
    opts.auditRepository instanceof InMemoryAuditRepository ||
    opts.consentRepository instanceof InMemoryConsentRepository ||
    opts.userRepository instanceof InMemoryUserRepository
  ) {
    activePersistenceMode = 'in-memory';
  } else if (process.env.DATABASE_URL) {
    activePersistenceMode = 'postgres';
  } else {
    activePersistenceMode = 'in-memory';
  }

  const app = Fastify({ logger: false }) as FastifyInstance & { persistenceMode?: 'postgres' | 'in-memory' };
  app.persistenceMode = activePersistenceMode;

  // Resolve repositories based on active persistence mode
  const usePostgres = activePersistenceMode === 'postgres';

  let tenantRepo: ITenantRepository;
  let auditRepo: IAuditRepository;
  let consentRepo: IConsentRepository;
  let userRepo: IUserRepository;

  if (isProduction) {
    // Production repositories are constructed strictly from restricted runtime pool
    const runtimePool = getDbPool();
    tenantRepo = new PgTenantRepository(runtimePool);
    auditRepo = new PgAuditRepository(runtimePool);
    consentRepo = new PgConsentRepository(runtimePool, auditRepo);
    userRepo = new PgUserRepository(runtimePool);
  } else {
    if (opts.tenantRepository) {
      tenantRepo = opts.tenantRepository;
    } else if (opts.tenantStore) {
      tenantRepo = new InMemoryTenantRepository(opts.tenantStore);
    } else if (usePostgres) {
      tenantRepo = new PgTenantRepository(getDbPool());
    } else {
      tenantRepo = new InMemoryTenantRepository(new TenantStore());
    }

    if (opts.auditRepository) {
      auditRepo = opts.auditRepository;
    } else if (opts.auditService) {
      auditRepo = new InMemoryAuditRepository(opts.auditService);
    } else if (usePostgres) {
      auditRepo = new PgAuditRepository(getDbPool());
    } else {
      auditRepo = new InMemoryAuditRepository(new AuditService());
    }

    if (opts.consentRepository) {
      consentRepo = opts.consentRepository;
    } else if (opts.consentService) {
      consentRepo = new InMemoryConsentRepository(opts.consentService);
    } else if (usePostgres) {
      consentRepo = new PgConsentRepository(getDbPool(), auditRepo);
    } else {
      const rawAudit = opts.auditService ?? new AuditService();
      consentRepo = new InMemoryConsentRepository(new ConsentService(rawAudit));
    }

    if (opts.userRepository) {
      userRepo = opts.userRepository;
    } else if (usePostgres) {
      userRepo = new PgUserRepository(getDbPool());
    } else {
      userRepo = new InMemoryUserRepository();
    }
  }

  const authService = isProduction
    ? new AuthService({ userRepository: userRepo })
    : (opts.authService ?? new AuthService({ userRepository: userRepo }));

  const anchorService = opts.anchorService ?? new AnchorService({
    auditRepo,
    consentRepo,
  });
  (app as any).anchorService = anchorService;

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
      persistenceMode: activePersistenceMode,
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

    return tenantRepo.listOrganizations(context);
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
      if (!grant) {
        return reply.status(404).send({ error: 'Grant not found.' });
      }
      const isDirectUserMatch = grant.studentId === context.userId;
      let isStudentRecMatch = false;
      if (!isDirectUserMatch) {
        const studentRec = await tenantRepo.getStudent(context, grant.studentId);
        if (studentRec && studentRec.userId === context.userId) {
          isStudentRecMatch = true;
        }
      }

      if (!isDirectUserMatch && !isStudentRecMatch) {
        return reply.status(403).send({
          error: 'FORBIDDEN_OWNERSHIP: Students may only revoke their own consent grants.'
        });
      }
    }

    const result = await consentRepo.revokeConsent(context, body.grantId, body.reason);
    if (!result.success) {
      const statusCode = result.error === 'Grant not found.' ? 404 : 400;
      return reply.status(statusCode).send(result);
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

  // ============================================================================
  // Milestone M2: Exact Code Anchor & Evidence Routes (P0-05)
  // ============================================================================

  // Evidence API: Resolve Exact Code Anchor
  // Positive RBAC: student (own anchors), officer, mentor, recruiter, platform_admin
  app.post('/api/evidence/anchors/resolve', async (req, reply) => {
    const context = await resolveSessionContext(req, reply);
    if (!context) return;

    const allowedRoles: UserRole[] = ['student', 'officer', 'mentor', 'recruiter', 'platform_admin'];
    if (!allowedRoles.includes(context.role as UserRole)) {
      return reply.status(403).send({
        error: `FORBIDDEN_ROLE: Role '${context.role}' cannot resolve code anchors.`
      });
    }

    const body = req.body as any;
    if (!body?.anchor) {
      return reply.status(400).send({ error: 'Missing required field: anchor' });
    }

    const parseResult = ExactCodeAnchorSchema.safeParse(body.anchor);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'INVALID_ANCHOR_SCHEMA',
        details: parseResult.error.format()
      });
    }

    let snapshot: any = undefined;
    if (body.snapshot) {
      const snapParse = SourceSnapshotSchema.safeParse(body.snapshot);
      if (!snapParse.success) {
        return reply.status(400).send({
          error: 'INVALID_SNAPSHOT_SCHEMA',
          details: snapParse.error.format()
        });
      }
      snapshot = snapParse.data;
    }

    const result = await anchorService.resolveAnchor(context, parseResult.data, snapshot);

    if (result.error === 'CROSS_TENANT_ACCESS_REJECTED' || result.error === 'FORBIDDEN_STUDENT_ACCESS') {
      return reply.status(403).send(result);
    }
    if (result.error === 'CONSENT_SERVICE_UNAVAILABLE' || result.error === 'TRUSTED_INGESTION_NOT_AVAILABLE') {
      return reply.status(503).send(result);
    }
    if (result.status === 'SNAPSHOT_NOT_FOUND' || result.status === 'FILE_NOT_FOUND') {
      return reply.status(404).send(result);
    }
    if (
      result.status === 'ANCHOR_INVALID' ||
      result.status === 'PARSER_VERSION_UNAVAILABLE' ||
      result.error === 'STUDENT_OWNERSHIP_REQUIRED' ||
      result.error === 'CONSENT_REQUIRED_OR_REVOKED' ||
      result.error === 'UNTRUSTED_CLIENT_SNAPSHOT'
    ) {
      return reply.status(422).send(result);
    }

    return reply.status(200).send(result);
  });

  // Evidence API: Register Immutable Source Snapshot
  // Positive RBAC: student, officer, platform_admin
  app.post('/api/evidence/snapshots', async (req, reply) => {
    const context = await resolveSessionContext(req, reply);
    if (!context) return;

    const allowedRoles: UserRole[] = ['student', 'officer', 'platform_admin'];
    if (!allowedRoles.includes(context.role as UserRole)) {
      return reply.status(403).send({
        error: `FORBIDDEN_ROLE: Role '${context.role}' cannot register source snapshots.`
      });
    }

    const body = req.body as any;
    if (!body?.snapshot) {
      return reply.status(400).send({ error: 'Missing required field: snapshot' });
    }

    const snapParse = SourceSnapshotSchema.safeParse(body.snapshot);
    if (!snapParse.success) {
      return reply.status(400).send({
        error: 'INVALID_SNAPSHOT_SCHEMA',
        details: snapParse.error.format()
      });
    }

    try {
      const regResult = await anchorService.registerSnapshot(context, snapParse.data);
      return reply.status(201).send(regResult);
    } catch (err: any) {
      if (err.message.startsWith('DURABLE_STORAGE_REQUIRED')) {
        return reply.status(503).send({ error: err.message });
      }
      if (err.message.startsWith('CONSENT_REQUIRED_OR_REVOKED') || err.message.startsWith('CONSENT_SERVICE_UNAVAILABLE')) {
        return reply.status(422).send({ error: err.message });
      }
      if (err.message.startsWith('INVALID_SNAPSHOT_PATH')) {
        return reply.status(400).send({ error: err.message });
      }
      return reply.status(400).send({ error: err.message });
    }
  });

  // Evidence API: Parse Source via Offline AST Parser
  // Positive RBAC: student, officer, mentor, platform_admin
  app.post('/api/evidence/parse', async (req, reply) => {
    const context = await resolveSessionContext(req, reply);
    if (!context) return;

    const allowedRoles: UserRole[] = ['student', 'officer', 'mentor', 'platform_admin'];
    if (!allowedRoles.includes(context.role as UserRole)) {
      return reply.status(403).send({
        error: `FORBIDDEN_ROLE: Role '${context.role}' cannot execute static parsing.`
      });
    }

    const body = req.body as any;
    if (!body?.filePath || body?.source === undefined) {
      return reply.status(400).send({ error: 'Missing required fields: filePath and source' });
    }

    const parseResult = anchorService.parseSource(body.source, body.filePath);
    if (!parseResult.success && parseResult.errors.some(e => e.startsWith('INVALID_FILE_PATH') || e.startsWith('UNSUPPORTED_FILE_TYPE'))) {
      return reply.status(400).send(parseResult);
    }

    return reply.status(200).send(parseResult);
  });

  return app;
}
