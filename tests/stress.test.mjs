// Adversarial stress suite: concurrency, volume, malformed input, and random
// combinations against the engine AND the servers it generates — the
// conditions coding agents actually create (parallel checks, request bursts,
// odd names, huge repos). The e2e suite proves each path works once; this one
// proves it keeps working under abuse.
//
//   node --test tests/stress.test.mjs
//   I2P_STRESS_SEED=1234 node --test tests/stress.test.mjs   # replay a run
//   I2P_STRESS_SCALE=3   node --test tests/stress.test.mjs   # more iterations
//   I2P_STRESS_KEEP=1    ...                                  # keep temp dirs
//
// Every randomized test draws from its own seeded stream (seed ^ test name),
// so a failure replays exactly with the seed printed in its message.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../skills/idea2prototype/scripts/idea2prototype.mjs', import.meta.url));
const DRIVER = fileURLToPath(new URL('./stress-driver.mjs', import.meta.url));
const SEED = Number(process.env.I2P_STRESS_SEED ?? Math.floor(Math.random() * 2 ** 31));
const SCALE = Math.max(0.25, Number(process.env.I2P_STRESS_SCALE ?? 1));
const KEEP = process.env.I2P_STRESS_KEEP === '1';
const n = (base) => Math.max(1, Math.round(base * SCALE));
const tag = (msg) => `${msg}  [replay: I2P_STRESS_SEED=${SEED}]`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

console.log(`# stress seed=${SEED} scale=${SCALE} (replay: I2P_STRESS_SEED=${SEED})`);

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

// mulberry32 — tiny, seedable, good enough for input generation.
function prng(name) {
  let a = (SEED ^ Number.parseInt(createHash('sha1').update(name).digest('hex').slice(0, 8), 16)) >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = (arr) => arr[Math.floor(next() * arr.length)];
  const shuffle = (arr) => {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  return { next, int, pick, shuffle, chance: (p) => next() < p };
}

// Run the engine; never throws — the exit code IS the result under test.
function cli(args, { cwd, timeout = 180_000 } = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args], { cwd, timeout, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        code: err ? (typeof err.code === 'number' ? err.code : -1) : 0,
        signal: err?.signal ?? null,
        stdout,
        stderr,
      });
    });
  });
}

async function tempRoot(t, prefix = 'i2p-stress-') {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  if (KEEP) t.diagnostic(`kept: ${dir}`);
  else t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  return dir;
}

// features: 'cors' or ['api-crud', 'items']
async function scaffold(t, template, features = [], root) {
  const dir = root ?? (await tempRoot(t));
  const made = await cli(['new', 'app', '--template', template], { cwd: dir });
  assert.equal(made.code, 0, `new ${template} failed: ${made.stderr}`);
  const projectDir = join(dir, 'app');
  for (const f of features) {
    const [name, resource] = Array.isArray(f) ? f : [f];
    const added = await cli(['add', name, ...(resource ? ['--resource', resource] : [])], { cwd: projectDir });
    assert.equal(added.code, 0, `add ${name} failed: ${added.stderr}`);
  }
  return projectDir;
}

// Bounded-parallel map (results keep input order).
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const k = next++;
      out[k] = await fn(items[k], k);
    }
  }));
  return out;
}

// Boot a project's server in its own process via the driver (see
// stress-driver.mjs). stop() reports whether the process exited on its own.
async function serve(projectDir) {
  const child = spawn(process.execPath, [DRIVER], { cwd: projectDir, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  let exited = null;
  const exit = new Promise((resolve) => child.on('exit', (code, signal) => { exited = { code, signal }; resolve(exited); }));
  const port = await new Promise((resolve, reject) => {
    let buf = '';
    let announced = false;
    child.stdout.on('data', (d) => {
      buf += d;
      const nl = buf.indexOf('\n');
      if (nl !== -1 && !announced) {
        announced = true;
        resolve(JSON.parse(buf.slice(0, nl)).port);
      }
    });
    exit.then(() => reject(new Error(`driver exited before listening: ${stderr}`)));
  });
  return {
    port,
    base: `http://127.0.0.1:${port}`,
    alive: () => exited === null,
    stderr: () => stderr,
    async stop(ms = 10_000) {
      if (exited) return { leaked: false, crashed: true, ...exited, stderr };
      child.stdin.end();
      const started = Date.now();
      const res = await Promise.race([exit, sleep(ms).then(() => null)]);
      if (!res) {
        child.kill();
        await exit;
        return { leaked: true, stderr };
      }
      return { leaked: false, crashed: false, ms: Date.now() - started, ...res, stderr };
    },
  };
}

// Raw HTTP (node:http, not fetch): fetch normalizes dot segments and
// percent-encodings away, and the point here is sending what a hostile client
// sends. Never rejects. status 0 = connection broke; -1 = client refused.
function raw(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve) => {
    let req;
    const hdrs = body !== undefined ? { 'content-length': Buffer.byteLength(body), ...headers } : headers;
    try {
      req = request({ host: '127.0.0.1', port, method, path, headers: hdrs, timeout: 30_000 }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', (e) => resolve({ status: 0, error: e.code ?? e.message }));
      });
    } catch (err) {
      return resolve({ status: -1, error: err.code ?? err.message });
    }
    req.on('timeout', () => req.destroy(new Error('client timeout')));
    req.on('error', (e) => resolve({ status: 0, error: e.code ?? e.message }));
    req.end(body);
  });
}
const json = (port, method, path, data, headers = {}) =>
  raw(port, { method, path, body: JSON.stringify(data), headers: { 'content-type': 'application/json', ...headers } })
    .then((r) => ({ ...r, data: (() => { try { return JSON.parse(r.body.toString('utf8')); } catch { return undefined; } })() }));

// Every file under root (minus runtime stores) as "path:size".
async function snapshot(root, skip = new Set(['data', 'uploads', 'node_modules'])) {
  const out = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(`${relative(root, full).split(sep).join('/')}:${(await stat(full)).size}`);
    }
  }
  await walk(root);
  return out.sort();
}

const ALL_FEATURES = [['api-crud', 'items'], ['api-crud', 'notes'], 'auth-local', 'upload', 'rate-limit', 'cors', 'sse', 'worker-jobs'];
const TEMPLATES = ['web', 'api', 'cli', 'worker', 'library'];

// Node/engine internals that must never reach a client or an agent.
const HTTP_LEAK = /is not iterable|URI malformed|ERR_[A-Z_]{3,}|node:internal|\bat .+\.m?js:\d+|Maximum call stack|Cannot read propert|is not a function/;
const CLI_LEAK = /node:internal|\n\s+at .+:\d+:\d+|Cannot read propert|is not a function|is not iterable|Unexpected (?:token|non-whitespace|end of JSON)|in JSON at position|\bE[A-Z]{3,}: /;

// ---------------------------------------------------------------------------
// A. store concurrency — bursts against the generated persistence layers
// ---------------------------------------------------------------------------

test('A1 CRUD burst + mixed PUT/DELETE: the store after restart equals the store before (H1)', { timeout: 600_000 }, async (t) => {
  const projectDir = await scaffold(t, 'web', [['api-crud', 'items']]);
  const pad = 'x'.repeat(20_000); // big rows -> slow writes -> overlapping persists
  for (let round = 0; round < n(4); round++) {
    await rm(join(projectDir, 'data'), { recursive: true, force: true });
    let app = await serve(projectDir);
    const created = await Promise.all(Array.from({ length: 150 }, (_, i) => json(app.port, 'POST', '/api/items', { i, pad })));
    assert.ok(created.every((r) => r.status === 201), tag(`round ${round}: some POSTs failed: ${[...new Set(created.map((r) => r.status))]}`));
    await Promise.all(created.slice(0, 75).map((r, k) => (k % 2
      ? raw(app.port, { method: 'DELETE', path: `/api/items/${r.data.id}` })
      : json(app.port, 'PUT', `/api/items/${r.data.id}`, { edited: true }))));
    const before = (await json(app.port, 'GET', '/api/items')).data;
    assert.equal((await app.stop()).leaked, false);

    const files = await readdir(join(projectDir, 'data'));
    assert.deepEqual(files.filter((f) => f.includes('.corrupt-')), [], tag(`round ${round}: store was corrupted on disk`));
    assert.doesNotThrow(() => JSON.parse(String(readFileSyncSafe(join(projectDir, 'data', 'items.json')))), tag(`round ${round}: items.json does not parse`));

    app = await serve(projectDir);
    const after = (await json(app.port, 'GET', '/api/items')).data;
    await app.stop();
    const key = (list) => list.map((x) => `${x.id}:${x.edited === true}`).sort();
    assert.deepEqual(key(after), key(before), tag(`round ${round}: rows lost or stale after restart (${before.length} -> ${after.length})`));
  }
});

function readFileSyncSafe(path) {
  try {
    return readFileSync(path);
  } catch (err) {
    return `<<unreadable: ${err.code}>>`;
  }
}

test('A2 auth: concurrent registers + cold-start logins survive a restart (H1, H2)', { timeout: 600_000 }, async (t) => {
  const projectDir = await scaffold(t, 'web', ['auth-local']);
  for (let round = 0; round < n(3); round++) {
    await rm(join(projectDir, 'data'), { recursive: true, force: true });
    let app = await serve(projectDir);
    const users = Array.from({ length: 30 }, (_, i) => `user${round}_${i}`);
    const reg = await Promise.all(users.map((username) => json(app.port, 'POST', '/api/auth/register', { username, password: 'password123' })));
    assert.ok(reg.every((r) => r.status === 201), tag(`round ${round}: registers: ${reg.map((r) => r.status)}`));
    // Cold secret: none of these logins has a persisted secret to read yet.
    const logins = await Promise.all(users.map((username) => json(app.port, 'POST', '/api/auth/login', { username, password: 'password123' })));
    const cookies = logins.map((r) => String(r.headers['set-cookie'] ?? '').split(';')[0]);
    const me = async (port) => Promise.all(cookies.map((cookie) => raw(port, { path: '/api/auth/me', headers: { cookie } }).then((r) => r.status)));
    assert.deepEqual([...new Set(await me(app.port))], [200], tag(`round ${round}: fresh sessions rejected`));
    await app.stop();

    app = await serve(projectDir);
    assert.deepEqual([...new Set(await me(app.port))], [200], tag(`round ${round}: sessions rejected after restart — persisted secret differs from the one that signed them`));
    const relog = await Promise.all(users.map((username) => json(app.port, 'POST', '/api/auth/login', { username, password: 'password123' })));
    assert.deepEqual([...new Set(relog.map((r) => r.status))], [200], tag(`round ${round}: accounts lost after restart`));
    await app.stop();
  }
});

test('A3 worker-jobs: 100 concurrent enqueues drain exactly once and persist', { timeout: 300_000 }, async (t) => {
  const projectDir = await scaffold(t, 'api', ['worker-jobs']);
  let app = await serve(projectDir);
  const posted = await Promise.all([
    ...Array.from({ length: 100 }, (_, i) => json(app.port, 'POST', '/api/jobs', { type: 'echo', payload: { i } })),
    ...Array.from({ length: 10 }, () => json(app.port, 'POST', '/api/jobs', { type: 'fail' })),
  ]);
  assert.ok(posted.every((r) => r.status === 202), tag(`enqueue statuses: ${[...new Set(posted.map((r) => r.status))]}`));
  let jobs;
  for (let i = 0; i < 300; i++) {
    jobs = (await json(app.port, 'GET', '/api/jobs')).data;
    if (jobs.every((j) => j.status !== 'queued')) break;
    await sleep(100);
  }
  const by = (s) => jobs.filter((j) => j.status === s).length;
  assert.equal(jobs.length, 110);
  assert.equal(by('done'), 100, tag('echo jobs not all done'));
  assert.equal(by('failed'), 10);
  assert.ok(jobs.filter((j) => j.type === 'echo').every((j) => j.attempts === 1), 'an echo job ran more than once');
  assert.ok(jobs.filter((j) => j.type === 'fail').every((j) => j.attempts === 3), 'fail jobs must retry exactly 3 times');
  await app.stop();
  app = await serve(projectDir);
  const after = (await json(app.port, 'GET', '/api/jobs')).data;
  assert.deepEqual(after.map((j) => `${j.id}:${j.status}`).sort(), jobs.map((j) => `${j.id}:${j.status}`).sort());
  await app.stop();
});

test('A4 SSE: 50 streams, half aborted mid-stream, then close — no timer outlives the app (H15)', { timeout: 120_000 }, async (t) => {
  const projectDir = await scaffold(t, 'web', ['sse']);
  const app = await serve(projectDir);
  const controllers = Array.from({ length: 50 }, () => new AbortController());
  const readers = await Promise.all(controllers.map(async (c) => {
    const res = await fetch(`${app.base}/api/events`, { signal: c.signal });
    assert.equal(res.status, 200);
    const reader = res.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /event: connected/);
    return reader;
  }));
  controllers.slice(0, 25).forEach((c) => c.abort());
  await sleep(1500); // at least one heartbeat on the survivors
  assert.ok(app.alive(), 'server died while streams were aborted');
  const stopped = await app.stop(5_000);
  controllers.forEach((c) => c.abort());
  await Promise.allSettled(readers.map((r) => r.cancel()));
  assert.equal(stopped.leaked, false, 'server process kept running after app.close() — a heartbeat interval leaked');
});

test('A5 uploads: 20 concurrent 4 MB uploads round-trip byte-identical', { timeout: 300_000 }, async (t) => {
  const projectDir = await scaffold(t, 'web', ['upload']);
  const app = await serve(projectDir);
  const blobs = Array.from({ length: 20 }, () => randomBytes(4 * 1024 * 1024));
  const sha = (buf) => createHash('sha256').update(buf).digest('hex');
  const ups = await Promise.all(blobs.map(async (buf, i) => {
    const form = new FormData();
    form.append('file', new Blob([buf]), 'same-name.bin'); // same client name: storage must not collide
    const res = await fetch(`${app.base}/api/uploads`, { method: 'POST', body: form });
    return { i, status: res.status, body: await res.json() };
  }));
  assert.ok(ups.every((u) => u.status === 201), tag(`upload statuses: ${ups.map((u) => u.status)}`));
  assert.equal(new Set(ups.map((u) => u.body.url)).size, 20, 'two uploads were stored under the same name');
  for (const u of ups) {
    const back = Buffer.from(await (await fetch(`${app.base}${u.body.url}`)).arrayBuffer());
    assert.equal(sha(back), sha(blobs[u.i]), `upload ${u.i} came back different`);
  }
  assert.equal((await app.stop()).leaked, false);
});

// ---------------------------------------------------------------------------
// B. HTTP fuzz — every feature mounted, hostile requests, hard invariants
// ---------------------------------------------------------------------------

const SECRET = 'STRESS-SECRET-MARKER-7f3a';
const METHODS = ['GET', 'GET', 'GET', 'POST', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD', 'PROPFIND'];
const ROUTES = ['/', '/api/health', '/api/items', '/api/items/:id', '/api/notes/:id', '/api/auth/register', '/api/auth/login', '/api/auth/me',
  '/api/auth/logout', '/api/uploads', '/api/uploads/:id', '/api/ping', '/api/cors-ping', '/api/jobs', '/index.html', '/app.js', '/styles.css', '/nope'];
const SEGMENTS = ['abc', '00000000-0000-0000-0000-000000000000', '%E0%A4%A', '%', '%zz', '%C0%AF', '..', '%2e%2e', '..%2f..%2fpackage.json',
  '%2e%2e%2fpackage.json', '%00', '%u0041', encodeURIComponent('ü😀'), 'a'.repeat(4000), '%2f', '%5c..%5c', encodeURIComponent('‮')];
const SPECIAL_PATHS = ['/..%2fpublic-private/secret.txt', '/%2e%2e/public-private/secret.txt', '/..%5cpublic-private%5csecret.txt',
  '/%2e%2e%2fpublic-private%2fsecret.txt', '/api/uploads/..%2f..%2fpublic-private%2fsecret.txt', '/api/uploads/%2e%2e%2fpackage.json',
  '/%E0%A4%A', '/api/%ff', '//api/health', '/api/health?%E0%A4%A', '/?' + 'q='.repeat(2000), '*'];

function genBody(r) {
  const deep = (d, open, close) => open.repeat(d) + close.repeat(d);
  const nest = (d) => `${'{"a":'.repeat(d)}1${'}'.repeat(d)}`;
  const boundary = `----stress${r.int(0, 1e6)}`;
  const mp = (content, extra = {}) => ({ body: content, type: `multipart/form-data; boundary=${extra.boundary ?? boundary}` });
  const part = (name, filename, data) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n${data}\r\n`;
  return r.pick([
    () => ({}),
    () => ({ body: '{', type: 'application/json' }),
    () => ({ body: 'null', type: 'application/json' }),
    () => ({ body: '[]', type: 'application/json' }),
    () => ({ body: '"str"', type: 'application/json' }),
    () => ({ body: '123', type: 'application/json' }),
    () => ({ body: '﻿{"a":1}', type: 'application/json' }),
    () => ({ body: JSON.stringify({ title: 'x', n: r.int(0, 1e9), nested: { ok: true } }), type: 'application/json' }),
    () => ({ body: deep(r.pick([1000, 10_000, 100_000]), '[', ']'), type: 'application/json' }),
    () => ({ body: nest(r.pick([100, 2_000, 20_000])), type: 'application/json' }),
    () => ({ body: '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"id":"forged","createdAt":"forged"}', type: 'application/json' }),
    () => ({ body: JSON.stringify({ s: 'z'.repeat(2_000_000) }), type: 'application/json' }),
    () => ({ body: JSON.stringify({ username: `u${r.int(0, 99999)}`, password: 'password123' }), type: 'application/json' }),
    () => ({ body: JSON.stringify({ username: { $ne: 1 }, password: ['x'] }), type: 'application/json' }),
    () => ({ body: JSON.stringify({ type: r.pick(['echo', 'fail', 'nope', '', ' ']), payload: { i: r.int(0, 9) } }), type: 'application/json' }),
    () => ({ body: 'not json at all', type: 'text/plain' }),
    () => mp(part('file', 'ok.txt', 'hello')),
    () => mp(part('file', '../../x.txt', 'trav')),
    () => mp(part('file', 'evil.html', '<script>alert(1)</script>')),
    () => mp(part('file', 'q"uote.txt', 'q')),
    () => mp(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="open.txt"\r\n\r\nno closing boundary`),
    () => mp(part('file', 'inner.txt', `data containing --${boundary} inside`) + `--${boundary}--\r\n`),
    () => mp(Array.from({ length: 1000 }, (_, i) => part(`f${i}`, `f${i}.txt`, 'x')).join('') + `--${boundary}--\r\n`),
    () => mp(part('file', 'x.txt', 'x'), { boundary: '' }),
    () => ({ body: 'x', type: 'multipart/form-data' }),
    () => ({ body: 'x', type: 'multipart/form-data; boundary="unterminated' }),
  ])();
}

function genRequest(r) {
  const method = r.pick(METHODS);
  let path;
  if (r.chance(0.2)) {
    path = r.pick(SPECIAL_PATHS);
  } else {
    path = r.pick(ROUTES).replace(/:[a-z]+/, () => r.pick(SEGMENTS));
    if (r.chance(0.2)) path += `/${r.pick(SEGMENTS)}`;
    if (r.chance(0.15)) path += `?status=${r.pick(SEGMENTS)}`;
  }
  // GET /api/events never ends by design — fuzzing it would just hang clients
  const req = { method, path, headers: {} };
  if (!['GET', 'HEAD'].includes(method)) {
    const { body, type } = genBody(r);
    if (body !== undefined) req.body = body;
    if (type) req.headers['content-type'] = type;
  }
  if (r.chance(0.1)) req.headers.origin = r.pick(['https://evil.example', 'null', 'http://127.0.0.1']);
  if (r.chance(0.1)) req.headers.cookie = r.pick(['i2p_session=', 'i2p_session=a.b', 'i2p_session=%%%', `i2p_session=${'A'.repeat(4000)}.x`]);
  return req;
}

for (const template of ['web', 'api']) {
  test(`B ${template}+all features: ${n(400)} fuzzed requests — no 5xx, no leaks, no crash, no escape (H3, H4, H8)`, { timeout: 900_000 }, async (t) => {
    const r = prng(`B-${template}`);
    const projectDir = await scaffold(t, template, ALL_FEATURES);
    await mkdir(join(projectDir, 'public-private'), { recursive: true });
    await writeFile(join(projectDir, 'public-private', 'secret.txt'), SECRET);
    // Sibling dirs like public-private/ live beside public/ and uploads/ —
    // the classic prefix-check escape target.
    await mkdir(join(projectDir, 'uploads-private'), { recursive: true });
    await writeFile(join(projectDir, 'uploads-private', 'secret.txt'), SECRET);
    const before = await snapshot(projectDir);

    const app = await serve(projectDir);
    const violations = [];
    const describe = (q) => `${q.method} ${q.path.slice(0, 120)}${q.body ? ` body=${String(q.body).slice(0, 60)}…(${String(q.body).length}B)` : ''}`;
    const total = n(400);
    for (let done = 0; done < total && app.alive(); done += 20) {
      const batch = Array.from({ length: Math.min(20, total - done) }, () => genRequest(r));
      const results = await Promise.all(batch.map((q) => raw(app.port, q)));
      results.forEach((res, k) => {
        const q = batch[k];
        if (res.status === -1) return; // node:http refused to SEND it — not a server verdict
        const text = res.body?.toString('utf8') ?? '';
        if (res.status === 0) violations.push(`connection broke (${res.error}): ${describe(q)}`);
        else if (res.status >= 500) violations.push(`${res.status} ${text.slice(0, 120)}: ${describe(q)}`);
        if (HTTP_LEAK.test(text)) violations.push(`leaked internals "${HTTP_LEAK.exec(text)[0]}": ${describe(q)}`);
        if (text.includes(SECRET)) violations.push(`served a file outside its root: ${describe(q)}`);
      });
      if (!app.alive()) break;
      const health = await raw(app.port, { path: '/api/health' });
      if (health.status !== 200) violations.push(`health ${health.status} after batch ending at ${done + batch.length}`);
    }
    const crashed = !app.alive();
    const stopped = await app.stop();
    if (crashed) violations.unshift(`SERVER CRASHED: ${stopped.stderr.split('\n').find((l) => /Error/.test(l)) ?? stopped.stderr.slice(0, 300)}`);
    else if (stopped.leaked) violations.push('server process did not exit after close()');

    const after = await snapshot(projectDir);
    const added = after.filter((f) => !before.includes(f));
    const removed = before.filter((f) => !after.includes(f));
    if (added.length || removed.length) violations.push(`files changed outside data/ + uploads/: +${added.join(',')} -${removed.join(',')}`);

    const unique = [...new Set(violations)];
    assert.deepEqual(unique.slice(0, 15), [], tag(`${unique.length} distinct violations (first 15 shown)`));
  });
}

// ---------------------------------------------------------------------------
// C. CLI fuzz — the engine itself under hostile argv and hostile markers
// ---------------------------------------------------------------------------

test(`C1 ${n(240)} random engine invocations: exit 0/1, readable errors, nothing half-written`, { timeout: 900_000 }, async (t) => {
  const r = prng('C1');
  const root = await tempRoot(t);
  const seedProject = await scaffold(t, 'web', [], await tempRoot(t));
  const COMMANDS = ['new', 'new', 'new', 'add', 'add', 'map', 'verify', 'check', 'list', 'version', 'help', 'bogus', ''];
  const FLAGS = ['--template', '--name', '--idea', '--resource', '--json', '--bogus', '--template=web', '-x', '--', '---', '--name='];
  const VALUES = ['web', 'api', 'cli', 'worker', 'library', 'features', 'nope', '', ' ', 'con', 'NUL', 'lpt9', '..', '../..', '.',
    'a'.repeat(250), 'ü', '😀', "x$'y", '$&', 'my app', '-dash', 'Ab_C-1', 'items', 'users', 'Users', 'full', 'afile', 'sub/dir/proj',
    'con/proj', '<abs>', 'cors', 'sse', 'upload', 'api-crud', 'auth-local', 'rate-limit', 'worker-jobs'];
  const runs = Array.from({ length: n(240) }, () => {
    const cmd = r.pick(COMMANDS);
    const argv = [cmd, ...Array.from({ length: r.int(0, 4) }, () => (r.chance(0.35) ? r.pick(FLAGS) : r.pick(VALUES)))].filter((a, i) => i > 0 || a !== '');
    // check/verify with VALID args run a full verdict (seconds each) — the
    // argv fuzz targets parsing, so make most of them die fast.
    if ((cmd === 'check' || cmd === 'verify') && r.chance(0.85)) argv.push('--bogus');
    return argv;
  });

  const violations = [];
  await pool(runs, 8, async (argv, i) => {
    // Each run gets a private sandbox: <run>/w/x is the cwd, pre-seeded with
    // a non-empty dir and a plain file so `new` can collide with both.
    const sandbox = join(root, `r${i}`);
    const cwd = argv[0] === 'add' || argv[0] === 'check' ? join(sandbox, 'proj') : join(sandbox, 'w', 'x');
    if (cwd.endsWith('proj')) await cp(seedProject, cwd, { recursive: true });
    else {
      await mkdir(join(cwd, 'full'), { recursive: true });
      await writeFile(join(cwd, 'full', 'keep.txt'), 'keep');
      await writeFile(join(cwd, 'afile'), 'plain file');
    }
    const args = argv.map((a) => (a === '<abs>' ? join(sandbox, 'abs-target') : a));
    const res = await cli(args, { cwd, timeout: 120_000 });
    const where = `\`${args.join(' ')}\` (run ${i})`;
    const out = `${res.stdout}\n${res.stderr}`;
    if (res.code !== 0 && res.code !== 1) violations.push(`exit ${res.code}${res.signal ? ` signal ${res.signal}` : ''}: ${where}`);
    if (CLI_LEAK.test(out)) violations.push(`leaked "${CLI_LEAK.exec(out)[0].trim()}": ${where} -> ${res.stderr.trim().slice(0, 160)}`);
    if (res.code === 1 && !res.stderr.trim().startsWith('idea2prototype:') && !/Idea2Prototype (check|verify) — FAIL/.test(res.stdout)) {
      violations.push(`exit 1 without a readable verdict or idea2prototype: error: ${where} -> ${res.stderr.trim().slice(0, 160)}`);
    }
    if (!cwd.endsWith('proj')) {
      if ((await readFile(join(cwd, 'full', 'keep.txt'), 'utf8')) !== 'keep' || (await readdir(join(cwd, 'full'))).length !== 1) {
        violations.push(`new touched a non-empty dir: ${where}`);
      }
      // A failed `new` must leave nothing half-written: every scaffold-shaped
      // dir in the sandbox must carry a marker that parses.
      for (const dir of await scaffoldDirs(sandbox)) {
        const marker = readFileSyncSafe(join(dir, '.idea2prototype.json'));
        try {
          JSON.parse(String(marker));
        } catch {
          violations.push(`half-written scaffold at ${relative(sandbox, dir)} (marker: ${String(marker).slice(0, 40)}): ${where}`);
        }
      }
    }
  });
  const unique = [...new Set(violations)];
  assert.deepEqual(unique.slice(0, 15), [], tag(`${unique.length} distinct violations (first 15 shown)`));
});

// Dirs containing a package.json (what `new` writes) under root.
async function scaffoldDirs(root) {
  const out = [];
  async function walk(dir, depth) {
    if (depth > 8) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.name === 'package.json')) out.push(dir);
    for (const e of entries) if (e.isDirectory() && e.name !== 'node_modules') await walk(join(dir, e.name), depth + 1);
  }
  await walk(root, 0);
  return out;
}

test('C2 new round-trip: accepted --name/--idea land byte-identical, rejected ones write nothing (H9, H10)', { timeout: 900_000 }, async (t) => {
  const r = prng('C2');
  const NASTY = ['$&', "$'", '$`', '$$', '$1', '{{slug}}', '{{name}}', '{{idea}}', '__IDEA2PROTOTYPE_CMD__', 'line sep', 'para sep',
    '😀 emoji', '‮RTL', '<script>alert(1)</script>', 'A & B', '%s %d', 'tab\tchar', 'quote"', 'back\\slash', 'é ñ', '*/ /*', '`${x}`'];
  const cases = [];
  for (const template of TEMPLATES) {
    // the worst case, always: every replacement pattern + a JS line terminator
    cases.push({ template, name: "x$'y $& {{slug}} {{idea}}", idea: 'costs $\' $` $$ $&   more {{name}} */', check: true });
    for (let k = 0; k < n(2); k++) {
      const pick = () => Array.from({ length: r.int(1, 3) }, () => r.pick(NASTY)).join(' ');
      cases.push({ template, name: pick(), idea: pick(), check: k === 0 });
    }
  }
  const violations = [];
  await pool(cases, 4, async (c, i) => {
    const root = await tempRoot(t);
    const res = await cli(['new', 'proj', '--template', c.template, '--name', c.name, '--idea', c.idea], { cwd: root });
    const where = `${c.template} --name ${JSON.stringify(c.name)} --idea ${JSON.stringify(c.idea)} (case ${i})`;
    const dir = join(root, 'proj');
    if (res.code !== 0) {
      if (!res.stderr.startsWith('idea2prototype:') || CLI_LEAK.test(res.stderr)) violations.push(`unreadable rejection "${res.stderr.trim().slice(0, 120)}": ${where}`);
      const left = await readdir(dir).catch(() => []);
      if (left.length) violations.push(`rejected but wrote ${left.length} entries: ${where}`);
      return;
    }
    let marker;
    try {
      marker = JSON.parse(await readFile(join(dir, '.idea2prototype.json'), 'utf8'));
    } catch (err) {
      violations.push(`marker does not parse (${err.message}): ${where}`);
      return;
    }
    const expectedName = c.name.replace(/[<>]/g, '');
    if (marker.name !== expectedName) violations.push(`marker.name ${JSON.stringify(marker.name)} != ${JSON.stringify(expectedName)}: ${where}`);
    // CRLF-normalized: a Windows checkout (core.autocrlf) ships CRLF templates.
    const spec = (await readFile(join(dir, 'PROTOTYPE.md'), 'utf8')).replaceAll('\r\n', '\n');
    if (!spec.includes(`> Idea: ${c.idea}\n`)) violations.push(`PROTOTYPE.md idea mangled: ${JSON.stringify(spec.split('\n')[2])}: ${where}`);
    const readme = (await readFile(join(dir, 'README.md'), 'utf8')).replaceAll('\r\n', '\n');
    if (!readme.startsWith(`# ${expectedName}\n`)) violations.push(`README title mangled: ${JSON.stringify(readme.split('\n')[0])}: ${where}`);
    if (c.check) {
      const checked = await cli(['check'], { cwd: dir });
      if (checked.code !== 0) violations.push(`fresh scaffold fails check: ${checked.stdout.split('\n').filter((l) => /FAIL/.test(l)).join(' | ').slice(0, 200)}: ${where}`);
    }
  });
  assert.deepEqual(violations, [], tag(`${violations.length} violations`));
});

test('C3 hand-edited markers: add/check/map give a readable error or a correct verdict, never a TypeError (H12)', { timeout: 600_000 }, async (t) => {
  const seedProject = await scaffold(t, 'web');
  const good = JSON.parse(await readFile(join(seedProject, '.idea2prototype.json'), 'utf8'));
  const without = (k) => { const m = { ...good }; delete m[k]; return JSON.stringify(m); };
  const MUTATIONS = {
    'utf-8 BOM': `﻿${JSON.stringify(good, null, 2)}`,
    'CRLF + trailing space': `${JSON.stringify(good, null, 2).replaceAll('\n', '\r\n')}  \r\n`,
    'no features': without('features'),
    'features is a string': JSON.stringify({ ...good, features: 'x' }),
    'features is null': JSON.stringify({ ...good, features: null }),
    'no template': without('template'),
    'template is a number': JSON.stringify({ ...good, template: 42 }),
    'unknown template': JSON.stringify({ ...good, template: 'nope' }),
    'version is a number': JSON.stringify({ ...good, version: 5 }),
    'empty file': '',
    'literal null': 'null',
    'array': '[]',
    'string': '"str"',
    'deep junk field': JSON.stringify({ ...good, junk: JSON.parse('['.repeat(500) + ']'.repeat(500)) }),
  };
  // Valid-JSON mutations a human plausibly makes that MUST keep working.
  const MUST_WORK = new Set(['utf-8 BOM', 'CRLF + trailing space', 'version is a number', 'deep junk field']);
  const violations = [];
  await pool(Object.entries(MUTATIONS), 4, async ([label, content]) => {
    const root = await tempRoot(t);
    const dir = join(root, 'proj');
    await cp(seedProject, dir, { recursive: true });
    await writeFile(join(dir, '.idea2prototype.json'), content);
    for (const argv of [['add', 'cors'], ['map'], ['check', '--json']]) {
      const res = await cli(argv, { cwd: dir });
      const where = `${argv.join(' ')} with marker "${label}"`;
      const out = `${res.stdout}\n${res.stderr}`;
      if (CLI_LEAK.test(out)) violations.push(`leaked "${CLI_LEAK.exec(out)[0].trim()}": ${where}`);
      if (res.code === 1 && !res.stderr.startsWith('idea2prototype:') && !argv.includes('check')) violations.push(`unreadable failure: ${where}`);
      if (MUST_WORK.has(label) && res.code !== 0) violations.push(`exit ${res.code}: ${where} -> ${res.stderr.trim().slice(0, 120)}`);
    }
  });
  assert.deepEqual(violations, [], tag(`${violations.length} violations`));
});

test('C4 new against awkward targets: a plain file, ".", a nested path through a file', { timeout: 120_000 }, async (t) => {
  const root = await tempRoot(t);
  await writeFile(join(root, 'afile'), 'x');
  for (const [argv, cwd] of [[['new', 'afile'], root], [['new', 'afile/proj'], root], [['new', '.'], await mkdtemp(join(root, 'empty-'))]]) {
    const res = await cli(argv, { cwd });
    assert.ok(res.code === 0 || res.stderr.startsWith('idea2prototype:'), `${argv.join(' ')}: ${res.stderr}`);
    assert.doesNotMatch(`${res.stdout}${res.stderr}`, CLI_LEAK, `${argv.join(' ')} leaked internals: ${res.stderr}`);
  }
  assert.equal(await readFile(join(root, 'afile'), 'utf8'), 'x', 'new overwrote a plain file');
});

// ---------------------------------------------------------------------------
// D. feature permutations — every feature, random orders, same outcome
// ---------------------------------------------------------------------------

for (const template of ['web', 'api']) {
  test(`D ${template}: all features stacked in ${n(2)} random orders give the same green verdict`, { timeout: 900_000 }, async (t) => {
    const r = prng(`D-${template}`);
    const verdicts = [];
    for (let k = 0; k < n(2); k++) {
      const order = r.shuffle(ALL_FEATURES);
      const projectDir = await scaffold(t, template, order);
      const res = await cli(['check', '--json'], { cwd: projectDir });
      const verdict = JSON.parse(res.stdout);
      const tests = verdict.steps.find((s) => s.name === 'tests');
      const where = `order ${order.map((f) => [f].flat().join(':')).join(' > ')}`;
      assert.equal(verdict.status, 'PASS', tag(`${where}: ${JSON.stringify(verdict.steps)}`));
      verdicts.push({ where, detail: tests.detail });

      const map = await cli(['map', '--json'], { cwd: projectDir });
      assert.doesNotThrow(() => JSON.parse(map.stdout), 'map --json is not JSON');
      for (const f of ALL_FEATURES) {
        const [name, resource] = [f].flat();
        const again = await cli(['add', name, ...(resource ? ['--resource', resource] : [])], { cwd: projectDir });
        assert.equal(again.code, 1, `re-adding ${name} must refuse`);
        assert.match(again.stderr, /^idea2prototype: .*already exists/, `re-adding ${name}: ${again.stderr}`);
      }
    }
    assert.equal(new Set(verdicts.map((v) => v.detail)).size, 1, tag(`order changed the verdict: ${JSON.stringify(verdicts)}`));
  });
}

// ---------------------------------------------------------------------------
// E. scale + pathological projects for verify/map
// ---------------------------------------------------------------------------

const verifyJson = async (dir, cwd) => {
  const res = await cli(['verify', dir, '--json'], { cwd, timeout: 600_000 });
  try {
    return { res, verdict: JSON.parse(res.stdout) };
  } catch {
    return { res, verdict: null };
  }
};
const stepOf = (verdict, name) => verdict?.steps.find((s) => s.name === name);

test(`E1 big foreign repo: ${n(600)} sources in nested dirs + 40 test files verifies PASS in bounded time`, { timeout: 900_000 }, async (t) => {
  const root = await tempRoot(t);
  const dir = join(root, 'big');
  for (let i = 0; i < n(600); i++) {
    const sub = join(dir, 'src', ...Array.from({ length: (i % 8) + 1 }, (_, d) => `d${d}`));
    await mkdir(sub, { recursive: true });
    await writeFile(join(sub, `m${i}.mjs`), `export const v${i} = ${i};\nexport function f${i}(x) { return x + v${i}; }\n`);
  }
  await mkdir(join(dir, 'test'), { recursive: true });
  for (let i = 0; i < 40; i++) {
    await writeFile(join(dir, 'test', `t${i}.mjs`), "import test from 'node:test';\nimport assert from 'node:assert';\ntest('a', () => assert.equal(1 + 1, 2));\ntest('b', () => {});\n");
  }
  const started = Date.now();
  const { res, verdict } = await verifyJson(dir, root);
  const secs = Math.round((Date.now() - started) / 1000);
  t.diagnostic(`verify of ${n(600) + 40} files took ${secs}s`);
  assert.equal(verdict?.status, 'PASS', `${res.stdout}${res.stderr}`);
  assert.match(stepOf(verdict, 'tests').detail, /^80 tests passed \(40 files\)/);
  assert.ok(secs < 300, `verify took ${secs}s`);
});

test('E2 a passing suite that logs 20 MiB still verifies PASS (H5)', { timeout: 300_000 }, async (t) => {
  const dir = join(await tempRoot(t), 'loud');
  await mkdir(dir);
  await writeFile(join(dir, 'loud.test.mjs'), "import test from 'node:test';\ntest('loud but passing', () => { const line = 'y'.repeat(1023) + '\\n'; for (let i = 0; i < 20 * 1024; i++) process.stdout.write(line); });\n");
  const { res, verdict } = await verifyJson(dir);
  assert.equal(verdict?.status, 'PASS', `${res.stdout}`);
  assert.match(stepOf(verdict, 'tests').detail, /^1 tests passed/);
});

test('E3 build output in dot-dirs (.next, .cache) is not judged as project source (H6)', { timeout: 300_000 }, async (t) => {
  const dir = join(await tempRoot(t), 'next');
  for (const d of ['.next/server/chunks', '.cache/x']) {
    await mkdir(join(dir, d), { recursive: true });
    for (let i = 0; i < 100; i++) await writeFile(join(dir, d, `c${i}.js`), 'this is ( minified garbage');
  }
  await writeFile(join(dir, 'index.mjs'), 'export const ok = true;\n');
  await writeFile(join(dir, 'index.test.mjs'), "import test from 'node:test';\ntest('ok', () => {});\n");
  const { res, verdict } = await verifyJson(dir);
  assert.equal(verdict?.status, 'PASS', res.stdout);
  assert.equal(stepOf(verdict, 'syntax').files, 2, 'dot-dir files were syntax-checked');
});

test('E4 hostile start(): never resolves -> FAIL; resolves without a port -> FAIL; neither hangs', { timeout: 300_000 }, async (t) => {
  for (const [label, src, expect] of [
    ['never resolves', 'export function start() { return new Promise(() => {}); }\n', /server start timed out/],
    ['no port', 'export async function start() { return { close() {} }; }\n', /returned no port/],
  ]) {
    const dir = join(await tempRoot(t), 'srv');
    await mkdir(dir);
    await writeFile(join(dir, 'server.mjs'), src);
    const started = Date.now();
    const { res, verdict } = await verifyJson(dir);
    assert.equal(verdict?.status, 'FAIL', `${label}: ${res.stdout}`);
    assert.match(stepOf(verdict, 'boot').detail, expect, label);
    assert.ok(Date.now() - started < 60_000, `${label}: verify took too long`);
  }
});

test('E5 awkward test paths: --x-test.mjs, spaces, unicode, deepest discoverable dir (H13)', { timeout: 300_000 }, async (t) => {
  const dir = join(await tempRoot(t), 'paths');
  const ok = "import test from 'node:test';\ntest('ok', () => {});\n";
  await mkdir(join(dir, 'my tests'), { recursive: true });
  await writeFile(join(dir, '--x-test.mjs'), ok);
  await writeFile(join(dir, 'my tests', 'ünï code.test.mjs'), ok);
  const deep = join(dir, 'a', 'b', 'c', 'd', 'e', 'f');
  await mkdir(deep, { recursive: true });
  await writeFile(join(deep, 'deep.test.mjs'), ok);
  const { res, verdict } = await verifyJson(dir);
  assert.equal(verdict?.status, 'PASS', res.stdout);
  assert.match(stepOf(verdict, 'tests').detail, /^3 tests passed \(3 files\)/);

  // ...and a FAILING test at the deepest discoverable level is not missed
  await writeFile(join(deep, 'deep.test.mjs'), "import test from 'node:test';\ntest('boom', () => { throw new Error('deep failure'); });\n");
  const failing = await verifyJson(dir);
  assert.equal(failing.verdict?.status, 'FAIL');
});

test('E6 map survives binary .js, 5k files, dangling symlinks and symlink loops (H14)', { timeout: 300_000 }, async (t) => {
  const dir = join(await tempRoot(t), 'mapme');
  await mkdir(join(dir, 'many'), { recursive: true });
  await writeFile(join(dir, 'bin.js'), randomBytes(64 * 1024));
  await pool(Array.from({ length: n(5000) }, (_, i) => i), 32, (i) => writeFile(join(dir, 'many', `f${i}.mjs`), `export const a${i} = 1;\n`));
  let symlinks = true;
  try {
    await symlink(join(dir, 'nowhere.js'), join(dir, 'dangling.js'), 'file');
    await symlink(dir, join(dir, 'loop'), 'dir');
  } catch (err) {
    symlinks = false;
    t.diagnostic(`symlink subcase skipped (${err.code}: needs privilege on this OS)`);
  }
  const res = await cli(['map', '--json'], { cwd: dir });
  assert.equal(res.code, 0, `${res.stderr}`);
  assert.doesNotMatch(res.stderr, CLI_LEAK);
  const map = JSON.parse(res.stdout);
  assert.ok(map.files.length >= n(5000), `only ${map.files.length} files mapped`);
  if (symlinks) assert.ok(!map.files.some((f) => f.path.startsWith('loop/')), 'map followed a symlink loop');
});

test('E7 template matrix: new -> check -> map -> verify from elsewhere agree for every template', { timeout: 600_000 }, async (t) => {
  for (const template of TEMPLATES) {
    const projectDir = await scaffold(t, template);
    const checked = JSON.parse((await cli(['check', '--json'], { cwd: projectDir })).stdout);
    assert.equal(checked.status, 'PASS', `${template}: ${JSON.stringify(checked.steps)}`);
    const map = await cli(['map', '--json'], { cwd: projectDir });
    assert.doesNotThrow(() => JSON.parse(map.stdout), `${template}: map --json is not JSON`);
    const { verdict } = await verifyJson(projectDir, tmpdir());
    assert.deepEqual(
      verdict.steps.map((s) => `${s.name}:${s.status}`),
      checked.steps.map((s) => `${s.name}:${s.status}`),
      `${template}: verify and check disagree`,
    );
    assert.equal(stepOf(verdict, 'tests').detail, stepOf(checked, 'tests').detail, `${template}: test counts disagree`);
  }
});

// ---------------------------------------------------------------------------
// F. parallel agents — concurrent checks and concurrent adds on ONE project
// ---------------------------------------------------------------------------

test('F1 four concurrent checks + five re-checks on one stacked project agree (H7)', { timeout: 900_000 }, async (t) => {
  const projectDir = await scaffold(t, 'web', [['api-crud', 'items'], 'auth-local', 'worker-jobs', 'upload']);
  const parallel = await Promise.all(Array.from({ length: 4 }, () => cli(['check', '--json'], { cwd: projectDir })));
  const sequential = [];
  for (let i = 0; i < 5; i++) sequential.push(await cli(['check', '--json'], { cwd: projectDir }));
  const summary = (res) => {
    try {
      const v = JSON.parse(res.stdout);
      return `${v.status} ${stepOf(v, 'tests').detail}${v.status === 'FAIL' ? ` ${JSON.stringify(stepOf(v, 'tests').notes)}` : ''}`;
    } catch {
      return `unparseable: ${res.stderr.slice(0, 100)}`;
    }
  };
  const all = [...parallel, ...sequential].map(summary);
  assert.ok(all.every((s) => s.startsWith('PASS')), tag(`verdicts: ${JSON.stringify(all, null, 1)}`));
  assert.equal(new Set(all).size, 1, `verdicts differ: ${JSON.stringify(all, null, 1)}`);
});

test('F2 concurrent adds on one project: every success is recorded, nothing silently dropped (H11)', { timeout: 600_000 }, async (t) => {
  for (let round = 0; round < n(3); round++) {
    const projectDir = await scaffold(t, 'web');
    const feats = [['api-crud', 'items'], ['api-crud', 'notes'], 'cors', 'sse', 'rate-limit', 'upload', 'auth-local', 'worker-jobs'];
    const results = await Promise.all(feats.map((f) => {
      const [name, resource] = [f].flat();
      return cli(['add', name, ...(resource ? ['--resource', resource] : [])], { cwd: projectDir }).then((res) => ({ name, resource, res }));
    }));
    const marker = JSON.parse(await readFile(join(projectDir, '.idea2prototype.json'), 'utf8'));
    const recorded = marker.features.map((f) => `${f.name}${f.resource ? `:${f.resource}` : ''}`).sort();
    const succeeded = results.filter((x) => x.res.code === 0).map((x) => `${x.name}${x.resource ? `:${x.resource}` : ''}`).sort();
    for (const x of results.filter((y) => y.res.code !== 0)) {
      assert.match(x.res.stderr, /^idea2prototype: /, `add ${x.name} failed unreadably: ${x.res.stderr}`);
    }
    assert.deepEqual(recorded, succeeded, tag(`round ${round}: marker lost features under concurrent add`));
  }
});
