import pg from 'pg';
import fs from 'fs';
import { SessionContext } from '@pramaan/contracts';

let poolInstance: pg.Pool | null = null;

export function resolveSslConfig(connectionString?: string): boolean | pg.ConnectionConfig['ssl'] {
  if (!connectionString || connectionString.includes('localhost') || connectionString.includes('127.0.0.1')) {
    return false;
  }

  // 1. Resolve CA certificate from env var or certificate file
  let ca: string | undefined = process.env.DATABASE_CA_CERT;
  if (!ca) {
    if (process.env.DATABASE_CA_PATH) {
      if (!fs.existsSync(process.env.DATABASE_CA_PATH)) {
        throw new Error(
          `DATABASE_CA_PATH is configured ('${process.env.DATABASE_CA_PATH}') but file does not exist or is inaccessible.`
        );
      }
      try {
        ca = fs.readFileSync(process.env.DATABASE_CA_PATH, 'utf8');
      } catch (err: any) {
        throw new Error(
          `DATABASE_CA_PATH is configured ('${process.env.DATABASE_CA_PATH}') but could not be read: ${err.message}`,
          { cause: err }
        );
      }
    } else {
      const candidates = [
        'certs/supabase-ca.crt',
        'prod-ca-2021.crt',
        '../../certs/supabase-ca.crt'
      ];

      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          try {
            ca = fs.readFileSync(candidate, 'utf8');
            break;
          } catch {}
        }
      }
    }
  }

  // 2. Extract hostname for SNI / servername verification
  let servername: string | undefined;
  try {
    servername = new URL(connectionString).hostname;
  } catch {}

  // 3. Environment-aware TLS configuration
  const isProduction = process.env.NODE_ENV === 'production';

  // In production, TLS must ALWAYS enforce rejectUnauthorized: true.
  // There is NO insecure bypass in production (DATABASE_SSL_ALLOW_INSECURE is ignored/prohibited).
  if (isProduction) {
    return {
      rejectUnauthorized: true,
      ca,
      servername
    };
  }

  // Non-production (local development / testing):
  // If CA certificate is available, use strict verification.
  if (ca) {
    return {
      rejectUnauthorized: true,
      ca,
      servername
    };
  }

  // Local development/testing fallback when CA bundle is not yet configured
  return {
    rejectUnauthorized: false
  };
}

export function getDbPool(): pg.Pool {
  if (!poolInstance) {
    try {
      process.loadEnvFile?.();
    } catch {}

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('DATABASE_URL environment variable is mandatory in production environment.');
      }
      console.warn('DATABASE_URL is not set. Database pool will not be available.');
    }

    const ssl = resolveSslConfig(connectionString);

    poolInstance = new pg.Pool({
      connectionString: connectionString || undefined,
      ssl,
      max: 10,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000
    });

    poolInstance.on('error', (err) => {
      console.error('Unexpected error on idle PostgreSQL client pool', err);
    });
  }

  return poolInstance;
}

export async function closeDbPool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
  }
}

/**
 * Executes a callback within an explicit tenant-scoped transaction:
 * 1. Acquires a client from the connection pool.
 * 2. Begins transaction (BEGIN).
 * 3. Switches role to app_api (SET LOCAL ROLE app_api).
 * 4. Sets tenant context safely using parameterized set_config(name, value, is_local).
 * 5. Executes the callback.
 * 6. Commits on success, rolls back on error.
 * 7. Safely releases client back to the pool in a finally block.
 */
export async function withTenantTransaction<T>(
  context: SessionContext,
  callback: (client: pg.PoolClient) => Promise<T>,
  pool?: pg.Pool
): Promise<T> {
  if (!context || !context.orgId) {
    throw new Error('TENANT_CONTEXT_REQUIRED: Cannot execute transaction without active tenant context.');
  }

  const activePool = pool ?? getDbPool();
  const client = await activePool.connect();

  try {
    await client.query('BEGIN;');
    await client.query('SET LOCAL ROLE app_api;');
    await client.query(
      `SELECT 
        set_config('app.current_org_id', $1, true),
        set_config('app.current_user_id', $2, true),
        set_config('app.current_user_role', $3, true);`,
      [context.orgId, context.userId || '', context.role || '']
    );

    const result = await callback(client);

    await client.query('COMMIT;');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK;');
    } catch (rollbackErr) {
      console.error('Error rolling back tenant transaction:', rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}
