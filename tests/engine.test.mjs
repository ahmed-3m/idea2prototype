// Engine self-tests: exercise every idea2prototype command end-to-end.
// These are also the CI workhorse — `node --test tests/engine.test.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, cp, symlink, utimes, chmod } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { request } from 'node:http';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const run = promisify(execFile);
const HERE = fileURLToPath(new URL('.', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../skills/idea2prototype/scripts/idea2prototype.mjs', import.meta.url));
const i2p = (args, opts = {}) => run(process.execPath, [SCRIPT, ...args], { timeout: 180_000, ...opts });

// Scaffold a throwaway project (auto-cleaned via t.after) and return its dir.
// Every scaffold-based test goes through this so the ritual exists once.
async function scaffold(t, { template = 'web', name, idea, feature, resource } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'i2p-'));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
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

// #43: the scaffold's check script must keep invoking the engine that built it,
// but HOW depends on where the engine ran from. A source checkout pins the
// local path (stable across machines-less moves); a published install (npx
// cache, npm i -g) lives in a volatile node_modules dir, so it pins registry
// coordinates instead — npm cache clean or a second machine re-fetches.
test('check script pins the engine path from a checkout, registry coordinates from a published install', async (t) => {
  const PKG = '@ahmed-3m/idea2prototype';

  // checkout form: this suite runs the engine straight from the repo
  const sourceRoot = await mkdtemp(join(tmpdir(), 'i2p-src-'));
  t.after(() => rm(sourceRoot, { recursive: true, force: true }));
  await i2p(['new', 'from-source', '--template', 'cli'], { cwd: sourceRoot });
  const pkgSource = JSON.parse(await readFile(join(sourceRoot, 'from-source', 'package.json'), 'utf8'));
  assert.match(pkgSource.scripts.check, /^node ".+" check$/);
  assert.ok(!pkgSource.scripts.check.includes(PKG), 'a checkout scaffold must not depend on the registry');

  // published-install form: the same engine files under node_modules/<pkg>/
  const installRoot = await mkdtemp(join(tmpdir(), 'i2p-pub-'));
  t.after(() => rm(installRoot, { recursive: true, force: true }));
  const fakeInstall = join(installRoot, 'node_modules', PKG);
  await cp(join(HERE, '..', 'skills', 'idea2prototype'), join(fakeInstall, 'skills', 'idea2prototype'), { recursive: true });
  const fakeEngine = join(fakeInstall, 'skills', 'idea2prototype', 'scripts', 'idea2prototype.mjs');
  await run(process.execPath, [fakeEngine, 'new', 'from-npx', '--template', 'cli'], { cwd: installRoot, timeout: 60_000 });
  const pkgNpx = JSON.parse(await readFile(join(installRoot, 'from-npx', 'package.json'), 'utf8'));
  const version = JSON.parse(await readFile(join(HERE, '..', 'package.json'), 'utf8')).version;
  assert.equal(pkgNpx.scripts.check, `npx -y ${PKG}@${version} check`);
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
  assert.match(stdout, /6 tests passed/); // 3 web + 3 crud (roundtrip, server-owned ids, validation)
});

// Review finding 1: a CRUD resource over another feature's store or route is
// refused in EITHER add order. "users" shared data/users.json with auth-local:
// anonymous GET /api/users served salts + hashes, anonymous POST planted a
// login-capable account. Nothing may be written on refusal.
test('add api-crud refuses resource names another feature owns', async (t) => {
  const projectDir = await scaffold(t, {});
  for (const [resource, owner] of [['users', /auth-local/], ['jobs', /worker-jobs/], ['events', /sse/]]) {
    await assert.rejects(
      i2p(['add', 'api-crud', '--resource', resource], { cwd: projectDir }),
      (err) => /is reserved/.test(err.stderr) && owner.test(err.stderr),
      `--resource ${resource} must be refused`,
    );
    await assert.rejects(readFile(join(projectDir, 'routes', `${resource}.mjs`)), { code: 'ENOENT' });
  }
  const marker = JSON.parse(await readFile(join(projectDir, '.idea2prototype.json'), 'utf8'));
  assert.deepEqual(marker.features, []);
  // the safe alternative next to auth-local still works
  await i2p(['add', 'auth-local'], { cwd: projectDir });
  await i2p(['add', 'api-crud', '--resource', 'members'], { cwd: projectDir });
});

// Regression for the corrupt-store stress finding: a data/*.json that exists
// but does not parse must never be silently wiped by the next persist — the
// loader quarantines it (original bytes preserved) and starts empty LOUDLY.
// The route resolves its store from process.cwd() at import time, so the
// scaffold's own server is booted as a subprocess with the project as cwd.
test('a corrupt api-crud store is quarantined, not silently wiped', async (t) => {
  const projectDir = await scaffold(t, { feature: 'api-crud', resource: 'item' });
  const garbage = Buffer.alloc(2048, 7); // valid file, invalid JSON
  await mkdir(join(projectDir, 'data'), { recursive: true });
  await writeFile(join(projectDir, 'data', 'item.json'), garbage);

  const child = spawn(process.execPath, ['server.mjs'], { cwd: projectDir, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const stop = async () => {
    if (child.exitCode !== null) return;
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    } else {
      child.kill('SIGKILL'); // the server has no children — a bare kill suffices
    }
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3_000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    await new Promise((r) => setTimeout(r, 300)); // let Windows release the cwd handle
  };
  t.after(stop); // belt — the test body also stops before returning
  let bootLog = '';
  child.stdout.on('data', (c) => { bootLog += c; });
  child.stderr.on('data', (c) => { bootLog += c; });
  const deadline = Date.now() + 15_000;
  let port = 0;
  while (Date.now() < deadline && !port) {
    port = Number(/running at http:\/\/127\.0\.0\.1:(\d+)/.exec(bootLog)?.[1]);
    if (!port) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(port, `server never booted; log: ${bootLog}`);

  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/api/item`, { signal: AbortSignal.timeout(5_000) })).json();
    assert.deepEqual(list, []); // serves empty…
    assert.match(bootLog, /quarantined/i); // …but says so loudly

    const dataDir = await readdir(join(projectDir, 'data'));
    const quarantined = dataDir.find((f) => /^item\.json\.corrupt-/.test(f));
    assert.ok(quarantined, `expected a quarantine file, got: ${dataDir.join(', ')}`);
    const kept = await readFile(join(projectDir, 'data', quarantined));
    assert.equal(kept.length, garbage.length); // original bytes preserved for recovery

    const post = await fetch(`http://127.0.0.1:${port}/api/item`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'after-garbage' }),
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(post.status, 201);
    const after = JSON.parse(await readFile(join(projectDir, 'data', 'item.json'), 'utf8'));
    assert.equal(after.length, 1); // the new store has only the new write…
    // …and the quarantine file still holds the ORIGINAL bytes on disk (not a
    // stale in-memory buffer) — a POST that clobbered it would fail here.
    const keptOnDisk = await readFile(join(projectDir, 'data', quarantined));
    assert.equal(keptOnDisk.length, garbage.length);
  } finally {
    await stop(); // kill inside the test so the scaffold's rm after-hook never races a live cwd
  }
});

test('add auth-local keeps the web project green', async (t) => {
  const projectDir = await scaffold(t, { feature: 'auth-local' });
  const { stdout } = await i2p(['check'], { cwd: projectDir });
  assert.match(stdout, /PASS \(3\/3 passed\)/);
  assert.match(stdout, /4 tests passed/); // 3 web + 1 auth session flow
});

// Shared helper for the template-behavior tests: boot a scaffold's server as
// a subprocess (its routes resolve from process.cwd()) and resolve once the
// boot log names the port. Platform-branched kill mirrors the quarantine test.
async function bootServer(t, projectDir) {
  const child = spawn(process.execPath, ['server.mjs'], { cwd: projectDir, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const stop = async () => {
    if (child.exitCode !== null) return;
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    } else {
      child.kill('SIGKILL');
    }
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3_000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    await new Promise((r) => setTimeout(r, 300)); // let Windows release the cwd handle before scaffold cleanup
  };
  t.after(stop);
  let bootLog = '';
  child.stdout.on('data', (c) => { bootLog += c; });
  child.stderr.on('data', (c) => { bootLog += c; });
  const deadline = Date.now() + 15_000;
  let port = 0;
  while (Date.now() < deadline && !port) {
    port = Number(/running at http:\/\/127\.0\.0\.1:(\d+)/.exec(bootLog)?.[1]);
    if (!port) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(port, `server never booted; log: ${bootLog}`);
  return { port, stop };
}

// #58.1: >10MB bodies used to get a TCP reset (curl exit 56, no status at
// all) because readRawBody destroyed the socket before any response. The
// server must answer 413 first and stay alive. Both server templates carry
// identical body-handling code — drive both.
test('oversize request bodies get a 413 response, not a connection reset', async (t) => {
  for (const template of ['web', 'api']) {
    await t.test(template, async () => {
      const projectDir = await scaffold(t, { template });
      await mkdir(join(projectDir, 'routes'), { recursive: true });
      await writeFile(join(projectDir, 'routes', 'big.mjs'),
        "export default {\n  path: '/api/big',\n  methods: { POST: async () => [200, { ok: true }] },\n};\n");
      const { port, stop } = await bootServer(t, projectDir);
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/big`, {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream' },
          body: Buffer.alloc(11 * 1024 * 1024, 1), // over readRawBody's 10MB limit
          signal: AbortSignal.timeout(10_000),
        });
        assert.equal(res.status, 413);
        // the server survives the oversized upload
        const health = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(5_000) });
        assert.equal(health.status, 200);
      } finally {
        await stop();
      }
    });
  }
});

// #58.4/#58.5: contract-violating handler returns and non-standard statuses
// must degrade to clean 500s ("handler returned an invalid result" / clamp),
// never leak parser plumbing ("result is not iterable", "Invalid status
// code: b"), and never crash the server process.
// code: b"), and never crash the server process. Both server templates carry
// identical dispatch code — drive both.
test('contract-violating handler returns get clean 500s; [200] sends null; server survives', async (t) => {
  for (const template of ['web', 'api']) {
    await t.test(template, async () => {
      const projectDir = await scaffold(t, { template });
      await mkdir(join(projectDir, 'routes'), { recursive: true });
      await writeFile(join(projectDir, 'routes', 'junk.mjs'),
        "export default {\n" +
        "  path: '/api/junk',\n" +
        '  methods: {\n' +
        '    GET: async (ctx) => {\n' +
        "      const kind = ctx.url.searchParams.get('kind');\n" +
        "      if (kind === 'string') return 'not an array';\n" +
        "      if (kind === 'undef') return undefined;\n" +
        "      if (kind === 'weird') return [999, 'x'];\n" +
        '      return [200];\n' +
        '    },\n' +
        '  },\n' +
        '};\n');
      const { port, stop } = await bootServer(t, projectDir);
      try {
        for (const kind of ['string', 'undef', 'weird']) {
          const res = await fetch(`http://127.0.0.1:${port}/api/junk?kind=${kind}`, { signal: AbortSignal.timeout(5_000) });
          assert.equal(res.status, 500, `${kind} must be a 500`);
          const body = await res.json();
          if (kind === 'weird') {
            assert.equal(body, 'x'); // 999 clamps to 500; the payload still goes out verbatim
          } else {
            assert.match(String(body.error), /invalid result/); // no "not iterable" internals
          }
        }
        const noPayload = await fetch(`http://127.0.0.1:${port}/api/junk`, { signal: AbortSignal.timeout(5_000) });
        assert.equal(noPayload.status, 200); // [200] with no payload: "null", not a TypeError
        assert.equal(await noPayload.text(), 'null');
        const health = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(5_000) });
        assert.equal(health.status, 200);
      } finally {
        await stop();
      }
    });
  }
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
  assert.match(stdout, /13 tests passed/); // 3 web + 1 auth + 3+3 crud + 3 rate-limit
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
      'const item = { ...body, id: randomUUID(), createdAt: new Date().toISOString() };',
      'const item = { ...body, id: randomUUID(), createdAt: new Date().toISOString(), author: user.username };',
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
  assert.match(stdout, /6 tests passed/); // 3 web + 3 upload (roundtrip, inert html/svg, validation)
});

test('add rate-limit keeps the web project green', async (t) => {
  const projectDir = await scaffold(t, { feature: 'rate-limit' });
  const { stdout } = await i2p(['check'], { cwd: projectDir });
  assert.match(stdout, /PASS \(3\/3 passed\)/);
  assert.match(stdout, /6 tests passed/); // 3 web + 3 rate-limit (headers, keys, budget independence)
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

test('add worker-jobs keeps the web project green', async (t) => {
  const projectDir = await scaffold(t, { feature: 'worker-jobs' });
  const { stdout } = await i2p(['check'], { cwd: projectDir });
  assert.match(stdout, /PASS \(3\/3 passed\)/);
  assert.match(stdout, /7 tests passed/); // 3 web + 4 job queue
});

test('add worker-jobs keeps the api project green', async (t) => {
  const projectDir = await scaffold(t, { template: 'api', feature: 'worker-jobs' });
  const { stdout } = await i2p(['check'], { cwd: projectDir });
  assert.match(stdout, /PASS \(3\/3 passed\)/);
  assert.match(stdout, /7 tests passed/); // 3 api + 4 job queue
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

// #51: verify (judge mode) must judge projects by their REAL tests — Node's
// own conventions (test/ dir, root-level *.test.mjs) — instead of silently
// passing when nothing lives under tests/*.test.mjs. Plus verdict semantics:
// the header names the mode, boot-skip reasons match the actual cause, and
// an empty directory is not a green "project".
const FAILING_TEST = "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('deliberately failing', () => assert.equal(1, 2));\n";

test('verify fails a project whose failing tests live in test/ (singular)', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'i2p-disc1-'));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  await mkdir(join(dir, 'test'));
  await writeFile(join(dir, 'test', 'fail.test.mjs'), FAILING_TEST);
  await assert.rejects(
    i2p(['verify', dir], { cwd: HERE }),
    (err) => /FAIL/.test(err.stdout ?? '') && /deliberately failing/.test(err.stdout ?? ''),
  );
});

test('verify fails a project whose failing tests are root-level *.test.mjs', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'i2p-disc2-'));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  await writeFile(join(dir, 'fail.test.mjs'), FAILING_TEST);
  await assert.rejects(
    i2p(['verify', dir], { cwd: HERE }),
    (err) => /FAIL/.test(err.stdout ?? ''),
  );
});

test('verify header names the mode; boot skip names the real cause; empty dir is not a project', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'i2p-disc3-'));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const empty = await mkdtemp(join(tmpdir(), 'i2p-disc4-'));
  t.after(() => rm(empty, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

  // empty dir: FAIL with the project step, header says "verify"
  await assert.rejects(
    i2p(['verify', empty], { cwd: HERE }),
    (err) => /Idea2Prototype verify — FAIL/.test(err.stdout ?? '') && /no Node project found/.test(err.stdout ?? ''),
  );

  // sources but no tests anywhere: tests SKIP with the loud note; boot still
  // RUNS (no tests is not a reason to skip it) and skips only for its own
  // reason — here, no server.mjs. Header still says verify.
  await writeFile(join(dir, 'math.mjs'), "export const add = (a, b) => a + b;\n");
  const res = await i2p(['verify', dir], { cwd: HERE });
  assert.match(res.stdout, /Idea2Prototype verify — PASS \(1\/3 passed\)/);
  assert.match(res.stdout, /tests\s+SKIP\s+no test files found/);
  assert.match(res.stdout, /if your tests live elsewhere, this verdict covers syntax \+ boot only/);
  assert.match(res.stdout, /boot\s+SKIP\s+no server\.mjs/);
});

// Review finding 3: with no tests, boot used to be skipped too — a server
// whose start() throws verified PASS on syntax alone. Boot now runs.
test('verify boots a project with no tests: a crashing start() fails, a healthy one passes', async (t) => {
  const crashing = await mkdtemp(join(tmpdir(), 'i2p-notests1-'));
  t.after(() => rm(crashing, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  await writeFile(join(crashing, 'server.mjs'), "export async function start() { throw new Error('boom: db unreachable'); }\n");
  await assert.rejects(
    i2p(['verify', crashing], { cwd: HERE, timeout: 60_000 }),
    (err) => /verify — FAIL/.test(err.stdout ?? '') && /boot\s+FAIL\s+boom: db unreachable/.test(err.stdout ?? ''),
  );

  const healthy = await mkdtemp(join(tmpdir(), 'i2p-notests2-'));
  t.after(() => rm(healthy, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  await writeFile(
    join(healthy, 'server.mjs'),
    "import { createServer } from 'node:http';\n" +
      'export function start(port = 0) {\n' +
      '  const server = createServer((req, res) => { res.writeHead(200); res.end("hi"); });\n' +
      '  return new Promise((resolve) => server.listen(port, () => resolve({ port: server.address().port, close: () => new Promise((r) => server.close(() => r())) })));\n' +
      '}\n',
  );
  const { stdout } = await i2p(['verify', healthy], { cwd: HERE, timeout: 60_000 });
  assert.match(stdout, /verify — PASS \(2\/3 passed\)/);
  assert.match(stdout, /tests\s+SKIP\s+no test files found/);
  assert.match(stdout, /boot\s+PASS/);
});

// Review finding 4: a foreign start() returning a bare http.Server (no .port,
// callback-style close) crashed verify with "app.close(...).catch is not a
// function" before any verdict printed. A 60s timeout stands in for a hang.
test('verify judges a foreign start() that returns a bare http.Server', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'i2p-bare-'));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  await writeFile(
    join(dir, 'server.mjs'),
    "import { createServer } from 'node:http';\n" +
      'export function start(port = 0) {\n' +
      '  const server = createServer((req, res) => { res.writeHead(200); res.end("ok"); });\n' +
      '  return new Promise((resolve) => server.listen(port, () => resolve(server)));\n' +
      '}\n',
  );
  await writeFile(join(dir, 'smoke.test.mjs'), "import test from 'node:test';\ntest('ok', () => {});\n");
  const { stdout } = await i2p(['verify', dir], { cwd: HERE, timeout: 60_000 });
  assert.match(stdout, /verify — PASS \(3\/3 passed\)/);
  assert.match(stdout, /boot\s+PASS\s+GET \/api\/health -> 200, GET \/ -> 200/);
});

// Review finding 5: boot runs in the engine process, so cwd-relative paths
// resolved against the CALLER's directory — a foreign server reading
// config.json failed from outside its dir, and a scaffold booted with no
// routes and no public/ (GET / -> 404) yet still passed. Boot now chdirs.
test('verify boots the project from its own directory regardless of the caller cwd', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'i2p-cwd-'));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  await writeFile(join(dir, 'config.json'), '{"greeting":"hi"}\n');
  await writeFile(
    join(dir, 'server.mjs'),
    "import { readFileSync } from 'node:fs';\nimport { createServer } from 'node:http';\n" +
      "const config = JSON.parse(readFileSync('config.json', 'utf8')); // cwd-relative on purpose\n" +
      'export function start(port = 0) {\n' +
      '  const server = createServer((req, res) => { res.writeHead(200); res.end(config.greeting); });\n' +
      '  return new Promise((resolve) => server.listen(port, () => resolve({ port: server.address().port, close: () => new Promise((r) => server.close(() => r())) })));\n' +
      '}\n',
  );
  await writeFile(join(dir, 'smoke.test.mjs'), "import test from 'node:test';\ntest('ok', () => {});\n");
  const foreign = await i2p(['verify', dir], { cwd: HERE, timeout: 60_000 });
  assert.match(foreign.stdout, /verify — PASS \(3\/3 passed\)/);

  // scaffold verified from its parent: the static root must really be served
  const projectDir = await scaffold(t, {});
  const scaffolded = await i2p(['verify', 'app'], { cwd: join(projectDir, '..') });
  assert.match(scaffolded.stdout, /boot\s+PASS\s+GET \/api\/health -> 200, GET \/ -> 200/);
});

// review round: uploaded/generated .test. files must never be EXECUTED by
// check — the walk skips uploads/, dist/, data/, coverage/ exactly like the
// syntax step refuses to read uploads (empirical repro: pre-fix, an
// uploads/evil.test.mjs ran and flipped a green scaffold to FAIL).
test('uploaded or generated .test. files are never executed by check', async (t) => {
  const projectDir = await scaffold(t, {});
  await mkdir(join(projectDir, 'uploads'));
  await writeFile(join(projectDir, 'uploads', 'evil.test.mjs'), FAILING_TEST);
  await mkdir(join(projectDir, 'dist'));
  await writeFile(join(projectDir, 'dist', 'bundled.test.js'), FAILING_TEST);
  const { stdout } = await i2p(['check'], { cwd: projectDir });
  assert.match(stdout, /PASS \(3\/3 passed\)/); // scaffold tests only — the evil files never ran
  assert.doesNotMatch(stdout, /deliberately failing/);
});

// review round: node:test's wider basename conventions (test-*.js, *-test.js,
// *_test.js, plain test.js) and NESTED test/ directories are discovered too —
// a mixed project (passing a.test.js + failing b-test.js) must not false-PASS.
test('verify honors node:test basename conventions and nested test/ dirs', async (t) => {
  for (const rel of ['b-test.js', 'c_test.mjs', 'd.test.js']) {
    const dir = await mkdtemp(join(tmpdir(), 'i2p-disc5-'));
    t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
    await writeFile(join(dir, rel), FAILING_TEST);
    await assert.rejects(
      i2p(['verify', dir], { cwd: HERE }),
      (err) => /FAIL/.test(err.stdout ?? ''),
      `${rel} must be discovered and run`,
    );
  }
  const nested = await mkdtemp(join(tmpdir(), 'i2p-disc6-'));
  t.after(() => rm(nested, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  await mkdir(join(nested, 'src', 'test'), { recursive: true });
  await writeFile(join(nested, 'src', 'test', 'x.js'), FAILING_TEST);
  await assert.rejects(
    i2p(['verify', nested], { cwd: HERE }),
    (err) => /FAIL/.test(err.stdout ?? ''),
    'nested test/ dir must be discovered and run',
  );
});

// review round: when syntax fails, tests are skipped for THAT reason — boot
// must say so instead of claiming no tests were found.
test('boot skip names a syntax failure as the cause', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'i2p-disc7-'));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  await writeFile(join(dir, 'broken.mjs'), 'syntax error here({\n');
  await writeFile(join(dir, 'ok.test.mjs'), "import test from 'node:test';\ntest('ok', () => {});\n");
  await assert.rejects(
    i2p(['verify', dir], { cwd: HERE }),
    (err) => /boot\s+SKIP\s+skipped \(syntax failed\)/.test(err.stdout ?? '')
      && !/no test files found/.test(err.stdout ?? ''),
  );
});

test('check still names itself check and finds scaffolded tests/ files', async (t) => {
  const projectDir = await scaffold(t, { template: 'cli' });
  const { stdout } = await i2p(['check'], { cwd: projectDir });
  assert.match(stdout, /Idea2Prototype check — PASS/);
  assert.match(stdout, /tests\s+PASS\s+\d+ tests passed/); // discovery found tests/, not nothing
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

// #52/#53/#57: everything `new` validates happens BEFORE any file is written,
// and unknown flags die on every command instead of being silently ignored.
test('new rejects reserved Windows device names and over-long names before writing', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'i2p-names-'));
  t.after(() => rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  for (const bad of ['CON', 'nul', 'Aux', 'com1', 'lpt9', 'con/proj', 'sub/nul/x']) {
    await assert.rejects(
      i2p(['new', bad], { cwd: base }),
      (err) => /reserved Windows device name/i.test(err.stderr ?? ''),
    );
  }
  await assert.rejects(
    i2p(['new', 'a'.repeat(201)], { cwd: base }),
    (err) => /directory name too long/.test(err.stderr ?? ''),
  );
  assert.deepEqual(await readdir(base), []); // nothing scaffolded by any attempt
  // boundary: COM1-9 are reserved; COM10 reads as an ordinary name and scaffolds
  await i2p(['new', 'com10'], { cwd: base });
  assert.deepEqual(await readdir(base), ['com10']);
});

test('new fails on quote/backslash --name or --idea before writing any files', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'i2p-badval-'));
  t.after(() => rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  await assert.rejects(
    i2p(['new', 'proj', '--name', 'x"y'], { cwd: base }),
    (err) => /invalid --name value/.test(err.stderr ?? ''),
  );
  await assert.rejects(
    i2p(['new', 'proj', '--idea', 'say "hi"'], { cwd: base }),
    (err) => /invalid --idea value/.test(err.stderr ?? ''),
  );
  assert.deepEqual(await readdir(base), []);
});

test('unknown flags die with the allowed list instead of being ignored', async (t) => {
  const dir = await scaffold(t, { template: 'cli' });
  await assert.rejects(
    i2p(['check', '--frobnicate'], { cwd: dir }),
    (err) => /unknown flag "--frobnicate" \(allowed: --json\)/.test(err.stderr ?? ''),
  );
  await assert.rejects(
    i2p(['new', 'x', '--nope'], { cwd: dir }),
    (err) => /unknown flag "--nope"/.test(err.stderr ?? ''),
  );
  await assert.rejects(
    i2p(['list', '--nope'], { cwd: HERE }),
    (err) => /unknown flag "--nope" \(allowed: --json\)/.test(err.stderr ?? ''),
  );
  await assert.rejects(
    i2p(['map', '--nope'], { cwd: HERE }),
    (err) => /unknown flag "--nope" \(allowed: --json\)/.test(err.stderr ?? ''),
  );
  // a value flag with no value, an empty string, or a flag-like next token is not silently skipped
  await assert.rejects(
    i2p(['new', 'x', '--template'], { cwd: dir }),
    (err) => /needs a value/.test(err.stderr ?? ''),
  );
  await assert.rejects(
    i2p(['new', 'x', '--name', ''], { cwd: dir }),
    (err) => /needs a value/.test(err.stderr ?? ''),
  );
  await assert.rejects(
    i2p(['new', 'x', '--idea', '--name'], { cwd: dir }),
    (err) => /needs a value/.test(err.stderr ?? ''),
  );
  // single-dash operands are typos of flags this CLI does not have
  await assert.rejects(
    i2p(['new', 'x', '--idea', '-nope'], { cwd: dir }),
    (err) => /needs a value/.test(err.stderr ?? ''),
  );
});

// extra positionals are not silently ignored either: `verify a b` that
// quietly ignores b and checks a is a silent wrong answer. (check/map/verify
// accept ONE optional directory; a second positional still dies.)
test('extra positional arguments die instead of being ignored', async (t) => {
  const dir = await scaffold(t, { template: 'cli' });
  for (const [args, msg] of [
    [['check', 'a', 'b'], /unexpected argument "b" — check takes one optional directory/],
    [['verify', 'a', 'b'], /unexpected argument "b" — verify takes one optional directory/],
    [['map', 'a', 'b'], /unexpected argument "b" — map takes one optional directory/],
    [['list', 'x'], /unexpected argument "x" — list takes no arguments/],
    [['new', 'a', 'b'], /unexpected argument "b" — new takes one directory name/],
    [['add', 'rate-limit', 'extra'], /unexpected argument "extra" — add takes one feature name/],
  ]) {
    await assert.rejects(
      i2p(args, { cwd: args[0] === 'list' ? HERE : dir }),
      (err) => msg.test(err.stderr ?? ''),
    );
  }
});

test('new reports an unusable parent directory instead of a raw ENOENT', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'i2p-parent-'));
  t.after(() => rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  await writeFile(join(base, 'notadir'), 'a file, not a directory');
  await assert.rejects(
    i2p(['new', 'notadir/sub'], { cwd: base }),
    (err) => /does not exist or is not a directory/.test(err.stderr ?? '') && !/ENOENT/.test(err.stderr ?? ''),
  );
});

// cp(recursive) creates missing intermediate parents, so nested paths like
// `new sub/proj` with sub absent are supported inputs — pinned after a review
// round nearly traded them away for the friendly-parent-error fix above.
test('new scaffolds into a nested path whose parents do not exist yet', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'i2p-nested-'));
  t.after(() => rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const { stdout } = await i2p(['new', 'sub/proj'], { cwd: base });
  assert.match(stdout, /prototype ready: proj/);
  assert.ok(await readFile(join(base, 'sub', 'proj', '.idea2prototype.json'), 'utf8'), 'marker landed');
});

// #57.3: a hung test run must surface as a timeout verdict, not spawn
// plumbing — and it takes TWO shapes depending on Node version: 22's runner
// kills a top-level-blocked file itself (--test-timeout fires at file level,
// TAP says "testTimeoutFailure"), 24's never fires so the engine's spawn
// budget is the only bound (ETIMEDOUT, no summary). The predicate accepts
// both; anything else ("? failed of ?", spawnSync errors) is a regression.
// COST: on runners where the file-level timeout does not fire this test
// deliberately burns the full spawn budget (~90s of the suite). That is the
// point; do not "fix" it by shortening. On POSIX the budget kill reaches only
// the direct child (node --test), so a spinning test worker may briefly
// outlive it — acceptable on disposable CI runners (Windows kills the tree
// cleanly; verified locally).
test('verify reports a hung test run as a timeout verdict, not spawn plumbing', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'i2p-hang-'));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  await mkdir(join(dir, 'tests'));
  await writeFile(join(dir, 'tests', 'hang.test.mjs'), 'while (true) {}\n');
  await assert.rejects(
    i2p(['verify', dir], { cwd: HERE }),
    (err) => /tests timed out/.test(err.stdout ?? '')
      && !/spawnSync/.test(err.stdout ?? '') && !/\? failed of \?/.test(err.stdout ?? ''),
  );
});

test('npm bin shim runs the engine', async () => {
  const bin = fileURLToPath(new URL('../bin/i2p.mjs', import.meta.url));
  const { stdout } = await run(process.execPath, [bin, 'version'], { timeout: 30_000 });
  assert.match(stdout, /\d+\.\d+\.\d+/);
});

test('list shows templates and features', async () => {
  const { stdout } = await i2p(['list'], { cwd: HERE });
  assert.match(stdout, /templates: api, cli, library, web, worker/);
  for (const name of ['api', 'cli', 'library', 'web', 'worker']) {
    assert.match(stdout, new RegExp(`\\b${name}\\b`));
  }
});

test('list --json emits machine-readable templates and features', async () => {
  const human = await i2p(['list'], { cwd: HERE });
  assert.equal(human.stderr, '');
  const templatesLine = human.stdout.split('\n').find((l) => l.startsWith('templates: '));
  assert.ok(templatesLine, 'human output contains templates line');
  const humanTemplates = templatesLine.replace('templates: ', '').trim().split(', ').map((s) => s.trim()).filter(Boolean);

  const res = await i2p(['list', '--json'], { cwd: HERE });
  assert.equal(res.stderr, '');
  const parsed = JSON.parse(res.stdout);

  const pkg = JSON.parse(await readFile(join(HERE, '..', 'package.json'), 'utf8'));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.version, pkg.version);
  assert.deepEqual(new Set(parsed.templates), new Set(humanTemplates));
  assert.deepEqual(parsed.templates, ['api', 'cli', 'library', 'web', 'worker']);

  const featuresLine = human.stdout.split('\n').find((l) => l.startsWith('features: '));
  assert.ok(featuresLine, 'human output contains features line');
  for (const feat of parsed.features) {
    assert.match(featuresLine, new RegExp(`\\b${feat}\\b`));
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
  // web template (3) + generated CRUD (3) + seed + observe
  assert.match(stdout, /8 tests passed/);
});

// `i2p check my-app` from the parent dir is the first command a fresh agent
// tries after `i2p new my-app` — it used to die with "check takes no arguments".
test('check <dir> verifies a project from outside it (no cd required)', async (t) => {
  const projectDir = await scaffold(t, { template: 'web' });
  const parent = join(projectDir, '..');
  const outside = await i2p(['check', 'app'], { cwd: parent });
  assert.match(outside.stdout, /PASS \(3\/3 passed\)/);
  const inside = await i2p(['check'], { cwd: projectDir });
  assert.match(inside.stdout, /PASS \(3\/3 passed\)/);
  await assert.rejects(
    i2p(['check', 'definitely-missing'], { cwd: parent }),
    (err) => /no such directory/.test(err.stderr ?? ''),
  );
});

// Two prototypes side by side: the second `npm start` must fall forward to
// the next port (Vite-style), not crash with an unhandled EADDRINUSE stack.
// An explicit PORT never hunts — it fails with a one-line readable error.
test('server start() hunts past a busy port; explicit PORT fails with a clean message', async (t) => {
  const previousPort = process.env.PORT;
  delete process.env.PORT;
  try {
    for (const template of ['web', 'api']) {
      const projectDir = await scaffold(t, { template });
      const { start } = await import(pathToFileURL(join(projectDir, 'server.mjs')).href);

      const first = await start(0); // OS-assigned port, held open on purpose
      t.after(() => first.close());
      const hunted = await start(first.port); // no explicit PORT -> falls forward
      t.after(() => hunted.close());
      assert.notEqual(hunted.port, first.port, `${template}: expected a port beyond busy ${first.port}`);
      const health = await fetch(`http://127.0.0.1:${hunted.port}/api/health`);
      assert.equal(health.status, 200);

      process.env.PORT = String(first.port); // explicit PORT -> readable error, no raw stack
      await assert.rejects(start(), /Port \d+ is already in use/);
      delete process.env.PORT;

      // retries exhausted (zero allowed here) takes the same friendly exit,
      // naming the port that finally refused — not just the first busy one
      await assert.rejects(start(first.port, 0), new RegExp(`Port ${first.port} is already in use`));
    }
  } finally {
    if (previousPort === undefined) delete process.env.PORT;
    else process.env.PORT = previousPort;
  }
});

// The first-trial crash this branch kills, end to end: `npm start` with an
// explicit busy PORT must exit non-zero with the one-line message only —
// no unhandled EADDRINUSE stack, no EventEmitter internals on stderr.
test('npm start on a busy explicit PORT exits cleanly with the one-line error', async (t) => {
  const previousPort = process.env.PORT;
  delete process.env.PORT;
  try {
    for (const template of ['web', 'api']) {
      await t.test(template, async () => {
        const projectDir = await scaffold(t, { template });
        const { start } = await import(pathToFileURL(join(projectDir, 'server.mjs')).href);
        const holder = await start(0); // holds a port busy for the child
        t.after(() => holder.close());

        const child = spawn(process.execPath, ['server.mjs'], {
          cwd: projectDir,
          env: { ...process.env, PORT: String(holder.port) },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', (c) => { output += c; });
        child.stderr.on('data', (c) => { output += c; });
        const code = await new Promise((resolve) => {
          const timer = setTimeout(() => { child.kill('SIGKILL'); resolve('timeout'); }, 15_000);
          child.once('exit', (c) => { clearTimeout(timer); resolve(c); });
        });
        assert.notEqual(code, 'timeout', `server never exited; output: ${output}`);
        assert.equal(code, 1, `expected exit code 1; output: ${output}`);
        assert.match(output, new RegExp(`Port ${holder.port} is already in use`));
        assert.doesNotMatch(output, /node:internal|EventEmitter|^\s+at /m);
      });
    }
  } finally {
    if (previousPort === undefined) delete process.env.PORT;
    else process.env.PORT = previousPort;
  }
});

// The static guard must check the separator boundary: a sibling directory
// sharing the `public` prefix (public-secret/) must stay unreachable. Raw
// `../` is normalized away by every spec-compliant client, so the encoded
// form (`..%2F`) is what actually reaches the server's path decode.
test('web server rejects encoded ../ traversal into sibling prefix directories', async (t) => {
  const projectDir = await scaffold(t, { template: 'web' });
  const siblingDir = join(projectDir, 'public-secret');
  await mkdir(siblingDir, { recursive: true });
  await writeFile(join(siblingDir, 'secret.txt'), 'leaked');

  const { start } = await import(pathToFileURL(join(projectDir, 'server.mjs')).href);
  const app = await start(0);
  t.after(() => app.close());
  const res = await fetch(`http://127.0.0.1:${app.port}/..%2Fpublic-secret%2Fsecret.txt`);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'bad path');
});

// ---------------------------------------------------------------------------
// Regressions for the stress-suite findings (tests/stress.test.mjs). Each one
// pins a defect the seeded stress run caught on the unfixed tree.
// ---------------------------------------------------------------------------

// Raw node:http GET: fetch/URL normalize dot segments and reject malformed
// targets client-side, so they can never send the paths these tests need.
function rawGet(port, path) {
  return new Promise((resolve) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', (err) => resolve({ status: 0, body: err.code ?? String(err) }));
    req.setTimeout(5_000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

// A foreign project for verify: files = { relPath: contents }.
async function foreignProject(t, files) {
  const dir = await mkdtemp(join(tmpdir(), 'i2p-foreign-'));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(join(dir, rel, '..'), { recursive: true });
    await writeFile(join(dir, rel), text);
  }
  return dir;
}
const verifyJson = async (dir) => JSON.parse((await i2p(['verify', dir, '--json']).catch((e) => e)).stdout);
const PASSING_TEST = "import test from 'node:test';\ntest('ok', () => {});\n";

// Stress H1: api-crud and auth-local persisted with bare concurrent writeFile
// calls on one path. A burst of POSTs interleaved them into a store with
// trailing garbage — the next start quarantined it and every row was gone.
test('concurrent api-crud and auth-local writes leave complete, parseable stores', async (t) => {
  const projectDir = await scaffold(t, { feature: 'api-crud', resource: 'items' });
  await i2p(['add', 'auth-local'], { cwd: projectDir });
  const { port, stop } = await bootServer(t, projectDir);
  try {
    const base = `http://127.0.0.1:${port}`;
    const post = (path, body) => fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    }).then((r) => r.status);
    const blob = 'x'.repeat(20_000);
    const created = await Promise.all(Array.from({ length: 150 }, (_, i) => post('/api/items', { i, blob })));
    assert.ok(created.every((s) => s === 201), `statuses: ${[...new Set(created)]}`);
    const items = JSON.parse(await readFile(join(projectDir, 'data', 'items.json'), 'utf8'));
    assert.equal(items.length, 150);
    // Shrinking writes are the sharp case: an older, LONGER snapshot landing
    // over a newer, shorter one used to leave trailing garbage behind.
    const deleted = await Promise.all(items.slice(0, 75).map((item) => fetch(`${base}/api/items/${item.id}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(60_000),
    }).then((r) => r.status)));
    assert.ok(deleted.every((s) => s === 204 || s === 200), `statuses: ${[...new Set(deleted)]}`);
    const remaining = JSON.parse(await readFile(join(projectDir, 'data', 'items.json'), 'utf8'));
    assert.deepEqual(remaining.map((x) => x.id).sort(), items.slice(75).map((x) => x.id).sort());

    const registered = await Promise.all(Array.from({ length: 20 }, (_, i) => post('/api/auth/register', { username: `user${i}`, password: 'correct horse battery' })));
    assert.ok(registered.every((s) => s === 201), `statuses: ${[...new Set(registered)]}`);
    const users = JSON.parse(await readFile(join(projectDir, 'data', 'users.json'), 'utf8'));
    assert.equal(users.length, 20);
  } finally {
    await stop();
  }
});

// Stress H16 (new, Windows): the temp-file + rename persist fails with a
// transient EPERM whenever another process holds the store open — measured at
// 2 in 3 renames under a concurrent reader — so writes 500ed and a repeated
// `check` flipped to FAIL. The stores retry the rename briefly. (POSIX rename
// never fails this way; there the test simply passes.)
test('store writes survive another process reading the store file', async (t) => {
  const projectDir = await scaffold(t, { feature: 'api-crud', resource: 'items' });
  const { port, stop } = await bootServer(t, projectDir);
  const post = (i) => fetch(`http://127.0.0.1:${port}/api/items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ i }),
    signal: AbortSignal.timeout(30_000),
  }).then((r) => r.status);
  assert.equal(await post(-1), 201); // the store file exists before the reader starts
  const reader = spawn(process.execPath, ['-e', [
    "const { readFileSync } = require('node:fs');",
    "const end = Date.now() + 60_000;",
    "while (Date.now() < end) { try { readFileSync('data/items.json'); } catch {} }",
  ].join('\n')], { cwd: projectDir, stdio: 'ignore' });
  const readerExit = new Promise((resolve) => reader.once('exit', resolve));
  try {
    const statuses = [];
    for (let i = 0; i < 60; i++) statuses.push(await post(i));
    assert.deepEqual([...new Set(statuses)], [201]);
  } finally {
    reader.kill();
    await readerExit;
    await stop();
  }
});

// Stress H3 + crash: a malformed target ("//%5c..%5c" makes new URL throw,
// "/%E0%A4%A" makes decodeURIComponent throw) escaped the handler's try as an
// unhandled rejection and killed the server; inside a route it was a 500
// leaking "URI malformed". Both templates must answer 400 and stay up.
for (const template of ['web', 'api']) {
  test(`${template} server answers malformed request paths with 400 and stays up`, async (t) => {
    const projectDir = await scaffold(t, { template, feature: 'api-crud', resource: 'items' });
    const { port, stop } = await bootServer(t, projectDir);
    try {
      for (const path of ['//%5c..%5c', '/%E0%A4%A', '/api/items/%E0%A4%A', '/api/items/%']) {
        const res = await rawGet(port, path);
        assert.equal(res.status, 400, `${path} -> ${res.status} ${res.body}`);
        assert.doesNotMatch(res.body, /URI malformed|Invalid URL/);
      }
      assert.equal((await rawGet(port, '/api/health')).status, 200, 'server died on a malformed path');
    } finally {
      await stop();
    }
  });
}

// Stress H17 (seed 4242): JSON.parse accepts nesting that JSON.stringify
// cannot write back (it recurses), so ONE anonymous POST of a 20k-deep body
// was stored by api-crud and every later GET/POST of the resource answered
// 500 "Maximum call stack size exceeded" until a restart.
for (const template of ['web', 'api']) {
  test(`${template} server rejects absurdly nested JSON before a route can store it`, async (t) => {
    const projectDir = await scaffold(t, { template, feature: 'api-crud', resource: 'items' });
    const { port, stop } = await bootServer(t, projectDir); // routes load from the project cwd
    try {
      const base = `http://127.0.0.1:${port}/api/items`;
      const post = (body) => fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      const deep = `${'{"a":'.repeat(20_000)}1${'}'.repeat(20_000)}`;
      const rejected = await post(deep);
      assert.equal(rejected.status, 400);
      assert.match((await rejected.json()).error, /nested too deeply/);
      assert.equal((await fetch(base)).status, 200, 'the resource must still list');
      assert.equal((await post(JSON.stringify({ title: 'x', nested: { ok: [1, { two: 2 }] } }))).status, 201);
      // brackets inside strings (escaped quotes too) are text, not nesting
      assert.equal((await post(JSON.stringify({ title: `\\"${'[{'.repeat(300)}` }))).status, 201);
    } finally {
      await stop();
    }
  });
}

// Stress H8: the rate-limit and cors wrappers destructured the handler
// result, so a streaming handler (returns nothing) or a contract bug threw
// "is not iterable" instead of reaching the server's own guard.
test('rate-limit and cors wrappers pass a non-array handler result through', async (t) => {
  const projectDir = await scaffold(t, { feature: 'rate-limit' });
  await i2p(['add', 'cors'], { cwd: projectDir });
  const { rateLimit } = await import(pathToFileURL(join(projectDir, 'routes', 'ratelimit.mjs')).href);
  const { cors } = await import(pathToFileURL(join(projectDir, 'routes', 'cors.mjs')).href);
  const ctx = { req: { method: 'GET', headers: {}, socket: { remoteAddress: '127.0.0.1' } } };
  for (const returned of [undefined, 'oops']) {
    assert.equal(await rateLimit({ max: 5 })(async () => returned)(ctx), returned);
    assert.equal(await cors()(async () => returned)(ctx), returned);
  }
  const [status, , headers] = await cors()(async () => [200, { ok: true }, null])(ctx);
  assert.equal(status, 200);
  assert.equal(headers.vary, 'Origin'); // null response headers still merge
});

// Stress H9: placeholders were replaced with string replacements, one key at
// a time. `$'`/`$&` expanded (pasting the rest of the manifest into itself —
// JSON.parse died AFTER every file was written), and later keys rescanned
// earlier values (`--name "$&"` became "{{name}}").
test('new keeps --name/--idea byte-identical: no $ patterns, no placeholder rescans', async (t) => {
  const name = "$& $' {{slug}}";
  const idea = "costs $' $` $$ more {{name}} __IDEA2PROTOTYPE_CMD__";
  const projectDir = await scaffold(t, { template: 'library', name, idea });
  const marker = JSON.parse(await readFile(join(projectDir, '.idea2prototype.json'), 'utf8'));
  assert.equal(marker.name, name);
  const spec = (await readFile(join(projectDir, 'PROTOTYPE.md'), 'utf8')).replaceAll('\r\n', '\n');
  assert.ok(spec.includes(`> Idea: ${idea}\n`), spec.split('\n').slice(0, 4).join('\n'));
  const { stdout } = await i2p(['check'], { cwd: projectDir });
  assert.match(stdout, /PASS/);
});

// Stress H10: U+2028 passed the control-character guard, but JS treats it as
// a line break — inside library/index.mjs's `//` header comment it ended the
// comment, and the fresh scaffold failed its own syntax check.
test('new rejects line/paragraph separators in --idea before writing', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'i2p-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const sepChar of [String.fromCharCode(0x2028), String.fromCharCode(0x2029)]) {
    const err = await i2p(['new', 'proj', '--template', 'library', '--idea', `a${sepChar}b`], { cwd: root }).then(() => null, (e) => e);
    assert.ok(err, 'a line separator in --idea must be rejected');
    assert.match(err.stderr, /^idea2prototype: invalid --idea value/);
    assert.deepEqual(await readdir(join(root, 'proj')).catch(() => []), []);
  }
});

// Stress H12: a hand-edited marker broke the engine — a UTF-8 BOM (Windows
// editors) read as "not valid JSON", and a missing or wrong-typed features
// list crashed add with a raw TypeError from .push.
test('hand-edited markers: BOM and missing features work, a bad features type dies readably', async (t) => {
  const projectDir = await scaffold(t, {});
  const markerPath = join(projectDir, '.idea2prototype.json');
  const good = JSON.parse(await readFile(markerPath, 'utf8'));

  await writeFile(markerPath, `${String.fromCharCode(0xfeff)}${JSON.stringify(good, null, 2)}`);
  await i2p(['add', 'cors'], { cwd: projectDir });
  const { stdout } = await i2p(['check'], { cwd: projectDir });
  assert.match(stdout, /PASS/);

  const { features, ...withoutFeatures } = good;
  await writeFile(markerPath, JSON.stringify(withoutFeatures));
  await i2p(['add', 'sse'], { cwd: projectDir });
  assert.deepEqual(JSON.parse(await readFile(markerPath, 'utf8')).features.map((f) => f.name), ['sse']);

  await writeFile(markerPath, JSON.stringify({ ...good, features: 'cors' }));
  const err = await i2p(['add', 'upload'], { cwd: projectDir }).then(() => null, (e) => e);
  assert.ok(err);
  assert.match(err.stderr, /^idea2prototype: \.idea2prototype\.json "features" must be a list/);
});

// Stress H11: concurrent adds each read-modify-wrote the marker, so features
// whose files landed on disk were silently missing from features[] (4 of 8
// lost on the first stress round).
test('concurrent adds on one project are all recorded in the marker', async (t) => {
  const projectDir = await scaffold(t, {});
  const adds = [['api-crud', '--resource', 'items'], ['api-crud', '--resource', 'notes'], ['auth-local'], ['upload'], ['rate-limit'], ['cors'], ['sse'], ['worker-jobs']];
  await Promise.all(adds.map((args) => i2p(['add', ...args], { cwd: projectDir })));
  const marker = JSON.parse(await readFile(join(projectDir, '.idea2prototype.json'), 'utf8'));
  const recorded = marker.features.map((f) => (f.resource ? `${f.name}:${f.resource}` : f.name)).sort();
  assert.deepEqual(recorded, adds.map(([f, , r]) => (r ? `${f}:${r}` : f)).sort());
});

// Stress H7: two checks on one project ran the generated tests against the
// same data/*.json at once and flipped one verdict to FAIL. Runs on a project
// now take a per-project lock: a live holder is waited for, a dead one's lock
// is taken over at once.
test('check waits for a live lock holder on the same project and takes over a dead one', async (t) => {
  const projectDir = await scaffold(t, {});
  const real = realpathSync.native(projectDir);
  const key = process.platform === 'win32' ? real.toLowerCase() : real;
  const lockPath = join(tmpdir(), `idea2prototype-${createHash('sha1').update(key).digest('hex').slice(0, 16)}.lock`);
  t.after(() => rm(lockPath, { force: true }));

  await writeFile(lockPath, '2147483646'); // no such process
  await i2p(['add', 'cors'], { cwd: projectDir, timeout: 30_000 });

  // alive holder (this test process): add and check must both wait for it
  for (const args of [['add', 'sse'], ['check']]) {
    await writeFile(lockPath, String(process.pid));
    const child = spawn(process.execPath, [SCRIPT, ...args], { cwd: projectDir, stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = new Promise((resolve) => child.once('exit', resolve));
    t.after(() => child.kill());
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && !/waiting for another run/.test(stderr)) await new Promise((r) => setTimeout(r, 100));
    assert.match(stderr, /waiting for another run \(pid \d+\)/, `${args[0]} did not wait`);
    assert.equal(child.exitCode, null, `${args[0]} must wait, not run alongside the holder`);
    await rm(lockPath);
    assert.equal(await exited, 0, stdout + stderr);
  }
  const marker = JSON.parse(await readFile(join(projectDir, '.idea2prototype.json'), 'utf8'));
  assert.deepEqual(marker.features.map((f) => f.name), ['cors', 'sse']);
});

// Review of H7: pids get recycled (fast on Windows), so a crashed holder's
// lock can name a pid that is alive again — every later run then waited out
// the full timeout and died. A lock older than any real run is stale.
test('a lock far older than any run is taken over even if its pid looks alive', async (t) => {
  const projectDir = await scaffold(t, {});
  const real = realpathSync.native(projectDir);
  const key = process.platform === 'win32' ? real.toLowerCase() : real;
  const lockPath = join(tmpdir(), `idea2prototype-${createHash('sha1').update(key).digest('hex').slice(0, 16)}.lock`);
  t.after(() => rm(lockPath, { force: true }));

  await writeFile(lockPath, String(process.pid)); // alive: this test process
  const old = new Date(Date.now() - 31 * 60_000);
  await utimes(lockPath, old, old);
  const { stderr } = await i2p(['add', 'cors'], { cwd: projectDir, timeout: 20_000 });
  assert.doesNotMatch(stderr, /waiting for another run/);
  const marker = JSON.parse(await readFile(join(projectDir, '.idea2prototype.json'), 'utf8'));
  assert.deepEqual(marker.features.map((f) => f.name), ['cors']);
});

// Review of H7 (CodeRabbit): when the lock cannot be created at all, add used
// to run UNLOCKED and could lose marker updates. add now refuses; check/verify
// only judge, so they warn and still deliver a verdict.
test('an uncreatable lock makes add refuse and check warn but still judge', async (t) => {
  const projectDir = await scaffold(t, {});
  const before = await readFile(join(projectDir, '.idea2prototype.json'), 'utf8');
  const missing = join(projectDir, 'no-such-tmp');
  const env = { ...process.env, TMPDIR: missing, TEMP: missing, TMP: missing };
  await assert.rejects(i2p(['add', 'cors'], { cwd: projectDir, env }), (err) => {
    assert.match(err.stderr, /cannot create the project lock .*refusing to modify the project unlocked/);
    return true;
  });
  assert.equal(await readFile(join(projectDir, '.idea2prototype.json'), 'utf8'), before);
  const { stdout, stderr } = await i2p(['check'], { cwd: projectDir, env });
  assert.match(stderr, /cannot create the project lock .*running without it/);
  assert.match(stdout, /PASS/);
});

// Review of H7 (CodeRabbit): two waiters that judged the same dead lock stale
// could each delete it — the second deleting the first's fresh lock — and run
// side by side. Takeover is serialized; a crowd of adds after a crash must
// still record every feature.
test('concurrent adds after a crashed holder all take turns and are all recorded', async (t) => {
  const projectDir = await scaffold(t, {});
  const real = realpathSync.native(projectDir);
  const key = process.platform === 'win32' ? real.toLowerCase() : real;
  const lockPath = join(tmpdir(), `idea2prototype-${createHash('sha1').update(key).digest('hex').slice(0, 16)}.lock`);
  t.after(() => rm(lockPath, { force: true }));
  await writeFile(lockPath, '2147483646'); // crashed holder: no such process
  const adds = [['api-crud', '--resource', 'items'], ['api-crud', '--resource', 'notes'], ['auth-local'], ['upload'], ['rate-limit'], ['cors'], ['sse'], ['worker-jobs']];
  await Promise.all(adds.map((args) => i2p(['add', ...args], { cwd: projectDir, timeout: 60_000 })));
  const marker = JSON.parse(await readFile(join(projectDir, '.idea2prototype.json'), 'utf8'));
  assert.equal(marker.features.length, adds.length);
});

// Stress F2 on Windows CI (seed 1337): a holder released the lock between a
// waiter's failed create and its read. The failed read/stat passed for an
// empty, ancient lock, so the takeover deleted the NEXT holder's just-created
// (still empty) lock, two adds ran at once, and the marker was torn. The
// preload widens both windows (see the fixture) to make the race reproducible:
// before the fix, about 1 round in 7 lost a feature (30 rounds: <1% miss).
test('lock takeover never deletes a just-created holder under widened race windows', { timeout: 600_000 }, async (t) => {
  if (!process.allowedNodeEnvironmentFlags.has('--import')) {
    t.skip('needs node --import (Node >= 18.18)');
    return;
  }
  const preload = pathToFileURL(join(HERE, 'fixtures', 'lock-race-preload.mjs')).href;
  const resources = Array.from({ length: 8 }, (_, i) => `res${i}`);
  for (let round = 0; round < 30; round++) {
    const projectDir = await scaffold(t, {});
    await Promise.all(resources.map((r) => run(process.execPath, ['--import', preload, SCRIPT, 'add', 'api-crud', '--resource', r], { cwd: projectDir, timeout: 120_000 })));
    const marker = JSON.parse(await readFile(join(projectDir, '.idea2prototype.json'), 'utf8'));
    assert.deepEqual(marker.features.map((f) => f.resource).sort(), [...resources].sort(), `round ${round}: a concurrent add was lost`);
  }
});

// Review of S1e (security review): a lock that exists but cannot be read
// (here a directory: EISDIR) retried at once with no sleep and no deadline —
// a busy loop forever. Only a vanished lock (ENOENT) retries at once; an
// unreadable one is waited on like a live holder.
test('an unreadable lock is waited on, not spun on, and released by its removal', async (t) => {
  const projectDir = await scaffold(t, {});
  const real = realpathSync.native(projectDir);
  const key = process.platform === 'win32' ? real.toLowerCase() : real;
  const lockPath = join(tmpdir(), `idea2prototype-${createHash('sha1').update(key).digest('hex').slice(0, 16)}.lock`);
  t.after(() => rm(lockPath, { recursive: true, force: true }));
  await mkdir(lockPath);
  const child = spawn(process.execPath, [SCRIPT, 'add', 'cors'], { cwd: projectDir, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  t.after(() => child.kill());
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c) => { stdout += c; });
  child.stderr.on('data', (c) => { stderr += c; });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && !/waiting for another run/.test(stderr)) await new Promise((r) => setTimeout(r, 100));
  assert.match(stderr, /waiting for another run \(pid \?\)/, 'an unreadable lock must be waited on');
  assert.equal(child.exitCode, null);
  await rm(lockPath, { recursive: true });
  assert.equal(await exited, 0, stdout + stderr);
  const marker = JSON.parse(await readFile(join(projectDir, '.idea2prototype.json'), 'utf8'));
  assert.deepEqual(marker.features.map((f) => f.name), ['cors']);
});

// Stress H5: test output was capped at 16 MiB — a chatty but PASSING suite
// was killed with ENOBUFS and judged "? failed of ?".
test('verify passes a passing suite that logs 20 MiB', async (t) => {
  const dir = await foreignProject(t, {
    'loud.test.mjs': "import test from 'node:test';\nconst line = 'x'.repeat(1023);\ntest('loud but passing', () => { for (let i = 0; i < 20 * 1024; i++) console.log(line); });\n",
  });
  const verdict = await verifyJson(dir);
  assert.equal(verdict.status, 'PASS', JSON.stringify(verdict.steps));
});

// Stress H6: the syntax step walked dot-dirs, so build caches (.next/,
// .cache/) were judged as source — 200 generated files failed a real project.
test('verify does not judge build output in dot-dirs as source', async (t) => {
  const dir = await foreignProject(t, {
    'index.mjs': 'export const ok = 1;\n',
    'index.test.mjs': PASSING_TEST,
    '.cache/x/broken.js': 'this is not javascript (\n',
    '.next/server/chunk.js': 'export default {\n',
  });
  const verdict = await verifyJson(dir);
  assert.equal(verdict.status, 'PASS', JSON.stringify(verdict.steps));
  assert.equal(verdict.steps[0].files, 2);
});

// Stress H13: a root-level test file named "--x-test.mjs" was passed bare to
// node --test, parsed as a flag ("bad option"), and failed the run.
test('verify runs a root-level dash-led test file as a file, not a flag', async (t) => {
  const dir = await foreignProject(t, { '--x-test.mjs': PASSING_TEST });
  const verdict = await verifyJson(dir);
  assert.equal(verdict.status, 'PASS', JSON.stringify(verdict.steps));
  assert.match(verdict.steps[1].detail, /1 tests passed \(1 file\)/);
});

// Stress H14: map read every *.js entry with no error handling — a dangling
// symlink killed the whole command with a raw ENOENT.
test('map skips a dangling .js symlink instead of dying', async (t) => {
  const dir = await foreignProject(t, { 'index.mjs': 'export const ok = 1;\n' });
  try {
    await symlink(join(dir, 'missing.js'), join(dir, 'dangling.js'));
  } catch (err) {
    t.skip(`symlink unavailable here (${err.code})`);
    return;
  }
  const { stdout } = await i2p(['map', dir, '--json']);
  const map = JSON.parse(stdout);
  assert.deepEqual(map.files.map((f) => f.path), ['index.mjs']);
  assert.deepEqual(map.unreadable, ['dangling.js']);
});

// Review of H14 (CodeRabbit): an unreadable ROOT was swallowed (its prefix is
// empty), so map reported "0 code files" with no hint why.
test('map reports an unreadable root instead of an empty success', async (t) => {
  if (process.platform === 'win32' || process.getuid?.() === 0) {
    t.skip('needs POSIX permissions and a non-root user');
    return;
  }
  const dir = await foreignProject(t, { 'index.mjs': 'export const ok = 1;\n' });
  await chmod(dir, 0o000);
  let map;
  try {
    map = JSON.parse((await i2p(['map', dir, '--json'])).stdout);
  } finally {
    await chmod(dir, 0o755); // before the after-hook rm, which needs to list it
  }
  assert.deepEqual(map.unreadable, ['.']);
});
