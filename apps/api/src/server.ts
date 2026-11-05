import { buildApp } from './app.js';

const PORT = parseInt(process.env.PORT || '4000', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function start() {
  const app = buildApp();
  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`[PRAMAAN API] Server listening at http://${HOST}:${PORT}`);
    console.log(`[PRAMAAN API] OpenAPI Docs available at http://${HOST}:${PORT}/docs`);
  } catch (err) {
    console.error('[PRAMAAN API] Failed to start:', err);
    process.exit(1);
  }
}

start();

