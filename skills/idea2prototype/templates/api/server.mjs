// Idea2Prototype api template — zero-dependency JSON API server (Node >= 18)
// Route modules in routes/*.mjs export route definitions; handlers return
// [status, payload] and the server sends them as JSON.
import { createServer } from 'node:http';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const ROUTES_DIR = join(ROOT, 'routes');

async function loadApiRoutes() {
  const routes = [];
  let files = [];
  try {
    files = await readdir(ROUTES_DIR);
  } catch {
    return routes;
  }
  for (const file of files.filter((f) => f.endsWith('.mjs')).sort()) {
    const mod = await import(pathToFileURL(join(ROUTES_DIR, file)).href);
    const defs = mod.default;
    if (!defs) continue;
    for (const route of Array.isArray(defs) ? defs : [defs]) routes.push(route);
  }
  return routes;
}

function matchRoute(route, url) {
  const routeParts = route.path.split('/').filter(Boolean);
  const urlParts = url.pathname.split('/').filter(Boolean);
  if (routeParts.length !== urlParts.length) return null;
  const params = {};
  for (let i = 0; i < routeParts.length; i++) {
    if (routeParts[i].startsWith(':')) params[routeParts[i].slice(1)] = decodeURIComponent(urlParts[i]);
    else if (routeParts[i] !== urlParts[i]) return null;
  }
  return params;
}

function readRawBody(req, limit = 10e6) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      // Oversize policy: drain up to 2x limit so a clean 413 can still be
      // delivered at end(); past 2x, destroy the socket to bound the cost of
      // absorbing junk — those clients see a connection reset, deliberately.
      if (size > limit) {
        tooLarge = true;
        if (size > limit * 2) {
          req.destroy();
          const err = new Error('body too large');
          err.code = 'BODY_TOO_LARGE';
          reject(err);
        }
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      if (tooLarge) {
        const err = new Error('body too large');
        err.code = 'BODY_TOO_LARGE';
        reject(err);
      } else {
        resolve(Buffer.concat(chunks));
      }
    });
    req.on('error', reject);
  });
}

// JSON.parse accepts nesting that JSON.stringify cannot write back (it
// recurses): a route that stores a 20k-deep body answers 500 "Maximum call
// stack size exceeded" on every later response that serializes it. Real
// payloads are a few levels deep — cap where bodies enter. Iterative, so the
// check itself cannot overflow.
const MAX_JSON_DEPTH = 100;
function tooDeep(value) {
  const stack = [[value, 1]];
  while (stack.length) {
    const [node, depth] = stack.pop();
    if (node === null || typeof node !== 'object') continue;
    if (depth > MAX_JSON_DEPTH) return true;
    for (const child of Object.values(node)) stack.push([child, depth + 1]);
  }
  return false;
}

function sendJson(res, status, payload, headers = {}) {
  // Handlers are user code — a bogus status must degrade to a clean 500, not
  // throw inside writeHead and leak Node internals ("Invalid status code: b").
  if (!Number.isInteger(status) || status < 100 || status > 599) status = 500;
  if (status === 204 || status === 304) {
    res.writeHead(status, headers);
    return res.end();
  }
  if (Buffer.isBuffer(payload)) {
    res.writeHead(status, { 'content-length': payload.length, ...headers });
    return res.end(payload);
  }
  // [status] with no payload serializes as null — JSON.stringify(undefined)
  // returns undefined and Buffer.byteLength would throw on it.
  const data = JSON.stringify(payload ?? null);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    ...headers,
  });
  res.end(data);
}

export async function start(requestedPort = Number(process.env.PORT ?? 3000), maxRetries = 10) {
  const apiRoutes = await loadApiRoutes();

  const server = createServer(async (req, res) => {
    try {
      // Malformed request targets ("//%5c..", "/%E0%A4%A") are client errors:
      // new URL and decodeURIComponent throw on them, and an escaped throw here
      // is an unhandled rejection that kills the whole server. Validating the
      // full pathname once also covers every segment matchRoute decodes.
      let url;
      try {
        url = new URL(req.url, 'http://127.0.0.1');
        decodeURIComponent(url.pathname);
      } catch {
        return sendJson(res, 400, { error: 'bad request path' });
      }
      if (url.pathname === '/api/health') {
        return sendJson(res, 200, { status: 'ok', uptime: Math.round(process.uptime() * 1000) });
      }
      for (const route of apiRoutes) {
        const params = matchRoute(route, url);
        if (!params) continue;
        const handler = route.methods?.[req.method];
        if (!handler) return sendJson(res, 405, { error: 'method not allowed' });
        const ctx = { url, params, req, res };
        if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
          let raw;
          try {
            raw = await readRawBody(req);
          } catch (err) {
            if (err.code === 'BODY_TOO_LARGE') {
              return sendJson(res, 413, { error: 'body too large' });
            }
            return sendJson(res, 400, { error: String(err?.message ?? err) });
          }
          if ((req.headers['content-type'] ?? '').includes('multipart/form-data')) {
            ctx.rawBody = raw;
          } else if (raw.length) {
            try {
              ctx.body = JSON.parse(raw.toString('utf8'));
            } catch {
              return sendJson(res, 400, { error: 'invalid JSON body' });
            }
            if (tooDeep(ctx.body)) return sendJson(res, 400, { error: `JSON body nested too deeply (max ${MAX_JSON_DEPTH} levels)` });
          }
        }
        const result = await handler(ctx);
        // Streaming escape hatch: a handler that wrote chunks directly to
        // ctx.res (e.g. Server-Sent Events) returns nothing — the stream
        // stays open past this request; don't try to send a JSON response.
        if (res.headersSent || res.writableEnded) return;
        // Contract-violating returns (a bare string, undefined, ...) must be
        // a clean 500 — destructuring them would leak parser plumbing
        // ("result is not iterable") into the response.
        if (!Array.isArray(result)) {
          return sendJson(res, 500, { error: 'handler returned an invalid result (expected [status, payload, headers?])' });
        }
        const [status, payload, headers] = result;
        return sendJson(res, status, payload, headers);
      }
      if (url.pathname === '/') {
        return sendJson(res, 200, {
          name: 'idea2prototype-api',
          routes: ['/api/health', ...apiRoutes.map((r) => r.path)],
        });
      }
      return sendJson(res, 404, { error: 'not found' });
    } catch (err) {
      // Streaming handlers may have sent headers before throwing — sendJson
      // would then throw ERR_HTTP_HEADERS_SENT inside this catch and crash
      // the process. Kill the socket instead; the response is already broken.
      if (res.headersSent || res.writableEnded) {
        res.destroy();
        return;
      }
      return sendJson(res, 500, { error: String(err?.message ?? err) });
    }
  });

  // Listen with a one-shot error handler: a busy port emits 'error' on the
  // server, and without a listener Node kills the process with a raw stack.
  const tryListen = (p) =>
    new Promise((resolveListen, rejectListen) => {
      const onError = (err) => {
        server.removeListener('listening', onListening);
        rejectListen(err);
      };
      const onListening = () => {
        server.removeListener('error', onError);
        resolveListen();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(p, '127.0.0.1');
    });

  // Port hunting: with no explicit PORT, a busy 3000 falls forward to 3001,
  // 3002, ... (Vite-style) so two prototypes can run side by side. An
  // explicit PORT and start(0) never hunt — they asked for that port (or
  // the OS's choice).
  const isExplicitPort = Boolean(process.env.PORT);
  let port = requestedPort;
  for (let attempts = 0; ; attempts++) {
    try {
      await tryListen(port);
      break;
    } catch (err) {
      if (err?.code === 'EADDRINUSE' && !isExplicitPort && requestedPort !== 0 && attempts < maxRetries) {
        port++;
        continue;
      }
      if (err?.code === 'EADDRINUSE') {
        throw new Error(`Port ${port} is already in use. Run with PORT=<number> npm start, or free port ${port}.`);
      }
      throw err;
    }
  }
  return {
    server,
    port: server.address().port,
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  try {
    const app = await start();
    // Silent hunt by design: when the port fell forward, this URL line is
    // the single signal of where the app actually landed.
    console.log(`Idea2Prototype API running at http://127.0.0.1:${app.port}`);
  } catch (err) {
    console.error(String(err?.message ?? err));
    process.exit(1);
  }
}
