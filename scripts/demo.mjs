#!/usr/bin/env node
/**
 * Offline demo: starts the demo API (in-process PostgreSQL with migrations + synthetic seed) and the web
 * app in demo mode. No Supabase, Docker or internet needed.   npm run demo  →  http://localhost:3000
 */
import { spawn, spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const procs = [];

// On Windows the children run through a shell, so kill() would stop only the shell and leave node holding
// ports 3000/4000. Kill the whole process tree instead.
function killTree(p) {
  if (p.exitCode !== null || p.killed) return;
  if (isWin) spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
  else p.kill();
}
let stopping = false;
function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const q of procs) killTree(q);
  process.exit(code);
}

function run(name, args, env, cwd = root) {
  const p = spawn(isWin ? 'npx.cmd' : 'npx', args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit', shell: isWin });
  p.on('exit', code => { console.log(`[demo] ${name} exited (${code})`); stopAll(code ?? 0); });
  procs.push(p);
}

run('api', ['tsx', 'apps/api/src/demo-server.ts'], { PORT: process.env.API_PORT ?? '4000' });
// `npm run demo -- --prod` serves an optimised production build: far smoother than `next dev`.
const prod = process.argv.includes('--prod');
const webEnv = {
  NEXT_PUBLIC_DEMO_MODE: 'true',
  NEXT_PUBLIC_API_URL: `http://127.0.0.1:${process.env.API_PORT ?? '4000'}`,
};
if (prod) {
  console.log('[demo] building the web app for production…');
  const b = spawnSync(isWin ? 'npx.cmd' : 'npx', ['next', 'build'], { cwd: path.join(root, 'apps', 'web'), env: { ...process.env, ...webEnv }, stdio: 'inherit', shell: isWin });
  if (b.status !== 0) { console.error('[demo] build failed'); process.exit(b.status ?? 1); }
}
run('web', ['next', prod ? 'start' : 'dev', '-p', process.env.WEB_PORT ?? '3000'], webEnv, path.join(root, 'apps', 'web'));

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => stopAll(0));
