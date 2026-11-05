import pg from 'pg';
import { randomUUID } from 'crypto';
import { AuditEvent, SessionContext } from '@pramaan/contracts';
import { AuditChain } from '@pramaan/domain';
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
  getEventsForTenant(context: SessionContext): Promise<AuditEvent[]>;
  verifyIntegrity(context: SessionContext): Promise<{ valid: boolean; brokenAtSeq?: number; error?: string }>;
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

  public async getEventsForTenant(context: SessionContext): Promise<AuditEvent[]> {
    return this.service.getEventsForTenant(context);
  }

  public async verifyIntegrity(): Promise<{ valid: boolean; brokenAtSeq?: number; error?: string }> {
    return this.service.verifyIntegrity();
  }

  public getService(): AuditService {
    return this.service;
  }
}

export class PgAuditRepository implements IAuditRepository {
  constructor(private pool: pg.Pool = getDbPool()) {}

  public async log(
    context: SessionContext,
    action: string,
    objectType: string,
    objectId: string | null = null,
    metadata: Record<string, unknown> = {}
  ): Promise<AuditEvent> {
    return withTenantTransaction(context, async (client) => {
      // 1. Fetch latest audit event for this tenant to establish hash chain link
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

      const eventId = randomUUID();
      const occurredAt = new Date().toISOString();

      const rawEvent: Omit<AuditEvent, 'hash'> = {
        id: eventId,
        seq: nextSeq,
        orgId: context.orgId,
        actorType,
        actorId: context.userId,
        action,
        objectType,
        objectId,
        metadata,
        prevHash,
        occurredAt
      };

      const hash = AuditChain.calculateHash(rawEvent);

      // 2. Insert into audit_events (append-only)
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
        context.userId,
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
    }, this.pool);
  }

  public async getEventsForTenant(context: SessionContext): Promise<AuditEvent[]> {
    return withTenantTransaction(context, async (client) => {
      const res = await client.query(`
        SELECT id, seq, org_id, actor_type, actor_id, action, object_type, object_id, metadata, prev_hash, hash, occurred_at
        FROM audit_events
        WHERE org_id = $1
        ORDER BY seq ASC;
      `, [context.orgId]);

      return res.rows.map(row => ({
        id: row.id,
        seq: Number(row.seq),
        orgId: row.org_id,
        actorType: row.actor_type,
        actorId: row.actor_id,
        action: row.action,
        objectType: row.object_type,
        objectId: row.object_id,
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
        prevHash: row.prev_hash,
        hash: row.hash,
        occurredAt: new Date(row.occurred_at).toISOString()
      }));
    }, this.pool);
  }

  public async verifyIntegrity(context: SessionContext): Promise<{ valid: boolean; brokenAtSeq?: number; error?: string }> {
    const events = await this.getEventsForTenant(context);
    return AuditChain.verifyChain(events);
  }
}
