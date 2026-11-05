import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runQuery } from './supabase-runner.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function migrate() {
  console.log('[MIGRATION] Starting Supabase database migration sequence...');

  // 1. Create Roles
  console.log('[ROLES] Ensuring application roles (app_api, ai_worker, fairness_job)...');
  const roleSql = `
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_api') THEN
        CREATE ROLE app_api WITH NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
      ELSE
        ALTER ROLE app_api NOBYPASSRLS;
      END IF;

      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ai_worker') THEN
        CREATE ROLE ai_worker WITH NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
      ELSE
        ALTER ROLE ai_worker NOBYPASSRLS;
      END IF;

      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fairness_job') THEN
        CREATE ROLE fairness_job WITH NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
      ELSE
        ALTER ROLE fairness_job NOBYPASSRLS;
      END IF;
    END $$;
  `;
  await runQuery(roleSql);
  console.log('[ROLES] Roles configured successfully.');

  // 2. Migration Files
  const migrationFiles = [
    'db/migrations/001_identity_and_tenancy.sql',
    'db/migrations/002_consent_and_rights.sql',
    'db/migrations/003_evidence_and_skills.sql',
    'db/migrations/004_verification_arena.sql',
    'db/migrations/005_placement_and_eligibility.sql',
    'db/migrations/006_ai_governance_and_audit.sql',
    'db/policies/rls_policies.sql',
    'db/seeds/001_demo_seed.sql'
  ];

  for (const relPath of migrationFiles) {
    const fullPath = path.join(rootDir, relPath);
    console.log(`[SQL] Applying ${relPath}...`);
    const sql = fs.readFileSync(fullPath, 'utf8');
    try {
      await runQuery(sql);
      console.log(`[SQL] SUCCESS: ${relPath}`);
    } catch (err) {
      console.error(`[SQL] FAILED: ${relPath}`, err);
      process.exit(1);
    }
  }

  // 3. Grant schema permissions to app_api
  console.log('[GRANTS] Granting permissions to app_api role...');
  const grantSql = `
    GRANT USAGE ON SCHEMA public TO app_api, ai_worker, fairness_job;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO app_api;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO app_api;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_api;

    -- ai_worker grants: select on evidence, insert on proposals and agent_runs only
    GRANT SELECT ON repositories, repo_snapshots, evidence_items, skills, rubric_versions TO ai_worker;
    GRANT INSERT ON proposals, agent_runs TO ai_worker;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ai_worker;
  `;
  await runQuery(grantSql);
  console.log('[GRANTS] Permissions granted successfully.');

  console.log('[MIGRATION] Complete! All tables, policies, and seeds applied.');
}

migrate().catch(err => {
  console.error('[MIGRATION FATAL ERROR]', err);
  process.exit(1);
});

