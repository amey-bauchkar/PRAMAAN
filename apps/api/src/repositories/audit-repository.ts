import pg from 'pg';
import { randomUUID } from 'crypto';
import { AuditEvent, SessionContext } from '@pramaan/contracts';
import { AuditChain, AuditChainVerificationResult, VerifyChainOptions } from '@pramaan/domain';
import { withTenantTransaction, getDbPool } from '../db/pool.js';
import { AuditService } from '../services/audit-service.js';

export interface IAuditRepository {
  log(
    context: SessionContext,
    action: string,
    objectType: string,
    objectId?: string | null,
    metadata?: Record<string, unknown>
  ): Promise<AuditEvent>;
  logInTransaction?(
    client: pg.PoolClient,
    context: SessionContext,
    action: string,
    objectType: string,
    objectId?: string | null,
    metadata?: Record<string, unknown>
  ): Promise<AuditEvent>;
  getEventsForTenant(context: SessionContext): Promise<AuditEvent[]>;
  verifyIntegrity(context: SessionContext, options?: VerifyChainOptions): Promise<AuditChainVerificationResult>;
}

export class InMemoryAuditRepository implements IAuditRepository {
  constructor(private service: AuditService = new AuditService()) {}

  public async log(
    context: SessionContext,
    action: string,
    objectType: string,
    objectId: string | null = null,
    metadata: Record<string, unknown> = {}
  ): Promise<AuditEvent> {
    return this.service.log(context, action, objectType, objectId, metadata);
  }

  public async logInTransaction(
    _client: pg.PoolClient,
    context: SessionContext,
    action: string,
    objectType: string,
    objectId: string | null = null,
    metadata: Record<string, unknown> = {}
  ): Promise<AuditEvent> {
    return this.log(context, action, objectType, objectId, metadata);
  }

  public async getEventsForTenant(context: SessionContext): Promise<AuditEvent[]> {
    return this.service.getEventsForTenant(context);
  }

  public async verifyIntegrity(_context?: SessionContext, options?: VerifyChainOptions): Promise<AuditChainVerificationResult> {
    return this.service.verifyIntegrity(options);
  }

  public getService(): AuditService {
    return this.service;
  }
}

export class PgAuditRepository implements IAuditRepository {
  constructor(private pool: pg.Pool = getDbPool()) {}

  /**
   * Transaction-aware audit event logging that executes on an existing pg.PoolClient.
   * Serializes audit writes per tenant using a transaction-scoped advisory lock (pg_advisory_xact_lock)
   * to guarantee deterministic sequencing and prevent cryptographic chain forks.
   */
  public async logInTransaction(
    client: pg.PoolClient,
    context: SessionContext,
    action: string,
    objectType: string,
    objectId: string | null = null,
    metadata: Record<string, unknown> = {}
  ): Promise<AuditEvent> {
    // 1. Transaction-scoped advisory lock: serializes writes strictly per tenant org_id
    // Automatically released at COMMIT or ROLLBACK.
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext('audit_chain'), hashtext($1));`,
      [context.orgId]
    );

    // 2. Fetch latest audit event for this tenant to establish cryptographic hash link
    const lastRes = await client.query(`
      SELECT seq, hash 
      FROM audit_events 
      WHERE org_id = $1 
      ORDER BY seq DESC 
      LIMIT 1;
    `, [context.orgId]);

    const prevSeq = lastRes.rows.length > 0 ? Number(lastRes.rows[0].seq) : 0;
    const prevHash = lastRes.rows.length > 0 ? lastRes.rows[0].hash : AuditChain.GENESIS_HASH;
    const nextSeq = prevSeq + 1;

    const actorType = context.role === 'student' || context.role === 'officer' || context.role === 'mentor' 
      ? 'user' 
      : 'service';

    const actorId = context.actorUserId ?? context.userId;

    const eventId = randomUUID();
    const occurredAt = new Date().toISOString();

    const rawEvent: Omit<AuditEvent, 'hash'> = {
      id: eventId,
      seq: nextSeq,
      orgId: context.orgId,
      actorType,
      actorId,
      action,
      objectType,
      objectId,
      metadata,
      prevHash,
      occurredAt
    };

    const hash = AuditChain.calculateHash(rawEvent);

    // 3. Insert into audit_events (append-only)
    await client.query(`
      INSERT INTO audit_events (
        id, seq, org_id, actor_type, actor_id, action, object_type, object_id, metadata, prev_hash, hash, occurred_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
      );
    `, [
      eventId,
      nextSeq,
      context.orgId,
      actorType,
      actorId,
      action,
      objectType,
      objectId,
      JSON.stringify(metadata),
      prevHash,
      hash,
      occurredAt
    ]);

    return {
      ...rawEvent,
      hash
    };
  }

  public async log(
    context: SessionContext,
    action: string,
    objectType: string,
    objectId: string | null = null,
    metadata: Record<string, unknown> = {}
  ): Promise<AuditEvent> {
    return withTenantTransaction(context, async (client) => {
      return this.logInTransaction(client, context, action, objectType, objectId, metadata);
    }, this.pool);
  }

  public async getEventsForTenant(context: SessionContext): Promise<AuditEvent[]> {
    return withTenantTransaction(context, async (client) => {
      const res = await client.query(`
        SELECT id, seq, org_id as "orgId", actor_type as "actorType", actor_id as "actorId",
               action, object_type as "objectType", object_id as "objectId", metadata,
               prev_hash as "prevHash", hash, occurred_at as "occurredAt"
        FROM audit_events
        WHERE org_id = $1
        ORDER BY seq ASC;
      `, [context.orgId]);

      return res.rows.map(r => ({
        ...r,
        seq: Number(r.seq),
        metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata,
        occurredAt: new Date(r.occurredAt).toISOString()
      }));
    }, this.pool);
  }

  public async verifyIntegrity(context: SessionContext, options?: VerifyChainOptions): Promise<AuditChainVerificationResult> {
    const events = await this.getEventsForTenant(context);
    return AuditChain.verifyChain(events, options);
  }
}
