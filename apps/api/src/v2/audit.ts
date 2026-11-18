import { randomUUID } from 'crypto';
import { AuditEvent, SessionContext } from '@pramaan/contracts';
import { AuditChain } from '@pramaan/domain';
import { Sql } from './db.js';

/**
 * Appends a hash-chained audit event inside the caller's transaction, serialised per college with an
 * advisory lock (same algorithm as PgAuditRepository.logInTransaction).
 */
export async function audit(
  sql: Sql, ctx: SessionContext, action: string, objectType: string, objectId: string | null, metadata: Record<string, unknown> = {}
): Promise<void> {
  await sql.query(`SELECT pg_advisory_xact_lock(hashtext('audit_chain'), hashtext($1))`, [ctx.orgId]);
  const last = await sql.query<{ seq: string; hash: string }>(
    `SELECT seq, hash FROM audit_events WHERE org_id = $1 ORDER BY seq DESC LIMIT 1`, [ctx.orgId]);
  const prevSeq = last.rows[0] ? Number(last.rows[0].seq) : 0;
  const prevHash = last.rows[0]?.hash ?? AuditChain.GENESIS_HASH;
  const raw: Omit<AuditEvent, 'hash'> = {
    id: randomUUID(),
    seq: prevSeq + 1,
    orgId: ctx.orgId,
    actorType: ['student', 'officer', 'mentor', 'college_admin', 'dept_coordinator', 'recruiter', 'university_admin'].includes(ctx.role) ? 'user' : 'service',
    actorId: ctx.actorUserId ?? ctx.userId,
    action,
    objectType,
    objectId,
    metadata,
    prevHash,
    occurredAt: new Date().toISOString(),
  } as Omit<AuditEvent, 'hash'>;
  const hash = AuditChain.calculateHash(raw);
  await sql.query(
    `INSERT INTO audit_events (id, seq, org_id, actor_type, actor_id, action, object_type, object_id, metadata, prev_hash, hash, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [raw.id, raw.seq, raw.orgId, raw.actorType, raw.actorId, action, objectType, objectId, JSON.stringify(metadata), prevHash, hash, raw.occurredAt]);
}

export interface AgentProposal {
  kind: string;
  title: string;
  rationale: string;
  payload: Record<string, unknown>;
  targetStudentId?: string | null;
}

/**
 * Records one agent run: an agent_runs row, one agent_actions row per tool call, and inert proposals that
 * wait in the officer's inbox. Agents never write candidacy-affecting state directly.
 */
export async function recordAgentRun(
  sql: Sql, ctx: SessionContext, agentName: string,
  actions: { tool: string; input: Record<string, unknown>; output: Record<string, unknown> }[],
  proposals: AgentProposal[],
  modelVersion = 'deterministic-rules-v1'
): Promise<{ runId: string; proposalIds: string[] }> {
  const runId = randomUUID();
  await sql.query(`INSERT INTO agent_runs (id, org_id, agent_name, model_version, prompt_version, status) VALUES ($1,$2,$3,$4,'v1','completed')`,
    [runId, ctx.orgId, agentName, modelVersion]);
  for (const a of actions) {
    await sql.query(`INSERT INTO agent_actions (org_id, agent_run_id, agent_name, tool, input_summary, output_summary) VALUES ($1,$2,$3,$4,$5,$6)`,
      [ctx.orgId, runId, agentName, a.tool, JSON.stringify(a.input), JSON.stringify(a.output)]);
  }
  const ids: string[] = [];
  for (const p of proposals) {
    const id = randomUUID();
    await sql.query(
      `INSERT INTO proposals (id, agent_run_id, kind, payload, title, rationale, target_student_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, runId, p.kind, JSON.stringify(p.payload), p.title, p.rationale, p.targetStudentId ?? null]);
    ids.push(id);
  }
  await audit(sql, ctx, 'AGENT_RUN', 'agent_run', runId, { agentName, actions: actions.length, proposals: proposals.length, modelVersion });
  return { runId, proposalIds: ids };
}
