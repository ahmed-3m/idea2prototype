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
    return routes; // no routes yet — health + index only
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
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, payload, headers = {}) {
  if (status === 204 || status === 304) {
    res.writeHead(status, headers);
    return res.end();
  }
  if (Buffer.isBuffer(payload)) {
    res.writeHead(status, { 'content-length': payload.length, ...headers });
    return res.end(payload);
  }
  const data = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    ...headers,
  });
  res.end(data);
}

export async function start(port = Number(process.env.PORT ?? 3000)) {
  const apiRoutes = await loadApiRoutes();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
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
            return sendJson(res, 400, { error: err.message });
          }
          if ((req.headers['content-type'] ?? '').includes('multipart/form-data')) {
            ctx.rawBody = raw;
          } else if (raw.length) {
            try {
              ctx.body = JSON.parse(raw.toString('utf8'));
            } catch {
              return sendJson(res, 400, { error: 'invalid JSON body' });
            }
          }
        }
        const result = await handler(ctx);
        // Streaming escape hatch: a handler that wrote chunks directly to
        // ctx.res (e.g. Server-Sent Events) returns nothing — the stream
        // stays open past this request; don't try to send a JSON response.
        if (res.headersSent || res.writableEnded) return;
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

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
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
  const app = await start();
  console.log(`Idea2Prototype API running at http://127.0.0.1:${app.port}`);
}
