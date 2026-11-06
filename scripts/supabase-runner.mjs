import pg from 'pg';
import { resolveAdminSslConfig } from './admin-db-ssl.mjs';

try {
  process.loadEnvFile?.();
} catch {}

export const INSTITUTIONAL_ORG_IDS = Object.freeze([
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
]);

export const APPROVED_LOCAL_HOSTS = Object.freeze([
  'localhost',
  '127.0.0.1',
  '::1',
  'host.docker.internal',
  'postgres',
]);

export const DEFAULT_APPROVED_SUPABASE_PROJECT_REFS = Object.freeze([
  'qshujrddrzoemlzmleru', // Designated development/staging Supabase project ref
]);

export const DEFAULT_APPROVED_DB_NAMES = Object.freeze([
  'pramaan_test',
  'postgres',
  'test',
  'pramaan_dev',
  'template1',
]);

// Maintained for backward compatibility
export const DEFAULT_APPROVED_TEST_PATTERNS = Object.freeze([
  ...APPROVED_LOCAL_HOSTS,
  ...DEFAULT_APPROVED_DB_NAMES,
  ...DEFAULT_APPROVED_SUPABASE_PROJECT_REFS,
]);

export function isApprovedSupabaseProjectRef(projectRef) {
  if (!projectRef || typeof projectRef !== 'string') return false;
  const refLower = projectRef.trim().toLowerCase();

  if (process.env.PRODUCTION_PROJECT_REF && refLower === process.env.PRODUCTION_PROJECT_REF.toLowerCase()) {
    return false;
  }

  const envAllowlist = (process.env.APPROVED_SUPABASE_PROJECT_REFS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  const allowed = [...DEFAULT_APPROVED_SUPABASE_PROJECT_REFS, ...envAllowlist];
  return allowed.includes(refLower);
}

export function isProductionDatabaseTarget(dbUrl) {
  if (!dbUrl || typeof dbUrl !== 'string') return false;

  if (process.env.IS_PRODUCTION_DB === 'true') return true;
  if (process.env.PRODUCTION_DATABASE_URL && dbUrl === process.env.PRODUCTION_DATABASE_URL) return true;

  try {
    const parsed = new URL(dbUrl);
    if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const pathname = (parsed.pathname || '').toLowerCase();
    const dbName = pathname.replace(/^\/+/, '');

    // 1. Check production project ref if configured
    if (process.env.PRODUCTION_PROJECT_REF) {
      const prodRef = process.env.PRODUCTION_PROJECT_REF.toLowerCase();
      const directMatch = hostname.match(/^(?:db\.)?([a-z0-9_-]+)\.supabase\.co$/);
      if (directMatch && directMatch[1] === prodRef) return true;
      if (/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(hostname)) {
        const userSegments = decodeURIComponent(parsed.username || '').split('.');
        if (userSegments.length === 2 && userSegments[1].toLowerCase() === prodRef) return true;
      }
    }

    // 2. Check hostname patterns
    const prodHostPatterns = [
      /(?:^|\.)prod\./i,
      /-prod\./i,
      /(?:^|\.)production\./i,
      /-production\./i,
      /production-db/i,
      /pramaan[-_]prod/i,
      /pramaan[-_]production/i,
      /db\.prod\./i,
    ];
    for (const pattern of prodHostPatterns) {
      if (pattern.test(hostname)) return true;
    }

    // 3. Check database name patterns
    const prodDbPatterns = [
      /^production$/i,
      /^pramaan_prod/i,
      /^pramaan_production/i,
      /^prod_/i,
      /^production_/i,
    ];
    for (const pattern of prodDbPatterns) {
      if (pattern.test(dbName)) return true;
    }
  } catch {
    return false;
  }

  return false;
}

export function isApprovedTestDatabase(dbUrl) {
  if (!dbUrl || typeof dbUrl !== 'string') return false;

  // 1. Immediately reject recognized production targets
  if (isProductionDatabaseTarget(dbUrl)) return false;

  try {
    const parsed = new URL(dbUrl);

    // 2. Validate protocol is postgresql: or postgres:
    if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const pathname = (parsed.pathname || '').toLowerCase();
    const dbName = pathname.replace(/^\/+/, '');

    // Database name must exist and must not be a production database name
    if (!dbName) return false;

    const envDbNames = (process.env.TEST_DATABASE_NAMES || '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);
    const approvedDbNames = [...DEFAULT_APPROVED_DB_NAMES, ...envDbNames];

    // 3. Check if exact local approved host
    if (APPROVED_LOCAL_HOSTS.includes(hostname)) {
      return approvedDbNames.includes(dbName);
    }

    // 4. Check if approved remote Supabase target
    // 4a. Direct connection format: (db.)?<projectRef>.supabase.co
    const directMatch = hostname.match(/^(?:db\.)?([a-z0-9_-]+)\.supabase\.co$/);
    if (directMatch) {
      const projectRef = directMatch[1];
      if (isApprovedSupabaseProjectRef(projectRef)) {
        return approvedDbNames.includes(dbName);
      }
      return false;
    }

    // 4b. Pooler connection format: <region>.pooler.supabase.com with username <user>.<projectRef>
    if (/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(hostname)) {
      const userSegments = decodeURIComponent(parsed.username || '').split('.');
      if (userSegments.length === 2) {
        const projectRef = userSegments[1];
        if (isApprovedSupabaseProjectRef(projectRef)) {
          return approvedDbNames.includes(dbName);
        }
      }
      return false;
    }

    // 5. Check explicitly configured external test host allowlist (exact hostnames)
    const envHostAllowlist = (process.env.TEST_DATABASE_HOST_ALLOWLIST || '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);

    if (envHostAllowlist.length > 0 && envHostAllowlist.includes(hostname)) {
      return approvedDbNames.includes(dbName);
    }

    return false;
  } catch {
    return false;
  }
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
  if (!urlToCheck) {
    throw new Error(
      `[SECURITY_GUARD] Operation blocked: Database target identity is missing. "${operation}" requires an explicitly validated database target (DATABASE_URL_ADMIN).`
    );
  }

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

export function assertNotInstitutionalTenant(orgId, operation = 'Destructive operation') {
  if (INSTITUTIONAL_ORG_IDS.includes(orgId)) {
    throw new Error(
      `[SECURITY_GUARD] Institutional tenant protection: Cannot perform ${operation} on production institutional tenant ${orgId}. Use an isolated test fixture tenant instead.`
    );
  }
}

export function cleanSqlForInspection(sql) {
  if (typeof sql !== 'string') return '';
  // 1. Strip block comments /* ... */
  let cleaned = sql.replace(/\/\*[\s\S]*?\*\//g, ' ');
  // 2. Strip line comments -- ...
  cleaned = cleaned.replace(/--.*$/gm, ' ');
  // 3. Strip single-quoted string literals: '...'
  cleaned = cleaned.replace(/'(?:''|[^'])*'/g, "''");
  // 4. Strip double-quoted strings / identifiers: "..."
  cleaned = cleaned.replace(/"(?:""|[^"])*"/g, '""');
  // 5. Strip dollar-quoted string literals: $$...$$ or $tag$...$tag$
  cleaned = cleaned.replace(/\$[a-zA-Z0-9_]*\$[\s\S]*?\$[a-zA-Z0-9_]*\$/g, "''");
  return cleaned.trim();
}

export function isMutationQuery(sql) {
  if (typeof sql !== 'string') return false;
  const cleaned = cleanSqlForInspection(sql);
  if (!cleaned) return false;

  const mutationKeywordsRegex = /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|RENAME|DO|CALL|EXECUTE|VACUUM|REINDEX|COPY|LOCK)\b/i;
  return mutationKeywordsRegex.test(cleaned);
}

export function isDestructiveQuery(sql) {
  return isMutationQuery(sql);
}

export async function safeCleanupTestAuditEvents(params) {
  if (!params || typeof params !== 'object') {
    throw new Error('safeCleanupTestAuditEvents requires parameter object with exact identifiers');
  }

  const { orgId, seq, action, objectType, id } = params;

  if (!orgId || typeof orgId !== 'string') {
    throw new Error('safeCleanupTestAuditEvents requires an explicit non-institutional orgId');
  }
  assertNotInstitutionalTenant(orgId, 'Audit event fixture cleanup');

  if (seq === undefined || typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) {
    throw new Error('safeCleanupTestAuditEvents requires an explicit non-negative integer seq');
  }
  if (!action || typeof action !== 'string' || action.trim() === '') {
    throw new Error('safeCleanupTestAuditEvents requires an explicit action string');
  }
  if (!objectType || typeof objectType !== 'string' || objectType.trim() === '') {
    throw new Error('safeCleanupTestAuditEvents requires an explicit objectType string');
  }
  if (!id || typeof id !== 'string' || id.trim() === '') {
    throw new Error('safeCleanupTestAuditEvents requires an explicit id string');
  }

  const adminUrl = process.env.DATABASE_URL_ADMIN;
  if (!adminUrl) {
    throw new Error('DATABASE_URL_ADMIN is required for administrative audit cleanup');
  }

  assertSafeTestEnvironment('safeCleanupTestAuditEvents', adminUrl);

  const ssl = resolveAdminSslConfig(adminUrl);
  const pool = new pg.Pool({ connectionString: adminUrl, ssl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN;');
    await client.query('ALTER TABLE audit_events DISABLE TRIGGER trg_audit_events_immutable;');

    const sql = 'DELETE FROM audit_events WHERE org_id = $1 AND seq = $2 AND action = $3 AND object_type = $4 AND id = $5;';
    const paramsArray = [orgId, seq, action, objectType, id];

    const res = await client.query(sql, paramsArray);

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
  const isDestructive = isDestructiveQuery(sql);
  const adminUrl = process.env.DATABASE_URL_ADMIN;

  if (isDestructive) {
    if (!adminUrl) {
      throw new Error(
        '[SECURITY_GUARD] Destructive or mutating database operations require direct DATABASE_URL_ADMIN PostgreSQL connectivity. Management API execution is prohibited.'
      );
    }
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

  // Fallback to Supabase Management API only for non-destructive read-only queries
  if (process.env.SUPABASE_MANAGEMENT_TOKEN) {
    if (isDestructive) {
      throw new Error(
        '[SECURITY_GUARD] Management API fallback cannot execute destructive/mutating SQL.'
      );
    }

    const projectRef = process.env.SUPABASE_PROJECT_REF;
    if (!projectRef) {
      throw new Error(
        '[SECURITY_GUARD] Management API query blocked: Missing SUPABASE_PROJECT_REF. Silent default fallback is prohibited.'
      );
    }

    if (!isApprovedSupabaseProjectRef(projectRef)) {
      throw new Error(
        `[SECURITY_GUARD] Management API query blocked: Project reference "${projectRef}" is not on the approved project allowlist.`
      );
    }

    const url = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SUPABASE_MANAGEMENT_TOKEN}`,
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
