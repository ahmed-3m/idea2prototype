// Idea2Prototype web template — zero-dependency app server (Node >= 18)
// Route modules in routes/*.mjs export route definitions; handlers return
// [status, payload] and the server sends them as JSON.
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const PUBLIC_DIR = join(ROOT, 'public');
const ROUTES_DIR = join(ROOT, 'routes');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function loadApiRoutes() {
  const routes = [];
  let files = [];
  try {
    files = await readdir(ROUTES_DIR);
  } catch {
    return routes; // no routes yet — static + health only
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
      if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, url, res);
      return sendJson(res, 404, { error: 'not found' });
    } catch (err) {
      return sendJson(res, 500, { error: String(err?.message ?? err) });
    }
  });

  async function serveStatic(req, url, res) {
    let filePath = decodeURIComponent(url.pathname);
    if (filePath === '/' || filePath === '') filePath = '/index.html';
    const full = join(PUBLIC_DIR, filePath);
    if (!full.startsWith(PUBLIC_DIR)) return sendJson(res, 400, { error: 'bad path' });
    let fileStat;
    try {
      fileStat = await stat(full);
    } catch {
      return sendJson(res, 404, { error: 'not found' });
    }
    if (!fileStat.isFile()) return sendJson(res, 404, { error: 'not found' });
    const data = await readFile(full);
    res.writeHead(200, { 'content-type': MIME[extname(full)] ?? 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : data);
  }

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
  console.log(`Idea2Prototype app running at http://127.0.0.1:${app.port}`);
}
