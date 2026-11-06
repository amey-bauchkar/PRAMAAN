import fs from 'fs';
import path from 'path';

/**
 * Strict TLS configuration resolver for privileged administrative database connections
 * (migrations, seed execution, schema management).
 *
 * Security Invariants:
 * 1. Localhost connections (local Docker/CI containers) use ssl: false.
 * 2. Remote database connections MUST use strict certificate verification (rejectUnauthorized: true).
 * 3. Never silently set rejectUnauthorized: false for any remote connection.
 * 4. Explicit DATABASE_CA_PATH must exist and be readable, or fail immediately.
 * 5. Hostname/SNI is extracted and validated.
 * 6. Insecure environment bypasses (e.g. DATABASE_SSL_ALLOW_INSECURE) are strictly rejected/ignored.
 * 7. Fails closed if no verified CA can be located for a remote host.
 */
export function resolveAdminSslConfig(connectionString) {
  if (!connectionString) {
    throw new Error('FATAL: Database connection string is required to resolve SSL configuration.');
  }

  // 1. Localhost / CI container detection: no SSL required
  if (
    connectionString.includes('localhost') ||
    connectionString.includes('127.0.0.1') ||
    connectionString.includes('::1')
  ) {
    return false;
  }

  // 2. Extract and validate remote hostname / SNI
  let servername;
  try {
    const parsed = new URL(connectionString);
    servername = parsed.hostname;
  } catch (err) {
    throw new Error(`FATAL: Invalid database connection URL format: ${err.message}`, { cause: err });
  }

  if (!servername) {
    throw new Error('FATAL: Unable to extract hostname from database connection string.');
  }

  // 3. Resolve CA certificate
  let ca = process.env.DATABASE_CA_CERT;

  if (!ca) {
    if (process.env.DATABASE_CA_PATH) {
      if (!fs.existsSync(process.env.DATABASE_CA_PATH)) {
        throw new Error(
          `FATAL: DATABASE_CA_PATH is configured ('${process.env.DATABASE_CA_PATH}') but file does not exist or is inaccessible.`
        );
      }
      try {
        ca = fs.readFileSync(process.env.DATABASE_CA_PATH, 'utf8');
      } catch (err) {
        throw new Error(
          `FATAL: DATABASE_CA_PATH is configured ('${process.env.DATABASE_CA_PATH}') but could not be read: ${err.message}`,
          { cause: err }
        );
      }
    } else {
      // Check candidate paths relative to workspace root
      const candidates = [
        'certs/supabase-ca.crt',
        'prod-ca-2021.crt',
        '../certs/supabase-ca.crt',
        '../../certs/supabase-ca.crt'
      ];
      for (const candidate of candidates) {
        const fullCandidate = path.resolve(process.cwd(), candidate);
        if (fs.existsSync(fullCandidate)) {
          try {
            ca = fs.readFileSync(fullCandidate, 'utf8');
            break;
          } catch {}
        }
      }
    }
  }

  // 4. Remote administrative connections MUST fail closed if CA is missing
  if (!ca) {
    throw new Error(
      `FATAL: Remote database connection to '${servername}' requires verified TLS. ` +
      `No trusted CA certificate found (DATABASE_CA_PATH, DATABASE_CA_CERT, or certs/supabase-ca.crt). ` +
      `Insecure TLS (rejectUnauthorized: false) is strictly prohibited for privileged administrative operations.`
    );
  }

  // 5. Insecure TLS environment bypass attempts (e.g. DATABASE_SSL_ALLOW_INSECURE) are strictly rejected/ignored
  // Even if DATABASE_SSL_ALLOW_INSECURE is set in environment, remote connections must rejectUnauthorized: true.
  return {
    rejectUnauthorized: true,
    ca,
    servername
  };
}

