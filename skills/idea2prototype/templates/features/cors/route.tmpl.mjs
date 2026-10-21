// Idea2Prototype feature: cors — Cross-Origin Resource Sharing wrapper.
// Contract: handlers return [status, payload, headers?]; the server merges the
// returned headers into the response. cors() wraps any handler to answer
// preflights and stamp access-control-* headers on every response.
//
// Like all CORS middleware this only sets browser-negotiation headers — it is
// not authentication. Browser-enforced, fine for prototypes; put a real
// origin allowlist in front of anything exposed to the internet.

/**
 * Wrap a route handler with CORS behavior.
 * `origin`: '*' (default), a single origin string, or an array of allowed
 * origins (matched request origins are reflected). OPTIONS preflights are
 * answered 204 without touching the handler.
 */
export function cors({
  origin = '*',
  methods = 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  headers = 'content-type',
  maxAge = 86_400,
  credentials = false,
} = {}) {
  const allowOrigin = (requestOrigin) => {
    if (Array.isArray(origin)) return origin.includes(requestOrigin) ? requestOrigin : null;
    return origin;
  };
  const baseHeaders = {
    'access-control-allow-methods': methods,
    'access-control-allow-headers': headers,
    'access-control-max-age': String(maxAge),
    ...(credentials ? { 'access-control-allow-credentials': 'true' } : {}),
  };
  return (handler) => async (ctx) => {
    const allowed = allowOrigin(ctx.req.headers.origin);
    const corsHeaders = {
      ...baseHeaders,
      ...(allowed ? { 'access-control-allow-origin': allowed } : {}),
      vary: 'Origin',
    };
    if (ctx.req.method === 'OPTIONS') return [204, null, corsHeaders];
    const result = await handler(ctx);
    // Not [status, payload, headers?] (a streaming handler's undefined, a
    // contract bug): pass it through untouched — the server streams or 500s
    // it cleanly; destructuring here would leak "is not iterable".
    if (!Array.isArray(result)) return result;
    const [status, payload, resHeaders] = result;
    return [status, payload, { ...corsHeaders, ...(resHeaders ?? {}) }];
  };
}

// Demo route so the effect is observable right after `add cors`.
// The server dispatches by method before the wrapper runs, so the wrapped
// handler must be registered under OPTIONS as well — the wrapper itself
// short-circuits preflights to 204 with the CORS headers.
const ping = cors()(() => [200, { pong: true, at: new Date().toISOString() }]);
export default [
  {
    path: '/api/cors-ping',
    methods: { GET: ping, OPTIONS: ping },
  },
];
