// Engine self-tests: exercise every idea2prototype command end-to-end.
// These are also the CI workhorse — `node --test tests/engine.test.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const HERE = fileURLToPath(new URL('.', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../skills/idea2prototype/scripts/idea2prototype.mjs', import.meta.url));
const i2p = (args, opts = {}) => run(process.execPath, [SCRIPT, ...args], { timeout: 180_000, ...opts });

// Scaffold a throwaway project (auto-cleaned via t.after) and return its dir.
// Every scaffold-based test goes through this so the ritual exists once.
async function scaffold(t, { template = 'web', name, idea, feature, resource } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'i2p-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await i2p([
    'new', 'app', '--template', template,
    ...(name ? ['--name', name] : []),
    ...(idea ? ['--idea', idea] : []),
  ], { cwd: dir });
  const projectDir = join(dir, 'app');
  if (feature) {
    await i2p(['add', feature, ...(resource ? ['--resource', resource] : [])], { cwd: projectDir });
  }
  return projectDir;
}

test('scaffolds the web template and passes check', async (t) => {
  const projectDir = await scaffold(t, { template: 'web', name: 'My App', idea: 'todo list' });
  const { stdout } = await i2p(['check'], { cwd: projectDir });
  assert.match(stdout, /PASS \(3\/3 passed\)/);
  assert.match(stdout, /boot\s+PASS/);
});

// Regression for #17: the syntax step used to skip public/ entirely, so a
// destroyed frontend still reported 'parse clean'. Frontend files are now
// dual-parsed (ESM, then classic) — only code broken in BOTH modes fails.
test('broken public/app.js fails the syntax step', async (t) => {
  const projectDir = await scaffold(t, {});
  await writeFile(
    join(projectDir, 'public', 'app.js'),
    'function broken( {\nthis is not javascript at all\n',
  );
  const err = await i2p(['check'], { cwd: projectDir }).then(() => null, (e) => e);
  assert.ok(err, 'check must exit non-zero on a broken frontend');
  assert.match(err.stdout, /syntax\s+FAIL/);
  assert.match(err.stdout, /public\/app\.js: does not parse as ESM or classic script/);
});

test('classic (non-ESM) scripts in public/ still pass check', async (t) => {
  const projectDir = await scaffold(t, {});
  // 0755 is a legal sloppy-mode octal literal but illegal in ESM — this file
  // only passes via the CommonJS fallback parse.
  await writeFile(join(projectDir, 'public', 'legacy.js'), 'var mode = 0755;\nconsole.log(mode);\n');
  const { stdout } = await i2p(['check'], { cwd: projectDir });
  assert.match(stdout, /PASS \(3\/3 passed\)/);
  // web template ships exactly one public/*.js (app.js); legacy.js makes 2.
  assert.match(stdout, /\(\d+ server \+ 2 frontend\)/);
});

// Big-file behavior (from review finding B1 on this very PR, empirically
// corrected): a >1 MiB VALID file parses clean, and a >1 MiB single-line
// BROKEN file is still caught — the default 1 MiB spawnSync maxBuffer
// ENOBUFSs on that error output (status null); the 16 MiB buffer keeps the
// status meaningful.
test('large (>1 MiB) frontend files: valid passes, broken single-line fails', async (t) => {
  const projectDir = await scaffold(t, {});
  const valid = `const a = [${'"x",'.repeat(800_000)}];\nexport default a;\n`; // ~1.6 MB
  const broken = `const a = [${'"x",'.repeat(800_000)}]; this is ( not js\n`; // ~1.6 MB one line
  await writeFile(join(projectDir, 'public', 'big-ok.js'), valid);
  await writeFile(join(projectDir, 'public', 'big-bad.js'), broken);
  const err = await i2p(['check'], { cwd: projectDir }).then(() => null, (e) => e);
  assert.ok(err, 'check must exit non-zero when a big frontend file is broken');
  assert.match(err.stdout, /syntax\s+FAIL/);
  assert.match(err.stdout, /big-bad\.js: does not parse as ESM or classic script/);
  assert.doesNotMatch(err.stdout, /big-ok\.js/);
});

test('add api-crud keeps the web project green', async (t) => {
  const projectDir = await scaffold(t, { feature: 'api-crud', resource: 'todos' });
  const { stdout } = await i2p(['check'], { cwd: projectDir });
  assert.match(stdout, /PASS \(3\/3 passed\)/);
  assert.match(stdout, /5 tests passed/);
});

test('add auth-local keeps the web project green', async (t) => {
  const projectDir = await scaffold(t, { feature: 'auth-local' });
  const { stdout } = await i2p(['check'], { cwd: projectDir });
  assert.match(stdout, /PASS \(3\/3 passed\)/);
  assert.match(stdout, /4 tests passed/); // 3 web + 1 auth session flow
});

// Regression for #16: auth-local persists data/users.json in the project dir,
// so a fixed test username 409s on the SECOND check. The template now
// registers a unique user per run — re-checking the same project must pass.
test('add auth-local passes check twice in a row (re-check loop)', async (t) => {
  const projectDir = await scaffold(t, { feature: 'auth-local' });
  const first = await i2p(['check'], { cwd: projectDir });
  assert.match(first.stdout, /PASS \(3\/3 passed\)/);
  const second = await i2p(['check'], { cwd: projectDir });
  assert.match(second.stdout, /PASS \(3\/3 passed\)/);
  assert.match(second.stdout, /4 tests passed/);
});

// Pins #19's composition story: stacking several features (auth + two CRUD
// resources + rate-limit) on one scaffold must stay green out of the box.
test('stacking multiple features keeps the project green', async (t) => {
  const projectDir = await scaffold(t, {});
  await i2p(['add', 'auth-local'], { cwd: projectDir });
  await i2p(['add', 'api-crud', '--resource', 'posts'], { cwd: projectDir });
  await i2p(['add', 'api-crud', '--resource', 'comments'], { cwd: projectDir });
  await i2p(['add', 'rate-limit'], { cwd: projectDir });
  const { stdout } = await i2p(['check'], { cwd: projectDir });
  assert.match(stdout, /PASS \(3\/3 passed\)/);
  assert.match(stdout, /10 tests passed/); // 3 web + 1 auth + 2+2 crud + 2 rate-limit
});

// Executes the SKILL.md "Composing features" worked example literally:
// requireAuth-wrapped POST + author stamp + session-bootstrapped tests. If
// the documented steps drift from what the templates generate, this goes red.
test('documented auth x crud composition works end to end', async (t) => {
  const projectDir = await scaffold(t, {});
  await i2p(['add', 'auth-local'], { cwd: projectDir });
  await i2p(['add', 'api-crud', '--resource', 'posts'], { cwd: projectDir });

  // Step 1-2 of the docs: wrap the generated POST with requireAuth + stamp author.
  const routePath = join(projectDir, 'routes', 'posts.mjs');
  let route = await readFile(routePath, 'utf8');
  assert.match(route, /POST: async \(\{ body \}\) => \{/); // guard: template shape changed
  route = route
    .replace(
      "import { randomUUID } from 'node:crypto';",
      "import { randomUUID } from 'node:crypto';\nimport { requireAuth } from './auth.mjs';",
    )
    .replace('POST: async ({ body }) => {', 'POST: requireAuth(async ({ body, user }) => {')
    .replace(
      'const item = { id: randomUUID(), createdAt: new Date().toISOString(), ...body };',
      'const item = { id: randomUUID(), createdAt: new Date().toISOString(), ...body, author: user.username };',
    )
    .replace(/return \[201, item\];\r?\n      \},/, 'return [201, item];\n      }),');
  await writeFile(routePath, route);

  // Step 3 of the docs: session-bootstrap BOTH generated POSTs. The embedded
  // file is the documented session pattern verbatim (\${ escapes the outer
  // template literal; the generated file keeps its own interpolation).
  await writeFile(
    join(projectDir, 'tests', 'posts.test.mjs'),
    `import test from 'node:test';
import assert from 'node:assert/strict';
import { start } from '../server.mjs';

const JSON_HEADERS = { 'content-type': 'application/json' };
async function session(root) {
  const username = \`author_\${Date.now().toString(36)}\${Math.random().toString(36).slice(2, 7)}\`;
  await fetch(\`\${root}/api/auth/register\`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ username, password: 'correct horse battery' }) });
  const login = await fetch(\`\${root}/api/auth/login\`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ username, password: 'correct horse battery' }) });
  return { cookie: login.headers.get('set-cookie').split(';')[0], username };
}

test('protected posts: anon 401, authed 201 + author stamp', async () => {
  const app = await start(0);
  const root = \`http://127.0.0.1:\${app.port}\`;
  const base = \`\${root}/api/posts\`;
  try {
    const { cookie, username } = await session(root);
    const anon = await fetch(base, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ title: 'anon' }) });
    assert.equal(anon.status, 401);
    const created = await fetch(base, { method: 'POST', headers: { ...JSON_HEADERS, cookie }, body: JSON.stringify({ title: 'first' }) });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).author, username);
  } finally { await app.close(); }
});

test('protected posts: non-object body still 400 with a session', async () => {
  const app = await start(0);
  const root = \`http://127.0.0.1:\${app.port}\`;
  try {
    const { cookie } = await session(root);
    const res = await fetch(\`\${root}/api/posts\`, { method: 'POST', headers: { ...JSON_HEADERS, cookie }, body: JSON.stringify(['nope']) });
    assert.equal(res.status, 400);
  } finally { await app.close(); }
});
`,
  );

  const first = await i2p(['check'], { cwd: projectDir });
  assert.match(first.stdout, /PASS \(3\/3 passed\)/);
  assert.match(first.stdout, /6 tests passed/); // 3 web + 1 auth + 2 protected posts
  // The unique-username pattern must also survive a re-check (data persists).
  const second = await i2p(['check'], { cwd: projectDir });
  assert.match(second.stdout, /PASS \(3\/3 passed\)/);
});

test('add upload keeps the web project green', async (t) => {
  const projectDir = await scaffold(t, { feature: 'upload' });
  const { stdout } = await i2p(['check'], { cwd: projectDir });
  assert.match(stdout, /PASS \(3\/3 passed\)/);
  assert.match(stdout, /5 tests passed/); // 3 web + 2 upload
});

test('add rate-limit keeps the web project green', async (t) => {
  const projectDir = await scaffold(t, { feature: 'rate-limit' });
  const { stdout } = await i2p(['check'], { cwd: projectDir });
  assert.match(stdout, /PASS \(3\/3 passed\)/);
  assert.match(stdout, /5 tests passed/); // 3 web + 2 rate-limit
});

test('add cors keeps the web project green', async (t) => {
  const projectDir = await scaffold(t, { feature: 'cors' });
  const { stdout } = await i2p(['check'], { cwd: projectDir });
  assert.match(stdout, /PASS \(3\/3 passed\)/);
  assert.match(stdout, /6 tests passed/); // 3 web + 3 cors
});

test('add sse keeps the web project green', async (t) => {
  const projectDir = await scaffold(t, { feature: 'sse' });
  const { stdout } = await i2p(['check'], { cwd: projectDir });
  assert.match(stdout, /PASS \(3\/3 passed\)/);
  assert.match(stdout, /4 tests passed/); // 3 web + 1 sse stream
});

test('add sse keeps the api project green', async (t) => {
  const projectDir = await scaffold(t, { template: 'api', feature: 'sse' });
  const { stdout } = await i2p(['check'], { cwd: projectDir });
  assert.match(stdout, /PASS \(3\/3 passed\)/);
  assert.match(stdout, /4 tests passed/); // 3 api + 1 sse stream
});

// Pins the streaming-contract guard from the non-streaming side: a handler
// that returns nothing (and never wrote to res) must land as a clean 500 —
// not a crash, not a hang. The streaming side is the sse feature test above.
test('handler returning nothing yields a clean 500 (stream contract)', async (t) => {
  const projectDir = await scaffold(t, {});
  await mkdir(join(projectDir, 'routes'), { recursive: true });
  await writeFile(
    join(projectDir, 'routes', 'broken.mjs'),
    `export default [
  { path: "/api/broken", methods: { GET: async () => {} } },
  {
    path: "/api/throw-after-headers",
    methods: {
      // streaming shape: headers sent, then the handler blows up — the
      // outer catch must kill the socket, NOT call sendJson (which would
      // throw ERR_HTTP_HEADERS_SENT inside the catch and crash the server)
      GET: async ({ res }) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("event: boom\\n\\n");
        throw new Error("mid-stream failure");
      },
    },
  },
];
`,
  );
  await writeFile(
    join(projectDir, 'tests', 'broken.test.mjs'),
    `import test from 'node:test';
import assert from 'node:assert/strict';
import { start } from '../server.mjs';

test('GET /api/broken -> 500 JSON error, server stays up', async () => {
  const app = await start(0);
  try {
    const res = await fetch(\`http://127.0.0.1:\${app.port}/api/broken\`);
    assert.equal(res.status, 500);
    assert.ok((await res.json()).error);
    const health = await fetch(\`http://127.0.0.1:\${app.port}/api/health\`);
    assert.equal(health.status, 200);
  } finally { await app.close(); }
});

test('handler throwing AFTER headers: connection breaks, server survives', async () => {
  const app = await start(0);
  const root = \`http://127.0.0.1:\${app.port}\`;
  try {
    // Race-tolerant: headers may reach the client before the server kills
    // the socket — either the fetch itself rejects, or the body read does.
    const res = await fetch(\`\${root}/api/throw-after-headers\`).catch(() => null);
    if (res) await assert.rejects(res.text(), /terminated|abort|socket|fetch failed/i);
    const health = await fetch(\`\${root}/api/health\`);
    assert.equal(health.status, 200);
  } finally { await app.close(); }
});
`,
  );
  const { stdout } = await i2p(['check'], { cwd: projectDir });
  assert.match(stdout, /PASS \(3\/3 passed\)/);
  assert.match(stdout, /5 tests passed/); // 3 web + both embedded contract tests
});

// #20: the rate-limit/cors add summaries must tell the agent the demo route
// is disposable — otherwise /api/ping clutter stays on the real API surface.
test('demo-route features warn that their demo route is disposable', async (t) => {
  const projectDir = await scaffold(t, {});
  const rl = await i2p(['add', 'rate-limit'], { cwd: projectDir });
  assert.match(rl.stdout, /demo route: delete GET \/api\/ping from routes\/ratelimit\.mjs/);
  const cors = await i2p(['add', 'cors'], { cwd: projectDir });
  assert.match(cors.stdout, /demo route: delete GET \/api\/cors-ping from routes\/cors\.mjs/);
});

test('scaffolds the api template and passes check', async (t) => {
  const projectDir = await scaffold(t, { template: 'api' });
  const { stdout } = await i2p(['check'], { cwd: projectDir });
  assert.match(stdout, /PASS \(3\/3 passed\)/);
});

test('scaffolds the cli template and passes check', async (t) => {
  const projectDir = await scaffold(t, { template: 'cli' });
  const { stdout } = await i2p(['check'], { cwd: projectDir });
  assert.match(stdout, /PASS \(2\/3 passed\)/);
  assert.match(stdout, /no server\.mjs/);
});

test('scaffolds the worker template and passes check', async (t) => {
  const projectDir = await scaffold(t, { template: 'worker' });
  const { stdout } = await i2p(['check'], { cwd: projectDir });
  assert.match(stdout, /PASS \(2\/3 passed\)/);
  assert.match(stdout, /3 tests passed/);
  assert.match(stdout, /no server\.mjs/);
});

test('scaffolds the library template and passes check with an import smoke test', async (t) => {
  const projectDir = await scaffold(t, { template: 'library', name: 'My Lib', idea: 'state helpers' });
  const { stdout } = await i2p(['check'], { cwd: projectDir });
  assert.match(stdout, /PASS \(3\/3 passed\)/);
  assert.match(stdout, /boot\s+PASS/);
  assert.match(stdout, /index\.mjs loads/);
  assert.match(stdout, /createStore, memoAsync/);
  // fresh scaffold matches the engine version — no drift note expected
  assert.doesNotMatch(stdout, /note\s+scaffolded by/);
});

test('check reports scaffold/engine version drift without failing', async (t) => {
  const projectDir = await scaffold(t, {});
  const markerPath = join(projectDir, '.idea2prototype.json');
  const marker = JSON.parse(await readFile(markerPath, 'utf8'));
  marker.version = '0.0.1';
  await writeFile(markerPath, JSON.stringify(marker));
  const { stdout } = await i2p(['check'], { cwd: projectDir });
  assert.match(stdout, /PASS \(3\/3 passed\)/);
  assert.match(stdout, /scaffolded by v0\.0\.1, engine v/);
  const json = JSON.parse((await i2p(['check', '--json'], { cwd: projectDir })).stdout);
  assert.equal(json.scaffoldVersion, '0.0.1');
});

test('map lists code files with LOC and exports', async (t) => {
  const projectDir = await scaffold(t, { feature: 'api-crud', resource: 'todos' });
  const { stdout } = await i2p(['map'], { cwd: projectDir });
  assert.match(stdout, /map — 5 code files/);
  assert.match(stdout, /server\.mjs.*→.*start/);
  assert.match(stdout, /routes\/todos\.mjs.*→.*default/);
});

test('check fails cleanly on a syntax error', async (t) => {
  const projectDir = await scaffold(t, {});
  await writeFile(join(projectDir, 'broken.mjs'), 'syntax error here({\n');
  await assert.rejects(
    i2p(['check'], { cwd: projectDir }),
    (err) => {
      assert.match(err.stdout, /FAIL/);
      assert.match(err.stdout, /syntax\s+FAIL/);
      return true;
    },
  );
});

test('verify judges a foreign (non-scaffolded) project from another cwd', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'i2p-foreign-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'tests'));
  await writeFile(join(dir, 'math.mjs'), 'export function add(a, b) { return a + b }\n');
  await writeFile(
    join(dir, 'tests', 'math.test.mjs'),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../math.mjs';\ntest('add', () => assert.equal(add(2, 3), 5));\n",
  );
  await assert.rejects(
    i2p(['verify', 'definitely-missing-dir'], { cwd: tmpdir() }),
    (err) => /no such directory/.test(err.stderr ?? ''),
  );
  const res = await i2p(['verify', dir], { cwd: HERE });
  assert.match(res.stdout, /PASS/);
  assert.match(res.stdout, /1 tests? passed/);
});

test('verify boots a foreign project that serves only a static root (no /api/health)', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'i2p-foreign2-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'tests'));
  await writeFile(
    join(dir, 'server.mjs'),
    "import { createServer } from 'node:http';\n" +
      'export function start(port = 0) {\n' +
      '  const server = createServer((req, res) => {\n' +
      '    if (req.url === "/api/health") { res.writeHead(404); return res.end(); }\n' +
      '    res.writeHead(200, { "Content-Type": "text/html" }); res.end("<h1>hi</h1>");\n' +
      '  });\n' +
      '  return new Promise((resolve) => server.listen(port, () => resolve({ server, port: server.address().port, close: () => new Promise((r) => server.close(() => r())) })));\n' +
      '}\n',
  );
  await writeFile(join(dir, 'tests', 'smoke.test.mjs'), "import test from 'node:test';\ntest('ok', () => {});\n");
  const { stdout } = await i2p(['verify', dir], { cwd: HERE });
  assert.match(stdout, /PASS \(3\/3 passed\)/);
  assert.match(stdout, /GET \/api\/health -> 404, GET \/ -> 200/);
});

test('new refuses to overwrite a non-empty directory', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'i2p-refuse-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'app'));
  await writeFile(join(dir, 'app', 'keep.txt'), 'precious');
  await assert.rejects(
    i2p(['new', 'app', '--template', 'web'], { cwd: dir }),
    (err) => /never overwrites/.test(err.stderr),
  );
});

test('npm bin shim runs the engine', async () => {
  const bin = fileURLToPath(new URL('../bin/i2p.mjs', import.meta.url));
  const { stdout } = await run(process.execPath, [bin, 'version'], { timeout: 30_000 });
  assert.match(stdout, /\d+\.\d+\.\d+/);
});

test('list shows templates and features', async () => {
  const { stdout } = await i2p(['list'], { cwd: HERE });
  assert.match(stdout, /templates: /);
  for (const name of ['api', 'cli', 'library', 'web', 'worker']) {
    assert.match(stdout, new RegExp(`\\b${name}\\b`));
  }
});

test('check returns promptly — no lingering timeout timer', async (t) => {
  const projectDir = await scaffold(t, {});
  const started = Date.now();
  await i2p(['check'], { cwd: projectDir });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 10_000, `check took ${elapsed}ms — a leaked withTimeout timer adds ~15s of dead time`);
});

test('user uploads are never syntax-checked', async (t) => {
  const projectDir = await scaffold(t, { feature: 'upload' });
  await mkdir(join(projectDir, 'uploads'), { recursive: true });
  await writeFile(join(projectDir, 'uploads', 'junk.js'), 'this is not javascript\n');
  const { stdout } = await i2p(['check'], { cwd: projectDir });
  assert.match(stdout, /PASS \(3\/3 passed\)/);
});

test('add rejects features that do not apply to the template', async (t) => {
  const projectDir = await scaffold(t, { template: 'cli' });
  await assert.rejects(
    i2p(['add', 'auth-local'], { cwd: projectDir }),
    (err) => /applies to web\/api/.test(err.stderr),
  );
});

test('verify does not follow redirects off the probe target', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'i2p-redirect-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'tests'));
  await writeFile(
    join(dir, 'server.mjs'),
    "import { createServer } from 'node:http';\n" +
      'export function start(port = 0) {\n' +
      '  const server = createServer((req, res) => {\n' +
      '    res.writeHead(302, { Location: "http://127.0.0.1:9/" }); res.end();\n' +
      '  });\n' +
      '  return new Promise((resolve) => server.listen(port, () => resolve({ server, port: server.address().port, close: () => new Promise((r) => server.close(() => r())) })));\n' +
      '}\n',
  );
  await writeFile(join(dir, 'tests', 'smoke.test.mjs'), "import test from 'node:test';\ntest('ok', () => {});\n");
  const { stdout } = await i2p(['verify', dir], { cwd: HERE });
  assert.match(stdout, /PASS \(3\/3 passed\)/);
  assert.match(stdout, /GET \/api\/health -> 302/);
});

// Regression for #18: the boot probe used to ask only /api/health, so a
// server whose every real route 500s still verified PASS 3/3. The root is
// now probed too — a 5xx root fails boot; a 4xx root (API-only project)
// stays in the ok-range.
test('verify fails a server whose root 500s even with a healthy /api/health', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'i2p-probe500-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'tests'));
  await writeFile(
    join(dir, 'server.mjs'),
    "import { createServer } from 'node:http';\n" +
      'export function start(port = 0) {\n' +
      '  const server = createServer((req, res) => {\n' +
      '    if (req.url === "/api/health") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ status: "ok" })); return; }\n' +
      '    res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "boom" }));\n' +
      '  });\n' +
      '  return new Promise((resolve) => server.listen(port, () => resolve({ server, port: server.address().port, close: () => new Promise((r) => server.close(() => r())) })));\n' +
      '}\n',
  );
  await writeFile(join(dir, 'tests', 'smoke.test.mjs'), "import test from 'node:test';\ntest(\'ok\', () => {});\n");
  const err = await i2p(['verify', dir], { cwd: HERE }).then(() => null, (e) => e);
  assert.ok(err, 'verify must exit non-zero when every real route 500s');
  assert.match(err.stdout, /boot\s+FAIL/);
  assert.match(err.stdout, /GET \/api\/health -> 200, GET \/ -> 500/);
});

test('verify still passes an API-only server whose root is a 404', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'i2p-api-only-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'tests'));
  await writeFile(
    join(dir, 'server.mjs'),
    "import { createServer } from 'node:http';\n" +
      'export function start(port = 0) {\n' +
      '  const server = createServer((req, res) => {\n' +
      '    if (req.url === "/api/health") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ status: "ok" })); return; }\n' +
      '    if (req.url === "/api/items") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify([])); return; }\n' +
      '    res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "not found" }));\n' +
      '  });\n' +
      '  return new Promise((resolve) => server.listen(port, () => resolve({ server, port: server.address().port, close: () => new Promise((r) => server.close(() => r())) })));\n' +
      '}\n',
  );
  await writeFile(join(dir, 'tests', 'smoke.test.mjs'), "import test from 'node:test';\ntest(\'ok\', () => {});\n");
  const { stdout } = await i2p(['verify', dir], { cwd: HERE });
  assert.match(stdout, /PASS \(3\/3 passed\)/);
  assert.match(stdout, /GET \/api\/health -> 200, GET \/ -> 404/);
});

test('boot is skipped with a clear reason when tests fail', async (t) => {
  const projectDir = await scaffold(t, {});
  await writeFile(
    join(projectDir, 'tests', 'zz-regression.test.mjs'),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('deliberate failure', () => assert.equal(1, 2));\n",
  );
  await assert.rejects(
    i2p(['check'], { cwd: projectDir }),
    (err) => {
      assert.match(err.stdout, /tests\s+FAIL/);
      assert.match(err.stdout, /boot\s+SKIP/);
      assert.match(err.stdout, /skipped \(tests failed\)/);
      return true;
    },
  );
});

test('--json output is well-formed for check, map, and verify', async (t) => {
  const projectDir = await scaffold(t, {});
  const check = JSON.parse((await i2p(['check', '--json'], { cwd: projectDir })).stdout);
  assert.equal(check.tool, 'idea2prototype');
  assert.equal(check.status, 'PASS');
  assert.deepEqual(check.steps.map((s) => s.name), ['syntax', 'tests', 'boot']);

  const map = JSON.parse((await i2p(['map', '--json'], { cwd: projectDir })).stdout);
  assert.ok(map.files.length > 0);
  assert.ok(map.files.every((f) => typeof f.path === 'string' && typeof f.loc === 'number'));

  const dir = await mkdtemp(join(tmpdir(), 'i2p-json-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'tests'));
  await writeFile(join(dir, 'x.mjs'), 'export const one = 1;\n');
  await writeFile(
    join(dir, 'tests', 'x.test.mjs'),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { one } from '../x.mjs';\ntest('one', () => assert.equal(one, 1));\n",
  );
  const verify = JSON.parse((await i2p(['verify', dir, '--json'], { cwd: HERE })).stdout);
  assert.equal(verify.status, 'PASS');
  assert.ok(!('scaffoldVersion' in verify)); // foreign project: no scaffold version in JSON
});

// Benchmark finding (spec 4/7 control arms): a foreign server.mjs that
// listens at import time and exports nothing leaves an unreachable listener
// in the verify process — the verdict used to print and then hang forever.
// runChecks now exits explicitly once the verdict is complete. A 60s timeout
// stands in for "hangs forever": without the fix this await rejects (killed).
test('verify exits after its verdict on a foreign server that listens at import', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'i2p-hang-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'tests'));
  await writeFile(
    join(dir, 'server.mjs'),
    [
      "import { createServer } from 'node:http';",
      '// foreign entry point: listens at import time, exports nothing',
      "const server = createServer((req, res) => {",
      "  res.writeHead(200, { 'content-type': 'application/json' });",
      "  res.end(JSON.stringify({ ok: true }));",
      '});',
      "server.listen(0, '127.0.0.1');",
      '',
    ].join('\n'),
  );
  await writeFile(
    join(dir, 'tests', 'x.test.mjs'),
    "import test from 'node:test';\ntest('trivially passes', () => {});\n",
  );
  const { stdout } = await i2p(['verify', dir, '--json'], { cwd: HERE, timeout: 60_000 });
  const verdict = JSON.parse(stdout);
  assert.equal(verdict.status, 'PASS');
  const boot = verdict.steps.find((s) => s.name === 'boot');
  assert.equal(boot.status, 'skip');
  assert.match(boot.detail, /does not export start\(\)/);
});

// Benchmark finding (spec 4 treatment arm): check ran test FILES concurrently,
// and each file is its own process with its own in-memory cache over the same
// JSON data store — concurrent CRUD tests lost updates nondeterministically
// (2 leaked rows in 3 runs). stepTests now runs files one at a time, in sorted
// order, so a later file deterministically observes an earlier file's writes.
test('test files run serially — a later test file sees an earlier one\'s store writes', async (t) => {
  // The serialized path only activates when the runner accepts BOTH flags.
  // --test-concurrency exists since 18.19/20.10/21, but --test-timeout (also
  // passed) only since 20.11/21.2 — and on any Node lacking either flag the
  // engine already takes the bare-runner fallback (status-quo behavior).
  const [major, minor] = process.versions.node.split('.').map(Number);
  const serialSupported = major > 21 || (major === 21 && minor >= 2) || (major === 20 && minor >= 11);
  if (!serialSupported) return t.skip('serialized file execution needs --test-concurrency AND --test-timeout (Node >= 20.11); older Nodes keep the bare-runner fallback');

  const projectDir = await scaffold(t, { feature: 'api-crud', resource: 'todos' });
  await writeFile(
    join(projectDir, 'tests', 'a-seed.test.mjs'),
    [
      "import test from 'node:test';",
      "import { start } from '../server.mjs';",
      "test('seed one row (delayed — a concurrent b-observe would read first)', async () => {",
      '  const app = await start(0);',
      '  try {',
      '    // Under serial file execution b-observe has not started yet; under',
      '    // concurrent execution its immediate read happens ~3s before this',
      '    // write lands — the delay makes the race deterministic, not flaky.',
      '    await new Promise((resolve) => setTimeout(resolve, 3000));',
      "    const res = await fetch(`http://127.0.0.1:${app.port}/api/todos`, {",
      "      method: 'POST',",
      "      headers: { 'content-type': 'application/json' },",
      "      body: JSON.stringify({ title: 'seed-marker' }),",
      '    });',
      '    if (res.status !== 201) throw new Error(`seed failed: ${res.status}`);',
      '  } finally {',
      '    await app.close();',
      '  }',
      '});',
      '',
    ].join('\n'),
  );
  await writeFile(
    join(projectDir, 'tests', 'b-observe.test.mjs'),
    [
      "import test from 'node:test';",
      "import { start } from '../server.mjs';",
      "test('observes the seeded row (runs after a-seed by sorted order)', async () => {",
      '  const app = await start(0);',
      '  try {',
      '    const list = await (await fetch(`http://127.0.0.1:${app.port}/api/todos`)).json();',
      "    if (!list.some((x) => x.title === 'seed-marker')) {",
      "      throw new Error('seed-marker missing — test files did not run in sorted serial order');",
      '    }',
      '  } finally {',
      '    await app.close();',
      '  }',
      '});',
      '',
    ].join('\n'),
  );
  const { stdout } = await i2p(['check'], { cwd: projectDir });
  assert.match(stdout, /PASS \(3\/3 passed\)/);
  // web template (3) + generated CRUD (2) + seed + observe
  assert.match(stdout, /7 tests passed/);
});
