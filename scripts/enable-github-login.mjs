#!/usr/bin/env node
/**
 * Switches on "Continue with GitHub" sign-in in your Supabase project, using the Supabase management API.
 *
 * Before running it, create a GitHub OAuth app (GitHub > Settings > Developer settings > OAuth Apps > New OAuth App):
 *   Homepage URL:               your site address, for example http://localhost:3000
 *   Authorization callback URL: https://<project-ref>.supabase.co/auth/v1/callback        (this script prints the exact one)
 * Then generate a client secret and run:
 *   GITHUB_CLIENT_ID=... GITHUB_CLIENT_SECRET=... npm run enable:github-login
 *
 * Needs SUPABASE_PROJECT_REF and SUPABASE_MANAGEMENT_TOKEN in .env. The secret is sent to Supabase and is not written to any file.
 * Afterwards set NEXT_PUBLIC_GITHUB_SIGNIN=true in apps/web/.env.local to show the button.
 */
try { process.loadEnvFile?.(); } catch { /* no .env file */ }
const ref = process.env.SUPABASE_PROJECT_REF, token = process.env.SUPABASE_MANAGEMENT_TOKEN;
const id = process.env.GITHUB_CLIENT_ID, secret = process.env.GITHUB_CLIENT_SECRET;
if (!ref || !token) { console.error('SUPABASE_PROJECT_REF and SUPABASE_MANAGEMENT_TOKEN must be set in .env.'); process.exit(1); }
const callback = `https://${ref}.supabase.co/auth/v1/callback`;
if (!id || !secret) {
  console.error(`Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.\nYour GitHub OAuth app's "Authorization callback URL" must be exactly:\n  ${callback}`);
  process.exit(1);
}
if (!/^[A-Za-z0-9._-]{10,40}$/.test(id) || secret.length < 20) { console.error('That does not look like a GitHub client ID and secret.'); process.exit(1); }
const url = `https://api.supabase.com/v1/projects/${ref}/config/auth`;
const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const r = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ external_github_enabled: true, external_github_client_id: id, external_github_secret: secret }) });
if (!r.ok) { console.error(`Supabase refused the change (${r.status}): ${(await r.text()).slice(0, 300)}`); process.exit(1); }
const now = await (await fetch(url, { headers })).json();
console.log(`GitHub sign-in is ${now.external_github_enabled ? 'ON' : 'still off'} (client ${now.external_github_client_id}).`);
console.log(`Callback URL set in your GitHub OAuth app must be: ${callback}`);
console.log('Next: set NEXT_PUBLIC_GITHUB_SIGNIN=true in apps/web/.env.local and restart the web app.');
