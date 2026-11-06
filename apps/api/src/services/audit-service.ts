import { randomUUID } from 'crypto';
import { AuditEvent, SessionContext } from '@pramaan/contracts';
import { AuditChain, AuditChainVerificationResult, VerifyChainOptions } from '@pramaan/domain';

export class AuditService {
  private events: AuditEvent[] = [];
  private currentSeq = 0;

  /**
   * Appends an audit event to the ledger with cryptographic hash chaining.
   */
  public log(
    context: SessionContext,
    action: string,
    objectType: string,
    objectId: string | null = null,
    metadata: Record<string, unknown> = {}
  ): AuditEvent {
    this.currentSeq += 1;
    const prevHash = this.events.length > 0 
      ? this.events[this.events.length - 1].hash 
      : AuditChain.GENESIS_HASH;

    const rawEvent: Omit<AuditEvent, 'hash'> = {
      id: randomUUID(),
      seq: this.currentSeq,
      orgId: context.orgId,
      actorType: context.role === 'student' || context.role === 'officer' || context.role === 'mentor' 
        ? 'user' 
        : 'service',
      actorId: context.userId,
      action,
      objectType,
      objectId,
      metadata,
      prevHash,
      occurredAt: new Date().toISOString()
    };

    const hash = AuditChain.calculateHash(rawEvent);
    const event: AuditEvent = { ...rawEvent, hash };
    this.events.push(event);
    return event;
  }

  /**
   * Retrieves audit events strictly within the tenant's context (RLS-12).
   */
  public getEventsForTenant(context: SessionContext): AuditEvent[] {
    return this.events.filter(e => e.orgId === context.orgId);
  }

  /**
   * Verifies the cryptographic chain across all recorded events.
   */
  public verifyIntegrity(options?: VerifyChainOptions): AuditChainVerificationResult {
    return AuditChain.verifyChain(this.events, options);
  }

  /**
   * Internal test helper for simulating tampering.
   */
  public __tamperWithEvent(seq: number, tamperedAction: string) {
    const event = this.events.find(e => e.seq === seq);
    if (event) {
      event.action = tamperedAction;
    }
  }
}

