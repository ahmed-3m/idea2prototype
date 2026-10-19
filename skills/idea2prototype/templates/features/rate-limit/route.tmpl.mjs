// Idea2Prototype feature: rate-limit — in-memory fixed-window limiter with
// standard response headers. Zero dependencies.
// Compose into any route handler: import { rateLimit } from './ratelimit.mjs'
//   methods: { GET: rateLimit({ max: 10, windowMs: 60_000 })(async (ctx) => [200, { ok: true }]) }

const buckets = new Map(); // key -> { count, resetAt }
const CLEANUP_INTERVAL_MS = 60_000;
let lastCleanup = 0;

/**
 * Wrap a route handler with a per-key fixed-window limiter.
 * Keys default to the client IP; pass `keyFn(ctx)` to key by user/idempotency
 * key instead. Behind a reverse proxy the "client IP" is the proxy's IP — all
 * users would share one bucket — so key on a forwarded header you trust,
 * e.g. keyFn: (ctx) => ctx.req.headers['x-forwarded-for'] ?? 'local'.
 * Over-limit requests get 429 + Retry-After; allowed ones pass
 * through with X-RateLimit-* headers merged into the response.
 */
export function rateLimit({ max = 60, windowMs = 60_000, keyFn } = {}) {
  return (handler) => async (ctx) => {
    const key = keyFn ? keyFn(ctx) : (ctx.req?.socket?.remoteAddress ?? 'local');
    const now = Date.now();

    // Lazy cleanup (no timers — nothing keeps the process open)
    if (now - lastCleanup > CLEANUP_INTERVAL_MS) {
      for (const [k, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(k);
      lastCleanup = now;
    }

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    const headers = {
      'X-RateLimit-Limit': String(max),
      'X-RateLimit-Remaining': String(Math.max(0, max - bucket.count)),
    };
    if (bucket.count > max) {
      return [429, { error: 'rate limit exceeded' }, {
        ...headers,
        'Retry-After': String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))),
      }];
    }

    const [status, payload, extra] = await handler(ctx);
    return [status, payload, { ...headers, ...(extra ?? {}) }];
  };
}

export default {
  path: '/api/ping',
  methods: {
    // Demo endpoint: 5 requests per 10 seconds per client. Copy this pattern
    // onto real routes, then delete or keep the demo as a health probe.
    GET: rateLimit({ max: 5, windowMs: 10_000 })(async () => [200, { pong: true }]),
  },
};
