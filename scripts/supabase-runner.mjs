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

export function assertApprovedDatabaseTarget(targetUrl, operation = 'Database query') {
  const nodeEnv = (process.env.NODE_ENV || '').toLowerCase();
  const env = (process.env.ENVIRONMENT || '').toLowerCase();
  const vercelEnv = (process.env.VERCEL_ENV || '').toLowerCase();

  // 1. Block explicit production environment flags
  if (nodeEnv === 'production' || env === 'production' || vercelEnv === 'production') {
    throw new Error(
      `[SECURITY_GUARD] Operation blocked: "${operation}" cannot be executed in a production environment (NODE_ENV=${process.env.NODE_ENV}, ENVIRONMENT=${process.env.ENVIRONMENT}).`
    );
  }

  // 2. Database target identity verification
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

export function hasSideEffectingFunction(sql) {
  if (typeof sql !== 'string') return false;
  const cleaned = cleanSqlForInspection(sql);
  if (!cleaned) return false;

  // Detect PostgreSQL built-in functions with data-mutating, server-modifying, or session-locking side effects
  const sideEffectFunctionsRegex = /(?:\b|\.)(nextval|setval|lo_create|lo_unlink|lo_import|lo_export|lo_truncate|lo_put|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_rotate_logfile|pg_create_restore_point|pg_switch_wal|pg_promote|pg_create_logical_replication_slot|pg_drop_replication_slot|pg_replication_slot_advance|pg_notify|pg_write_file|pg_file_unlink|pg_advisory_lock|pg_advisory_lock_shared|pg_advisory_unlock|pg_advisory_unlock_all|pg_advisory_xact_lock|pg_advisory_xact_lock_shared|pg_try_advisory_lock|pg_try_advisory_xact_lock|dblink_exec)\s*\(/i;

  return sideEffectFunctionsRegex.test(cleaned);
}

export function hasTransactionControl(sql) {
  if (typeof sql !== 'string') return false;
  const cleaned = cleanSqlForInspection(sql);
  if (!cleaned) return false;

  // Primary PostgreSQL transaction-control commands and terminators
  // Includes: BEGIN, START TRANSACTION, START WORK, COMMIT, ROLLBACK, ABORT,
  // SAVEPOINT, RELEASE [SAVEPOINT], PREPARE TRANSACTION, SET TRANSACTION
  const txKeywordsRegex = /\b(BEGIN|START\s+TRANSACTION|START\s+WORK|COMMIT|ROLLBACK|ABORT|SAVEPOINT|RELEASE(?:\s+SAVEPOINT)?|PREPARE\s+TRANSACTION|SET\s+(?:SESSION\s+CHARACTERISTICS\s+AS\s+)?TRANSACTION)\b/i;
  if (txKeywordsRegex.test(cleaned)) return true;

  // PostgreSQL transaction alias: END [ WORK | TRANSACTION ] [ AND [ NO ] CHAIN ]
  // Must match statement-level END (at start of query or after a semicolon) to avoid
  // false positives on SQL CASE expressions (CASE ... END).
  const endStatementRegex = /(?:^|;)\s*END(?:\s+(?:WORK|TRANSACTION))?(?:\s+AND\s+(?:NO\s+)?CHAIN)?\s*(?:;|$)/i;
  if (endStatementRegex.test(cleaned)) return true;

  // Unambiguous compound forms of END
  const endCompoundRegex = /\bEND\s+(?:WORK|TRANSACTION|AND\s+(?:NO\s+)?CHAIN)\b/i;
  if (endCompoundRegex.test(cleaned)) return true;

  return false;
}

export function isMutationQuery(sql) {
  if (typeof sql !== 'string') return false;
  const cleaned = cleanSqlForInspection(sql);
  if (!cleaned) return false;

  const mutationKeywordsRegex = /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|RENAME|DO|CALL|EXECUTE|VACUUM|REINDEX|COPY|LOCK|MERGE|INTO|CLUSTER|REFRESH|CHECKPOINT|REASSIGN)\b/i;
  if (mutationKeywordsRegex.test(cleaned)) return true;

  if (hasSideEffectingFunction(cleaned)) return true;

  return false;
}

export function isDestructiveQuery(sql) {
  // A query is destructive/privileged if it mutates data/schema OR controls transactions
  return isMutationQuery(sql) || hasTransactionControl(sql);
}

// Allowlist of safe built-in SQL and PostgreSQL functions & syntax keywords that may precede '(' in read-only queries
const SAFE_READ_ONLY_BUILTIN_FUNCTIONS_AND_KEYWORDS = new Set([
  // SQL Syntax / Clause Keywords that can precede parentheses in valid read-only queries
  'select', 'from', 'where', 'and', 'or', 'not', 'in', 'on', 'as', 'with', 'values',
  'join', 'using', 'case', 'when', 'then', 'else', 'over', 'partition', 'order', 'by',
  'group', 'having', 'limit', 'offset', 'distinct', 'cast', 'extract', 'position',
  'substring', 'trim', 'between', 'exists', 'row', 'array', 'table', 'left', 'right',
  'cross', 'inner', 'outer', 'natural', 'full', 'filter', 'within', 'like', 'ilike',
  'similar', 'nullif', 'coalesce', 'greatest', 'least', 'all', 'any', 'some',

  // Standard read-only aggregate functions
  'count', 'sum', 'avg', 'min', 'max', 'string_agg', 'array_agg', 'json_agg', 'jsonb_agg',
  'bool_and', 'bool_or', 'every', 'bit_and', 'bit_or', 'xmlagg',

  // Standard read-only string / text functions
  'lower', 'upper', 'btrim', 'ltrim', 'rtrim', 'length', 'char_length', 'character_length',
  'octet_length', 'bit_length', 'replace', 'concat', 'concat_ws', 'split_part',
  'repeat', 'reverse', 'lpad', 'rpad', 'format', 'initcap', 'strpos', 'translate',
  'ascii', 'chr', 'md5', 'encode', 'decode', 'to_hex', 'quote_ident', 'quote_literal',

  // Standard mathematical functions
  'abs', 'ceil', 'ceiling', 'floor', 'round', 'trunc', 'power', 'sqrt', 'cbrt',
  'degrees', 'radians', 'exp', 'ln', 'log', 'mod', 'sign', 'random', 'width_bucket',

  // Standard date and time functions
  'now', 'current_timestamp', 'current_time', 'current_date', 'localtime', 'localtimestamp',
  'timeofday', 'clock_timestamp', 'statement_timestamp', 'transaction_timestamp',
  'date_trunc', 'date_part', 'age', 'to_char', 'to_date', 'to_timestamp', 'to_number',
  'isfinite', 'justify_days', 'justify_hours', 'justify_interval',

  // JSON and JSONB read-only functions
  'json_build_object', 'jsonb_build_object', 'json_build_array', 'jsonb_build_array',
  'json_extract_path', 'jsonb_extract_path', 'json_extract_path_text', 'jsonb_extract_path_text',
  'json_array_length', 'jsonb_array_length', 'row_to_json', 'to_json', 'to_jsonb',
  'json_typeof', 'jsonb_typeof', 'json_strip_nulls', 'jsonb_strip_nulls',
  'json_object_keys', 'jsonb_object_keys',

  // Cryptographic & UUID read-only functions
  'gen_random_uuid', 'uuid_generate_v4', 'uuid_generate_v1', 'hashtext', 'digest',

  // System, connection & metadata introspection functions
  'version', 'current_user', 'session_user', 'user', 'current_database', 'current_schema',
  'current_setting', 'inet_server_port', 'inet_server_addr', 'inet_client_port', 'inet_client_addr',
  'pg_typeof', 'pg_backend_pid', 'cardinality', 'array_length', 'array_ndims', 'array_dims',
  'array_lower', 'array_upper', 'array_to_string', 'string_to_array', 'unnest',

  // Built-in PostgreSQL pseudo-type cast constructors
  'int', 'int2', 'int4', 'int8', 'float4', 'float8', 'numeric', 'text', 'varchar',
  'bool', 'boolean', 'date', 'time', 'timestamp', 'timestamptz', 'interval', 'uuid'
]);

export function isSafeReadOnlyQuery(sql) {
  if (typeof sql !== 'string') return false;
  const cleaned = cleanSqlForInspection(sql);
  if (!cleaned) return false;

  // 1. If it's a mutation, has side-effects, or controls transactions, it is never safe read-only
  if (isDestructiveQuery(sql)) return false;

  // 2. Prohibit transaction commands or session alteration in safe read-only
  const unsafeCommandsRegex = /\b(BEGIN|COMMIT|ROLLBACK|ABORT|START|SET|RESET|DISCARD|LISTEN|UNLISTEN|NOTIFY|LOAD|LOCK|PREPARE)\b/i;
  if (unsafeCommandsRegex.test(cleaned)) return false;

  // 3. Must begin with recognized read-only query verbs (SELECT, WITH, SHOW, EXPLAIN, VALUES)
  const readOnlyVerbRegex = /^(?:EXPLAIN\s+)?(?:SELECT|WITH|SHOW|VALUES)\b/i;
  if (!readOnlyVerbRegex.test(cleaned)) return false;

  // 4. Prohibit arbitrary or user-defined schema-qualified functions on unauthenticated channels (e.g. public.fn())
  const schemaQualifiedFunctionRegex = /\b[a-zA-Z0-9_]+\s*\.\s*[a-zA-Z0-9_]+\s*\(/;
  if (schemaQualifiedFunctionRegex.test(cleaned)) return false;

  // 5. Prohibit unqualified user-defined or unrecognized functions.
  // Any function call not in the verified safe built-in functions allowlist is rejected.
  const functionCallRegex = /\b([a-zA-Z0-9_]+)\s*\(/g;
  let match;
  while ((match = functionCallRegex.exec(cleaned)) !== null) {
    const fnName = match[1].toLowerCase();
    if (!SAFE_READ_ONLY_BUILTIN_FUNCTIONS_AND_KEYWORDS.has(fnName)) {
      return false;
    }
  }

  return true;
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
  const hasTxControl = hasTransactionControl(sql);
  const adminUrl = process.env.DATABASE_URL_ADMIN;

  if (isDestructive) {
    if (!adminUrl) {
      throw new Error(
        '[SECURITY_GUARD] Destructive or mutating database operations require direct DATABASE_URL_ADMIN PostgreSQL connectivity. Management API execution is prohibited.'
      );
    }
    assertSafeTestEnvironment(
      hasTxControl ? 'Privileged transaction execution via runQuery' : 'Destructive SQL execution via runQuery',
      adminUrl
    );
  } else if (adminUrl) {
    // Validate target identity even for non-destructive / read-only queries
    assertApprovedDatabaseTarget(adminUrl, 'Direct admin SQL execution via runQuery');
  }

  if (adminUrl) {
    const ssl = resolveAdminSslConfig(adminUrl);
    const pool = new pg.Pool({ connectionString: adminUrl, ssl, max: 1 });
    try {
      const client = await pool.connect();
      try {
        let res;
        // General read-only query path: unconditionally execute inside a PostgreSQL READ ONLY transaction.
        // Because isDestructive is false, sql contains zero transaction control (no BEGIN, COMMIT, or ROLLBACK),
        // guaranteeing that multi-statement queries cannot terminate or escape the READ ONLY transaction.
        if (!isDestructive) {
          await client.query('BEGIN READ ONLY;');
          try {
            res = await client.query(sql);
            await client.query('COMMIT;');
          } catch (txErr) {
            await client.query('ROLLBACK;').catch(() => {});
            throw txErr;
          }
        } else {
          // Explicitly authorized destructive or privileged transaction path
          res = await client.query(sql);
        }

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

  // Fallback to Supabase Management API only for non-destructive, verified safe read-only queries
  if (process.env.SUPABASE_MANAGEMENT_TOKEN) {
    if (isDestructive) {
      throw new Error(
        '[SECURITY_GUARD] Management API fallback cannot execute destructive/mutating SQL.'
      );
    }

    if (!isSafeReadOnlyQuery(sql)) {
      throw new Error(
        '[SECURITY_GUARD] Management API query blocked: Read-only execution cannot be safely guaranteed for this query.'
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
    // Enforce PostgreSQL READ ONLY transaction wrapper at payload level
    const safePayload = `BEGIN READ ONLY; ${sql}; COMMIT;`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SUPABASE_MANAGEMENT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: safePayload })
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errorText}`);
    }

    return await res.json();
  }

  throw new Error('No database administration channel available: set DATABASE_URL_ADMIN or SUPABASE_MANAGEMENT_TOKEN.');
}

export async function runTestTransaction(sql) {
  const adminUrl = process.env.DATABASE_URL_ADMIN;
  if (!adminUrl) {
    throw new Error('DATABASE_URL_ADMIN is required for test transaction execution.');
  }
  assertSafeTestEnvironment('Dedicated test transaction execution via runTestTransaction', adminUrl);

  const ssl = resolveAdminSslConfig(adminUrl);
  const pool = new pg.Pool({ connectionString: adminUrl, ssl, max: 1 });
  try {
    const client = await pool.connect();
    try {
      const res = await client.query(sql);
      if (Array.isArray(res)) {
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
