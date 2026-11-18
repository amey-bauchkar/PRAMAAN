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
import { Mailer, createMailerFromEnv } from './mailer.js';
import { CoverageJudge, createCoverageJudgeFromEnv } from './interview-judge.js';

export interface V2Deps {
  db: Db;
  judge: Judge;
  profiles: ExternalProfileAdapter;
  issuer: IssuerConfig | null;
  /** Outgoing mail. Defaults to SMTP from the environment; without SMTP_HOST nothing is sent. */
  mailer?: Mailer;
  /** Optional AI judge for interview answers. Without it the keyword rubric is used. */
  interviewJudge?: CoverageJudge | null;
  /** Revokes the GitHub grant at GitHub and purges the stored token (wired by the app). */
  githubRevoker?: StudentDeps['githubRevoker'];
}

/** Registers all v2 product routes (student, placement office, recruiter, university, public). */
export function registerV2(
  app: FastifyInstance,
  deps: V2Deps,
  resolveSession: (req: FastifyRequest, reply: FastifyReply) => Promise<SessionContext | null>
): void {
  const router = createRouter(app, { db: deps.db, resolveSession });
  registerStudentRoutes(router, { ...deps, interviewJudge: deps.interviewJudge === undefined ? createCoverageJudgeFromEnv() : deps.interviewJudge });
  registerTpoRoutes(router, { judgeName: deps.judge.name, mailer: deps.mailer ?? createMailerFromEnv() });
  registerRecruiterRoutes(router);
  registerPublicRoutes(app, deps.db);
  registerPassRoutes(router, app, deps.db, deps.issuer);

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
export * from './interview-judge.js';
