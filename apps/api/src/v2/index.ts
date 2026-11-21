import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SessionContext } from '@pramaan/contracts';
import { Db } from './db.js';
import { Judge } from './judge.js';
import { createRouter } from './http.js';
import { ExternalProfileAdapter, IssuerConfig } from './config.js';
import { registerStudentRoutes, registerPublicRoutes, StudentDeps } from './routes-student.js';
import { registerTpoRoutes } from './routes-tpo.js';
import { registerRecruiterRoutes } from './routes-recruiter.js';
import { registerPassRoutes } from './routes-passes.js';
import { registerLedgerRoutes } from './routes-ledger.js';
import { registerInviteRoutes, registerClaimRoute } from './routes-invites.js';
import { registerKitRoutes, KitDeps } from './routes-kit.js';
import { configureLedger } from './ledger.js';
import type { DomainFetcher } from './domain-proof.js';
import { Mailer, createMailerFromEnv } from './mailer.js';
import { FailoverLlm, createLlmFromEnv } from './llm.js';
import { CoverageJudge, createCoverageJudgeFromEnv } from './interview-judge.js';

export interface V2Deps {
  db: Db;
  judge: Judge;
  profiles: ExternalProfileAdapter;
  issuer: IssuerConfig | null;
  /** Outgoing mail. Defaults to SMTP from the environment; without SMTP_HOST nothing is sent. */
  mailer?: Mailer;
  /** Text model used by the interview drafter. Without it the drafter uses fixed templates. */
  llm?: FailoverLlm | null;
  /** Optional AI judge for interview answers. Without it the keyword rubric is used. */
  interviewJudge?: CoverageJudge | null;
  /** Project interview kit: GitHub access and PDF reading. Defaults call the real GitHub; tests pass stand-ins. */
  kit?: Pick<KitDeps, 'githubFetch' | 'pdfToText' | 'serverToken'>;
  /** Revokes the GitHub grant at GitHub and purges the stored token (wired by the app). */
  githubRevoker?: StudentDeps['githubRevoker'];
  /** Reads a recruiter's domain proof file. Defaults to a real HTTPS fetch; the demo and tests pass a stand-in. */
  domainFetcher?: DomainFetcher;
  /** Gives the placement logs an identity unique to this run. Demo only, because the demo database starts empty on every boot. */
  ledgerOriginSalt?: string;
}

/** Registers all v2 product routes (student, placement office, recruiter, university, public). */
export function registerV2(
  app: FastifyInstance,
  deps: V2Deps,
  resolveSession: (req: FastifyRequest, reply: FastifyReply) => Promise<SessionContext | null>,
  /** Verifies a token without needing a PRAMAAN record (used only by the claim step). */
  resolveIdentity?: Parameters<typeof registerClaimRoute>[2]
): void {
  const router = createRouter(app, { db: deps.db, resolveSession });
  registerStudentRoutes(router, { ...deps, interviewJudge: deps.interviewJudge === undefined ? createCoverageJudgeFromEnv() : deps.interviewJudge });
  registerTpoRoutes(router, { judgeName: deps.judge.name, mailer: deps.mailer ?? createMailerFromEnv(), llm: deps.llm === undefined ? createLlmFromEnv() : deps.llm });
  registerRecruiterRoutes(router);
  registerKitRoutes(router, { ...deps.kit, serverToken: deps.kit?.serverToken ?? process.env.GITHUB_TOKEN, llm: deps.llm === undefined ? createLlmFromEnv() : deps.llm });
  registerInviteRoutes(router, { mailer: deps.mailer ?? createMailerFromEnv(), webUrl: process.env.PRAMAAN_WEB_URL ?? 'http://localhost:3000' });
  if (resolveIdentity) registerClaimRoute(app, deps.db, resolveIdentity);
  registerPublicRoutes(app, deps.db);
  registerPassRoutes(router, app, deps.db, deps.issuer);
  configureLedger(deps.issuer, { originSalt: deps.ledgerOriginSalt });
  registerLedgerRoutes(router, app, deps.db, deps.issuer, { domainFetcher: deps.domainFetcher });

  // Skill catalogue for search boxes (any signed-in role).
  router.get('/api/v2/catalog/skills', ['student', 'mentor', 'officer', 'college_admin', 'dept_coordinator', 'recruiter', 'university_admin', 'platform_admin'],
    async ({ sql, query }) => {
      const q = `%${String(query.q ?? '').slice(0, 50)}%`;
      const rows = (await sql.query<any>(`SELECT k.slug, k.canonical_name AS name, k.category FROM skills k
        WHERE k.slug IS NOT NULL AND (k.canonical_name ILIKE $1 OR EXISTS (SELECT 1 FROM skill_aliases a WHERE a.skill_id = k.id AND a.alias ILIKE $1))
        ORDER BY k.canonical_name LIMIT 40`, [q])).rows;
      return rows;
    });
}

export * from './db.js';
export * from './judge.js';
export * from './config.js';
export * from './mailer.js';
export * from './ledger.js';
export * from './llm.js';
export * from './interview-judge.js';
