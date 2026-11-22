/** @type {import('next').NextConfig} */
const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const dev = process.env.NODE_ENV !== 'production';

// Demo mode shows a persona picker that lets anyone sign in as a student, officer, recruiter or university admin.
// A real deployment must never ship it, so the production build on Vercel refuses to run with it switched on.
if (process.env.VERCEL_ENV === 'production' && process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
  throw new Error('NEXT_PUBLIC_DEMO_MODE=true is not allowed in a production deployment: it lets anyone sign in as any role.');
}

// Strict CSP: scripts only from this origin (Next needs 'unsafe-inline' for its bootstrap; dev also needs eval),
// network calls only to the API and Supabase, and no framing.
const csp = [
  "default-src 'self'",
  // 'wasm-unsafe-eval' lets the on-device camera check (MediaPipe) run WebAssembly; it does not allow eval of text.
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ''}`,
  "worker-src 'self' blob:",
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${api} ${supabase}${dev ? ' ws: http://localhost:* http://127.0.0.1:*' : ''}`.trim(),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  // The camera check imports the shared integrity rules from packages/domain (pure TypeScript, no Node-only code).
  experimental: { externalDir: true },
  // GitHub returns the student to this address after they approve the connection. The API receives it and forwards the browser
  // to the callback page; only this one path is passed through.
  async rewrites() {
    return [{ source: '/api/integrations/github/callback', destination: `${api}/api/integrations/github/callback` }];
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Content-Security-Policy', value: csp },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), interest-cohort=()' },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
      ],
    }];
  },
};

export default nextConfig;
