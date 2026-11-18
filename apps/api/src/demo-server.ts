import { createDemoApp } from './v2/demo.js';

/**
 * Offline demo server: `npm run demo:api`. Runs the whole product on an in-process database with
 * synthetic data. Refuses to start in production.
 */
async function start() {
  if (process.env.NODE_ENV === 'production') {
    console.error('[PRAMAAN DEMO] Refusing to start: the demo server is not for production.');
    process.exit(1);
  }
  const port = parseInt(process.env.PORT || '4000', 10);
  const t0 = Date.now();
  console.log('[PRAMAAN DEMO] Building in-process database (migrations + synthetic seed)...');
  const { app } = await createDemoApp({ verifyBaseUrl: process.env.PRAMAAN_VERIFY_BASE_URL ?? 'http://localhost:3000/verify' });
  await app.listen({ port, host: '127.0.0.1' });
  console.log(`[PRAMAAN DEMO] Ready in ${Math.round((Date.now() - t0) / 1000)}s at http://127.0.0.1:${port} (synthetic data, simulated sign-in)`);
}

start().catch(err => {
  console.error('[PRAMAAN DEMO] Failed to start:', err);
  process.exit(1);
});
