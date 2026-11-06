import pg from 'pg';
import { resolveAdminSslConfig } from './admin-db-ssl.mjs';

try {
  process.loadEnvFile?.();
} catch {}

const SUPABASE_MANAGEMENT_TOKEN = process.env.SUPABASE_MANAGEMENT_TOKEN;
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'qshujrddrzoemlzmleru';

export async function runQuery(sql) {
  const adminUrl = process.env.DATABASE_URL_ADMIN;
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
