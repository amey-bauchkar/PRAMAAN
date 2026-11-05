import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { TenantStore } from './services/tenant-store.js';
import { AuditService } from './services/audit-service.js';
import { ConsentService } from './services/consent-service.js';
import { AuthService } from './services/auth-service.js';
import { SessionContext } from '@pramaan/contracts';

export interface AppOptions {
  tenantStore?: TenantStore;
  auditService?: AuditService;
  consentService?: ConsentService;
  authService?: AuthService;
}

export function buildApp(opts: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });

  const tenantStore = opts.tenantStore ?? new TenantStore();
  const auditService = opts.auditService ?? new AuditService();
  const consentService = opts.consentService ?? new ConsentService(auditService);
  const authService = opts.authService ?? new AuthService();

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

  // Helper to extract session context strictly via AuthService
  const resolveSessionContext = (req: FastifyRequest, reply: FastifyReply): SessionContext | null => {
    const authHeader = (req.headers['authorization'] as string) || (req.headers['x-user-id'] as string);
    const requestedOrgId = req.headers['x-org-id'] as string | undefined;

    const authRes = authService.resolveContext(authHeader, requestedOrgId);
    if (!authRes.authenticated || !authRes.context) {
      reply.status(authRes.statusCode || 401).send({ error: authRes.error });
      return null;
    }
    return authRes.context;
  };

  // Organizations / Tenants
  app.get('/api/tenants', async () => {
    return tenantStore.listOrganizations();
  });

  // Students under RLS
  app.get('/api/students', async (req, reply) => {
    const context = resolveSessionContext(req, reply);
    if (!context) return;
    return tenantStore.listStudents(context);
  });

  // Consent API
  app.post('/api/consent/grant', async (req, reply) => {
    const context = resolveSessionContext(req, reply);
    if (!context) return;

    const body = req.body as any;

    if (!body?.studentId || !body?.purpose) {
      return reply.status(400).send({ error: 'Missing studentId or purpose' });
    }

    const grant = consentService.grantConsent(
      context,
      body.studentId,
      body.purpose,
      body.noticeVersion || 1,
      body.scope || {}
    );

    return reply.status(201).send(grant);
  });

  app.post('/api/consent/revoke', async (req, reply) => {
    const context = resolveSessionContext(req, reply);
    if (!context) return;

    const body = req.body as any;

    if (!body?.grantId) {
      return reply.status(400).send({ error: 'Missing grantId' });
    }

    const result = await consentService.revokeConsent(context, body.grantId, body.reason);
    if (!result.success) {
      return reply.status(400).send(result);
    }

    return reply.send(result);
  });

  // Audit API
  app.get('/api/audit', async (req, reply) => {
    const context = resolveSessionContext(req, reply);
    if (!context) return;
    return auditService.getEventsForTenant(context);
  });

  app.get('/api/audit/verify', async () => {
    return auditService.verifyIntegrity();
  });

  return app;
}

