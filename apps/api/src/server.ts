import { buildApp } from './app.js';
import { issuerKeyFromSeed } from '@pramaan/domain';
import { PostgresDb, LocalJudge, Judge0Judge, LiveProfiles, DemoFixtureProfiles, Judge, V2Deps } from './v2/index.js';

const PORT = parseInt(process.env.PORT || '4000', 10);
const HOST = process.env.HOST || '0.0.0.0';

/** Refuses to run untrusted code: used in production when no isolated judge is configured. */
class DisabledJudge implements Judge {
  readonly name = 'disabled';
  private out(n: number) { return { runner: this.name, compileError: 'Code execution is disabled: configure JUDGE0_URL.', results: [], passed: 0, total: n }; }
  async runJavaScript(_c: string, _e: string, tests: unknown[]) { return this.out(tests.length); }
  async runSql(_s: string, tests: unknown[]) { return this.out(tests.length); }
}

/** v2 product modules on the real PostgreSQL database, with fail-closed choices for production. */
function v2Deps(): V2Deps | undefined {
  if (!process.env.DATABASE_URL) return undefined;
  const prod = process.env.NODE_ENV === 'production';
  const judge: Judge = process.env.JUDGE0_URL ? new Judge0Judge(process.env.JUDGE0_URL, process.env.JUDGE0_API_KEY) : prod ? new DisabledJudge() : new LocalJudge();
  const profiles = process.env.EXTERNAL_PROFILES_LIVE === 'true' || prod ? new LiveProfiles() : new DemoFixtureProfiles();
  const seed = process.env.PRAMAAN_ISSUER_SEED;
  const issuer = seed ? { ...issuerKeyFromSeed(seed), verifyBaseUrl: process.env.PRAMAAN_VERIFY_BASE_URL ?? 'http://localhost:3000/verify' } : null;
  return { db: new PostgresDb(), judge, profiles, issuer };
}

async function start() {
  const app = buildApp({ v2: v2Deps() });
  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`[PRAMAAN API] Server listening at http://${HOST}:${PORT}`);
    console.log(`[PRAMAAN API] OpenAPI Docs available at http://${HOST}:${PORT}/docs`);
  } catch (err) {
    console.error('[PRAMAAN API] Failed to start:', err);
    process.exit(1);
  }
}

start();
