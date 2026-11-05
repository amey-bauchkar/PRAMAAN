import pg from 'pg';
import { SessionContext } from '@pramaan/contracts';

let poolInstance: pg.Pool | null = null;

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
      // For local development fallback or testing
      console.warn('DATABASE_URL is not set. Database pool will not be available.');
    }

    poolInstance = new pg.Pool({
      connectionString: connectionString || undefined,
      ssl: connectionString?.includes('localhost') ? false : { rejectUnauthorized: false },
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
 * 4. Sets tenant context (SET LOCAL "app.current_org_id" = $1).
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
    await client.query('SET LOCAL "app.current_org_id" = $1;', [context.orgId]);

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
