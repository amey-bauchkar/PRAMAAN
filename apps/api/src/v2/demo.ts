import { randomBytes } from 'crypto';
import pg from 'pg';
import type { PGlite } from '@electric-sql/pglite';
import { issuerKeyFromSeed } from '@pramaan/domain';
import { buildApp } from '../app.js';
import { AuthService } from '../services/auth-service.js';
import { JwtVerifier } from '../services/jwt-verifier.js';
import { PgUserRepository } from '../repositories/user-repository.js';
import { createTestToken } from '../testing/test-jwt-utils.js';
import { PgliteDb, createPgliteDatabase } from './db.js';
import { LocalJudge } from './judge.js';
import { DemoFixtureProfiles } from './config.js';
import { evaluateDrive } from './services.js';
import { seedDemoLedger, seedDemoWitness, demoLedgerOrg, demoTamper, demoRewrite, demoRestore } from './demo-ledger.js';
import type { Mailer } from './mailer.js';
import type { FailoverLlm } from './llm.js';
import type { CoverageJudge } from './interview-judge.js';

/**
 * Offline demo: the full product on an in-process PostgreSQL (PGlite) with every migration and the
 * synthetic seed applied. Sign-in is by persona with a token signed by a per-boot random secret; this
 * module is never imported by the production server.
 */
export const PERSONAS = [
  { key: 'rahul', authSubject: 'demo|student:cse:0', label: 'Rahul Deshmukh', role: 'Student · Computer Engineering', workspace: 'student' },
  { key: 'minor', authSubject: 'demo|student:dce:1', label: 'Diploma student (under 18)', role: 'Student · Diploma Civil', workspace: 'student' },
  { key: 'tpo', authSubject: 'demo|tpo-a', label: 'Prof. Meenal Joshi', role: 'Placement officer · Sahyadri College', workspace: 'tpo' },
  { key: 'admin', authSubject: 'demo|admin-a', label: 'Dr. Vikram Bhide', role: 'College admin', workspace: 'tpo' },
  { key: 'coord', authSubject: 'demo|coord-cse', label: 'Prof. Anil Gokhale', role: 'Department coordinator · CSE', workspace: 'tpo' },
  { key: 'mentor', authSubject: 'demo|mentor-cse', label: 'Dr. Rekha Menon', role: 'Faculty mentor · CSE', workspace: 'tpo' },
  { key: 'recruiter', authSubject: 'demo|recruiter-1', label: 'Neha Kapoor', role: 'Recruiter · Nimbus Analytics', workspace: 'recruiter' },
  { key: 'university', authSubject: 'demo|uni-admin', label: 'Dr. Sunita Kale', role: 'University administrator', workspace: 'university' },
  { key: 'tpo-poly', authSubject: 'demo|tpo-b', label: 'Shri. Prakash Sawant', role: 'Placement officer · Konkan Polytechnic', workspace: 'tpo' },
] as const;

/** Exposes a PGlite instance through the small slice of the node-postgres Pool API the repositories use. */
function poolFacade(db: PGlite): pg.Pool {
  return { query: (text: string, params?: unknown[]) => db.query(text, params as any[]) } as unknown as pg.Pool;
}

const DEMO_ISSUER_SEED = '7072616d61616e2d64656d6f2d6973737565722d6b65792d7365656421212121'; // demo-only, public
// Each run of the demo starts with new logs. Giving them a run-specific identity stops a browser that remembers an earlier
// run from reporting a rewrite. All apps created in one process share it, so tests are unaffected.
const DEMO_BOOT_ID = randomBytes(4).toString('hex');

export interface DemoApp {
  app: ReturnType<typeof buildApp>;
  db: PgliteDb;
  tokenFor(personaKey: string): Promise<string>;
  /** Test helper: token for any seeded account by its auth subject. */
  tokenForSubject(authSubject: string): Promise<string>;
}

export async function createDemoApp(options: { verifyBaseUrl?: string; publishDrives?: boolean; mailer?: Mailer; llm?: FailoverLlm | null; interviewJudge?: CoverageJudge | null } = {}): Promise<DemoApp> {
  if (process.env.NODE_ENV === 'production') throw new Error('The demo app must never run in production.');
  const pglite = await createPgliteDatabase();
  const db = new PgliteDb(pglite);
  const secret = randomBytes(32).toString('hex');
  const userRepository = new PgUserRepository(poolFacade(pglite));
  const authService = new AuthService({ jwtVerifier: new JwtVerifier(secret), userRepository });
  const { privateKey, publicKeyPem } = issuerKeyFromSeed(process.env.PRAMAAN_ISSUER_SEED ?? DEMO_ISSUER_SEED);

  const app = buildApp({
    persistenceMode: 'in-memory', authService, userRepository,
    v2: { db, judge: new LocalJudge(), profiles: new DemoFixtureProfiles(), mailer: options.mailer,
      // Tests never call a real AI provider unless one is passed in. The demo server uses the keys in the environment.
      llm: options.llm !== undefined ? options.llm : process.env.VITEST ? null : undefined,
      interviewJudge: options.interviewJudge !== undefined ? options.interviewJudge : process.env.VITEST ? null : undefined,
      issuer: { privateKey, publicKeyPem, verifyBaseUrl: options.verifyBaseUrl ?? 'http://localhost:3000/verify' }, ledgerOriginSalt: DEMO_BOOT_ID,
      // Offline stand-in for a company's website: any ".example" domain "publishes" the expected proof line. Real domains are not contacted.
      domainFetcher: async (domain, expected) => { if (domain.endsWith('.example')) return expected; throw new Error('the offline demo only reads ".example" domains'); } },
  });

  const tokenForSubject = (sub: string) =>
    createTestToken({ sub, email: `${sub.replace(/[^a-z0-9]/gi, '.')}@demo.pramaan.invalid` }, { customSecret: secret, issuer: null });
  const extraPersonas: { key: string; authSubject: string; label: string; role: string; workspace: string }[] = [];
  const tokenFor = async (key: string) => {
    const p = [...PERSONAS, ...extraPersonas].find(x => x.key === key);
    if (!p) throw new Error(`Unknown persona ${key}`);
    return tokenForSubject(p.authSubject);
  };

  app.get('/api/demo/personas', async () => ({ personas: [...PERSONAS, ...extraPersonas], note: 'Sample data for the demo. Sign-in is simulated and there are no real accounts.' }));
  app.post('/api/demo/login', async (req, reply) => {
    const key = (req.body as any)?.persona;
    if (![...PERSONAS, ...extraPersonas].some(p => p.key === key)) return reply.status(400).send({ error: 'Unknown persona.' });
    return { token: await tokenFor(key) };
  });

  // Publish eligibility for every scheduled drive (the ML internship stays a draft for the live demo).
  if (options.publishDrives !== false) {
    const officers = (await pglite.query<any>(`SELECT m.user_id, m.org_id FROM memberships m WHERE m.role = 'officer' AND m.org_id IN (SELECT org_id FROM drives)`)).rows;
    for (const o of officers) {
      const ctx = { userId: o.user_id, orgId: o.org_id, role: 'officer' as const };
      await db.withTenant(ctx, async sql => {
        const drives = (await sql.query<{ id: string }>(`SELECT id FROM drives WHERE status = 'scheduled' AND rule_version_id IS NOT NULL`)).rows;
        for (const d of drives) await evaluateDrive(sql, ctx, d.id, { publish: true });
      });
    }
  }
  // The ledger starts with history, and one candidate is waiting for a live offer so the whole flow can be shown.
  if (options.publishDrives !== false) {
    const featured = await seedDemoLedger(db);
    await seedDemoWitness(db);
    if (featured) extraPersonas.push({ key: 'candidate', authSubject: featured.authSubject, label: featured.name, role: 'Student · shortlisted, waiting for an offer', workspace: 'student' });
  }
  // Demo only: simulate a dishonest insider, then put things back.
  app.get('/api/demo/ledger', async () => ({ orgId: await demoLedgerOrg(db) }));
  app.post('/api/demo/ledger/tamper', async () => demoTamper(db));
  app.post('/api/demo/ledger/rewrite', async () => demoRewrite(db, { privateKey, publicKeyPem, verifyBaseUrl: '' }));
  app.post('/api/demo/ledger/restore', async () => demoRestore(db));
  return { app, db, tokenFor, tokenForSubject };
}
