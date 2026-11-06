import pg from 'pg';
import { resolveAdminSslConfig } from './admin-db-ssl.mjs';

try {
  process.loadEnvFile?.();
} catch {}

const SUPABASE_MANAGEMENT_TOKEN = process.env.SUPABASE_MANAGEMENT_TOKEN;
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'qshujrddrzoemlzmleru';

export const INSTITUTIONAL_ORG_IDS = Object.freeze([
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
]);

export const DEFAULT_APPROVED_TEST_PATTERNS = Object.freeze([
  'localhost',
  '127.0.0.1',
  '::1',
  'host.docker.internal',
  'pramaan_test',
  'qshujrddrzoemlzmleru', // Designated development/staging Supabase project ref
]);

export function isProductionDatabaseTarget(dbUrl) {
  if (!dbUrl || typeof dbUrl !== 'string') return false;

  const urlLower = dbUrl.toLowerCase();

  if (process.env.IS_PRODUCTION_DB === 'true') return true;
  if (process.env.PRODUCTION_DATABASE_URL && dbUrl === process.env.PRODUCTION_DATABASE_URL) return true;
  if (process.env.PRODUCTION_PROJECT_REF && urlLower.includes(process.env.PRODUCTION_PROJECT_REF.toLowerCase())) return true;

  const prodPatterns = [
    /\.prod\./i,
    /-prod\./i,
    /\/prod[_\-/]/i,
    /\/production[_\-/]/i,
    /pramaan[-_]prod/i,
    /pramaan[-_]production/i,
    /db\.prod\./i,
    /production-db/i,
  ];

  for (const pattern of prodPatterns) {
    if (pattern.test(urlLower)) {
      return true;
    }
  }

  try {
    const parsed = new URL(dbUrl.replace(/^postgresql:\/\//i, 'http://'));
    if (parsed.pathname && (parsed.pathname === '/production' || parsed.pathname === '/pramaan_production' || parsed.pathname.startsWith('/prod_'))) {
      return true;
    }
    if (parsed.hostname && (parsed.hostname.startsWith('prod.') || parsed.hostname.includes('.prod.'))) {
      return true;
    }
  } catch {}

  return false;
}

export function isApprovedTestDatabase(dbUrl) {
  if (!dbUrl || typeof dbUrl !== 'string') return false;

  if (isProductionDatabaseTarget(dbUrl)) return false;

  const urlLower = dbUrl.toLowerCase();

  const envAllowlist = (process.env.TEST_DATABASE_ALLOWLIST || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  const allowedPatterns = [...DEFAULT_APPROVED_TEST_PATTERNS, ...envAllowlist];

  for (const pattern of allowedPatterns) {
    if (urlLower.includes(pattern)) {
      return true;
    }
  }

  return false;
}

export function assertSafeTestEnvironment(operation = 'Database integration test / destructive operation', targetUrl) {
  const nodeEnv = (process.env.NODE_ENV || '').toLowerCase();
  const env = (process.env.ENVIRONMENT || '').toLowerCase();
  const vercelEnv = (process.env.VERCEL_ENV || '').toLowerCase();

  // 1. Block explicit production environment flags
  if (nodeEnv === 'production' || env === 'production' || vercelEnv === 'production') {
    throw new Error(
      `[SECURITY_GUARD] Operation blocked: "${operation}" cannot be executed in a production environment (NODE_ENV=${process.env.NODE_ENV}, ENVIRONMENT=${process.env.ENVIRONMENT}).`
    );
  }

  // 2. Explicit opt-in requirement for destructive DB operations/tests
  const optIn = (process.env.ALLOW_DESTRUCTIVE_DB_TESTS || process.env.ALLOW_DESTRUCTIVE_TESTS || '').toLowerCase();
  if (optIn !== 'true') {
    throw new Error(
      `[SECURITY_GUARD] Operation blocked: "${operation}" requires explicit opt-in via ALLOW_DESTRUCTIVE_DB_TESTS=true.`
    );
  }

  // 3. Database target identity verification
  const urlToCheck = targetUrl || process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL;
  if (urlToCheck) {
    if (isProductionDatabaseTarget(urlToCheck)) {
      throw new Error(
        `[SECURITY_GUARD] Operation blocked: Database target is recognized as a production database.`
      );
    }
    if (!isApprovedTestDatabase(urlToCheck)) {
      throw new Error(
        `[SECURITY_GUARD] Operation blocked: Database target is not on the approved test database allowlist.`
      );
    }
  }
}

export function assertNotInstitutionalTenant(orgId, operation = 'Destructive operation') {
  if (INSTITUTIONAL_ORG_IDS.includes(orgId)) {
    throw new Error(
      `[SECURITY_GUARD] Institutional tenant protection: Cannot perform ${operation} on production institutional tenant ${orgId}. Use an isolated test fixture tenant instead.`
    );
  }
}

export function isDestructiveQuery(sql) {
  if (typeof sql !== 'string') return false;
  return /\b(DELETE\s+FROM|TRUNCATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE\s+.*\s+DISABLE\s+TRIGGER)\b/i.test(sql);
}

export async function safeCleanupTestAuditEvents({
  orgId,
  seq,
  action,
  objectType,
  id
}) {
  assertSafeTestEnvironment('safeCleanupTestAuditEvents');
  if (!orgId) {
    throw new Error('safeCleanupTestAuditEvents requires an explicit non-institutional orgId');
  }
  assertNotInstitutionalTenant(orgId, 'Audit event fixture cleanup');

  const adminUrl = process.env.DATABASE_URL_ADMIN;
  if (!adminUrl) {
    throw new Error('DATABASE_URL_ADMIN is required for administrative audit cleanup');
  }

  const ssl = resolveAdminSslConfig(adminUrl);
  const pool = new pg.Pool({ connectionString: adminUrl, ssl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN;');
    await client.query('ALTER TABLE audit_events DISABLE TRIGGER trg_audit_events_immutable;');

    let sql = 'DELETE FROM audit_events WHERE org_id = $1';
    const params = [orgId];

    if (seq !== undefined) {
      params.push(seq);
      sql += ` AND seq = $${params.length}`;
    }
    if (action !== undefined) {
      params.push(action);
      sql += ` AND action = $${params.length}`;
    }
    if (objectType !== undefined) {
      params.push(objectType);
      sql += ` AND object_type = $${params.length}`;
    }
    if (id !== undefined) {
      params.push(id);
      sql += ` AND id = $${params.length}`;
    }

    const res = await client.query(sql, params);

    await client.query('ALTER TABLE audit_events ENABLE TRIGGER trg_audit_events_immutable;');
    await client.query('COMMIT;');
    return res.rowCount ?? 0;
  } catch (err) {
    await client.query('ROLLBACK;').catch(() => {});
    await client.query('ALTER TABLE audit_events ENABLE TRIGGER trg_audit_events_immutable;').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

export async function runQuery(sql) {
  const adminUrl = process.env.DATABASE_URL_ADMIN;
  if (isDestructiveQuery(sql)) {
    assertSafeTestEnvironment('Destructive SQL execution via runQuery', adminUrl);
  }

  if (adminUrl) {
    const ssl = resolveAdminSslConfig(adminUrl);
    const pool = new pg.Pool({ connectionString: adminUrl, ssl, max: 1 });
    try {
      const client = await pool.connect();
      try {
        const res = await client.query(sql);
        // If multiple SQL statements were executed, return rows of last statement or combine
        if (Array.isArray(res)) {
          // If a batch contains a SELECT statement, return its rows (matching Supabase Query API behavior)
          const selectResult = res.slice().reverse().find(r => r.command === 'SELECT');
          if (selectResult) {
            return selectResult.rows;
          }
          const last = res[res.length - 1];
          return last?.rows || [];
        }
        return res?.rows || [];
      } finally {
        client.release();
      }
    } finally {
      await pool.end();
    }
  }

  // Fallback to Supabase Management API when SUPABASE_MANAGEMENT_TOKEN is configured
  if (SUPABASE_MANAGEMENT_TOKEN) {
    const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_MANAGEMENT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: sql })
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errorText}`);
    }

    return await res.json();
  }

  throw new Error('No database administration channel available: set DATABASE_URL_ADMIN or SUPABASE_MANAGEMENT_TOKEN.');
}

// If executed directly, run query from argv
if (process.argv[1]?.endsWith('supabase-runner.mjs') && process.argv[2]) {
  const query = process.argv.slice(2).join(' ');
  runQuery(query)
    .then(data => console.log(JSON.stringify(data, null, 2)))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
