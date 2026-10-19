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
