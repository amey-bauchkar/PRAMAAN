// Copies MediaPipe's WebAssembly runtime next to the model files so the test window loads everything from this
// origin (no CDN, works offline). Runs before `next dev` and `next build`.
import { cpSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
// npm hoists workspace dependencies, so look in the web app first and then in the repository root.
const from = [path.join(here, '..', 'node_modules'), path.join(here, '..', '..', '..', 'node_modules')]
  .map(n => path.join(n, '@mediapipe', 'tasks-vision', 'wasm')).find(existsSync) ?? '';
const to = path.join(here, '..', 'public', 'proctor', 'wasm');
if (!from) { console.error('[proctor] @mediapipe/tasks-vision is not installed. Run npm install.'); process.exit(1); }
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log('[proctor] copied MediaPipe runtime to public/proctor/wasm');
