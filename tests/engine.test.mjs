// Engine self-tests: exercise every idea2prototype command end-to-end.
// These are also the CI workhorse — `node --test "tests/*.test.mjs"`.
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

test('scaffolds the web template and passes check', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'i2p-web-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await i2p(['new', 'app', '--template', 'web', '--name', 'My App', '--idea', 'todo list'], { cwd: dir });
  const { stdout } = await i2p(['check'], { cwd: join(dir, 'app') });
  assert.match(stdout, /PASS \(3\/3 passed\)/);
  assert.match(stdout, /boot\s+PASS/);
});

test('add api-crud keeps the web project green', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'i2p-crud-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await i2p(['new', 'app', '--template', 'web'], { cwd: dir });
  await i2p(['add', 'api-crud', '--resource', 'todos'], { cwd: join(dir, 'app') });
  const { stdout } = await i2p(['check'], { cwd: join(dir, 'app') });
  assert.match(stdout, /PASS \(3\/3 passed\)/);
  assert.match(stdout, /5 tests passed/);
});

test('add auth-local keeps the web project green', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'i2p-auth-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await i2p(['new', 'app', '--template', 'web'], { cwd: dir });
  await i2p(['add', 'auth-local'], { cwd: join(dir, 'app') });
  const { stdout } = await i2p(['check'], { cwd: join(dir, 'app') });
  assert.match(stdout, /PASS \(3\/3 passed\)/);
  assert.match(stdout, /4 tests passed/); // 3 web + 1 auth session flow
});

test('add upload keeps the web project green', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'i2p-up-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await i2p(['new', 'app', '--template', 'web'], { cwd: dir });
  await i2p(['add', 'upload'], { cwd: join(dir, 'app') });
  const { stdout } = await i2p(['check'], { cwd: join(dir, 'app') });
  assert.match(stdout, /PASS \(3\/3 passed\)/);
  assert.match(stdout, /5 tests passed/); // 3 web + 2 upload
});

test('add rate-limit keeps the web project green', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'i2p-rl-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await i2p(['new', 'app', '--template', 'web'], { cwd: dir });
  await i2p(['add', 'rate-limit'], { cwd: join(dir, 'app') });
  const { stdout } = await i2p(['check'], { cwd: join(dir, 'app') });
  assert.match(stdout, /PASS \(3\/3 passed\)/);
  assert.match(stdout, /5 tests passed/); // 3 web + 2 rate-limit
});

test('scaffolds the api template and passes check', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'i2p-api-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await i2p(['new', 'svc', '--template', 'api'], { cwd: dir });
  const { stdout } = await i2p(['check'], { cwd: join(dir, 'svc') });
  assert.match(stdout, /PASS \(3\/3 passed\)/);
});

test('scaffolds the cli template and passes check', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'i2p-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await i2p(['new', 'tool', '--template', 'cli'], { cwd: dir });
  const { stdout } = await i2p(['check'], { cwd: join(dir, 'tool') });
  assert.match(stdout, /PASS \(2\/3 passed\)/);
  assert.match(stdout, /no server\.mjs/);
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

test('check fails cleanly on a syntax error', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'i2p-broken-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await i2p(['new', 'app', '--template', 'web'], { cwd: dir });
  await writeFile(join(dir, 'app', 'broken.mjs'), 'syntax error here({\n');
  await assert.rejects(
    i2p(['check'], { cwd: join(dir, 'app') }),
    (err) => {
      assert.match(err.stdout, /FAIL/);
      assert.match(err.stdout, /syntax\s+FAIL/);
      return true;
    },
  );
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

test('scaffolds the worker template and passes check', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'i2p-worker-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await i2p(['new', 'jobs', '--template', 'worker'], { cwd: dir });
  const { stdout } = await i2p(['check'], { cwd: join(dir, 'jobs') });
  assert.match(stdout, /PASS \(2\/3 passed\)/);
  assert.match(stdout, /3 tests passed/);
  assert.match(stdout, /no server\.mjs/);
});

test('scaffolds the library template and passes check with an import smoke test', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'i2p-lib-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await i2p(['new', 'lib', '--template', 'library', '--name', 'My Lib', '--idea', 'state helpers'], { cwd: dir });
  const { stdout } = await i2p(['check'], { cwd: join(dir, 'lib') });
  assert.match(stdout, /PASS \(3\/3 passed\)/);
  assert.match(stdout, /boot\s+PASS/);
  assert.match(stdout, /index\.mjs loads/);
  assert.match(stdout, /createStore, memoAsync/);
  // fresh scaffold matches the engine version — no drift note expected
  assert.doesNotMatch(stdout, /note\s+scaffolded by/);
});

test('check reports scaffold/engine version drift without failing', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'i2p-drift-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await i2p(['new', 'app', '--template', 'web'], { cwd: dir });
  const markerPath = join(dir, 'app', '.idea2prototype.json');
  const marker = JSON.parse(await readFile(markerPath, 'utf8'));
  marker.version = '0.0.1';
  await writeFile(markerPath, JSON.stringify(marker));
  const { stdout } = await i2p(['check'], { cwd: join(dir, 'app') });
  assert.match(stdout, /PASS \(3\/3 passed\)/);
  assert.match(stdout, /scaffolded by v0\.0\.1, engine v/);
  const json = JSON.parse((await i2p(['check', '--json'], { cwd: join(dir, 'app') })).stdout);
  assert.equal(json.scaffoldVersion, '0.0.1');
});

test('map lists code files with LOC and exports', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'i2p-map-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await i2p(['new', 'app', '--template', 'web'], { cwd: dir });
  await i2p(['add', 'api-crud', '--resource', 'todos'], { cwd: join(dir, 'app') });
  const { stdout } = await i2p(['map'], { cwd: join(dir, 'app') });
  assert.match(stdout, /map — 5 code files/);
  assert.match(stdout, /server\.mjs.*→.*start/);
  assert.match(stdout, /routes\/todos\.mjs.*→.*default/);
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
