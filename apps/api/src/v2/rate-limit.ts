import { FastifyInstance } from 'fastify';

export interface RateLimitOptions { perMinute: number; strictPerMinute: number; strict: RegExp; disabled?: boolean }

/** Fixed one-minute windows per client IP (and per path class). Returns 429 with Retry-After. */
export function installRateLimit(app: FastifyInstance, opts: RateLimitOptions): void {
  if (opts.disabled) return;
  const hits = new Map<string, { windowStart: number; count: number }>();
  let lastSweep = Date.now();
  app.addHook('onRequest', async (req, reply) => {
    const now = Date.now();
    if (now - lastSweep > 60_000) {
      for (const [k, v] of hits) if (now - v.windowStart >= 60_000) hits.delete(k);
      lastSweep = now;
    }
    const strict = opts.strict.test(req.url);
    const key = `${req.ip}|${strict ? 'strict' : 'all'}`;
    const limit = strict ? opts.strictPerMinute : opts.perMinute;
    let h = hits.get(key);
    if (!h || now - h.windowStart >= 60_000) { h = { windowStart: now, count: 0 }; hits.set(key, h); }
    h.count += 1;
    reply.header('x-ratelimit-limit', limit).header('x-ratelimit-remaining', Math.max(0, limit - h.count));
    if (h.count > limit) {
      const retry = Math.ceil((h.windowStart + 60_000 - now) / 1000);
      return reply.status(429).header('retry-after', retry).send({ error: `Too many requests. Try again in ${retry} s.` });
    }
  });
}
