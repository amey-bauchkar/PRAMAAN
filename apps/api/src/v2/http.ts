import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SessionContext, UserRole } from '@pramaan/contracts';
import { Db, Sql } from './db.js';

export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) {
    super(message);
  }
}

export const OFFICER_ROLES: UserRole[] = ['officer', 'college_admin', 'dept_coordinator', 'platform_admin'];
export const STAFF_ROLES: UserRole[] = [...OFFICER_ROLES, 'mentor'];

/** Maps database errors to HTTP responses without leaking internals. */
export function mapDbError(err: any): HttpError | null {
  const code = err?.code as string | undefined;
  const msg = String(err?.message ?? '');
  if (code === '23P01') return new HttpError(409, 'Time clash: this booking overlaps another booking for the same room, panel or student.', 'CLASH');
  if (code === '23505') return new HttpError(409, 'That record already exists.', 'DUPLICATE');
  if (code === '23514') return new HttpError(400, 'The data breaks a validation rule.', 'CHECK_VIOLATION');
  if (code === '23503') return new HttpError(400, 'A referenced record does not exist.', 'FK_VIOLATION');
  if (code === '42501') return new HttpError(403, 'Not permitted for your role or college.', 'RLS_DENIED');
  if (code === 'P0001' || msg.includes('invariant violation') || msg.startsWith('FORBIDDEN')) {
    const status = msg.startsWith('FORBIDDEN') ? 403 : 400;
    return new HttpError(status, msg.replace(/^FORBIDDEN:\s*/, ''), 'RULE');
  }
  return null;
}

export interface HandlerArgs<B = any> {
  ctx: SessionContext;
  sql: Sql;
  body: B;
  query: Record<string, string | undefined>;
  params: Record<string, string>;
  req: FastifyRequest;
  reply: FastifyReply;
}

export type Handler<B = any> = (a: HandlerArgs<B>) => Promise<unknown>;

export interface RouterDeps {
  db: Db;
  resolveSession: (req: FastifyRequest, reply: FastifyReply) => Promise<SessionContext | null>;
}

/**
 * Registers a v2 route: authenticates, checks the role allowlist, runs the handler inside one tenant
 * transaction (RLS on), and maps errors. A thrown HttpError or database error rolls the transaction back.
 */
export function createRouter(app: FastifyInstance, deps: RouterDeps) {
  const register = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, roles: readonly UserRole[], handler: Handler, opts: { raw?: boolean } = {}) => {
    app.route({
      method, url,
      handler: async (req, reply) => {
        const ctx = await deps.resolveSession(req, reply);
        if (!ctx) return;
        if (!roles.includes(ctx.role)) {
          return reply.status(403).send({ error: `FORBIDDEN_ROLE: ${ctx.role} cannot use this endpoint.` });
        }
        try {
          const out = await deps.db.withTenant(ctx, sql => handler({
            ctx, sql, body: (req.body ?? {}) as any, query: (req.query ?? {}) as any, params: (req.params ?? {}) as any, req, reply,
          }));
          if (opts.raw) return out;
          return reply.status(200).send(out ?? { ok: true });
        } catch (err: any) {
          const mapped = err instanceof HttpError ? err : mapDbError(err);
          if (mapped) return reply.status(mapped.status).send({ error: mapped.message, code: mapped.code });
          req.log.error(err); if (process.env.DEBUG_V2_ERRORS) console.error(err);
          return reply.status(500).send({ error: 'Unexpected server error.' });
        }
      },
    });
  };
  return {
    get: (url: string, roles: readonly UserRole[], h: Handler, o?: { raw?: boolean }) => register('GET', url, roles, h, o),
    post: (url: string, roles: readonly UserRole[], h: Handler, o?: { raw?: boolean }) => register('POST', url, roles, h, o),
    patch: (url: string, roles: readonly UserRole[], h: Handler, o?: { raw?: boolean }) => register('PATCH', url, roles, h, o),
  };
}

export type Router = ReturnType<typeof createRouter>;

export function requireString(v: unknown, name: string, min = 1, max = 5000): string {
  if (typeof v !== 'string' || v.trim().length < min || v.length > max) {
    throw new HttpError(400, `${name} is required${min > 1 ? ` (at least ${min} characters)` : ''}.`);
  }
  return v.trim();
}

export function requireUuid(v: unknown, name: string): string {
  if (typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    throw new HttpError(400, `${name} must be a valid id.`);
  }
  return v;
}

export async function one<T>(sql: Sql, text: string, params: unknown[] = [], notFound = 'Not found.'): Promise<T> {
  const r = await sql.query<T>(text, params);
  if (r.rows.length === 0) throw new HttpError(404, notFound);
  return r.rows[0];
}

/** The membership id of the caller in the current college (staff actions are attributed to it). */
export async function membershipId(sql: Sql, ctx: SessionContext): Promise<string> {
  const r = await sql.query<{ id: string }>(
    `SELECT id FROM memberships WHERE user_id = $1 AND org_id = $2 AND role = $3 AND status = 'active' LIMIT 1`,
    [ctx.userId, ctx.orgId, ctx.role]);
  if (!r.rows[0]) throw new HttpError(403, 'No active membership in this college.');
  return r.rows[0].id;
}
