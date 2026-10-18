#!/usr/bin/env node
// idea2prototype — token-lean prototype scaffolds + one-command verification for coding agents.
// Zero dependencies. Requires Node >= 18.17 (built-in test runner with TAP reporter).
//
// Commands:
//   idea2prototype new <dir> [--template web|api|cli] [--name "..."] [--idea "..."]
//   idea2prototype add api-crud --resource <name>
//   idea2prototype check [--json]
//   idea2prototype list
//
// `check` prints a compact verdict (~10 lines) so an agent never reads raw logs.
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const VERSION = '0.2.0';
const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(HERE, '..', 'templates');
const FEATURES_DIR = join(TEMPLATES_DIR, 'features');
const TEXT_EXTENSIONS = new Set(['.md', '.json', '.html', '.js', '.mjs', '.css', '.txt', '.yaml', '.yml']);

const SAY = (...args) => console.log(...args);
const FAIL = (...args) => console.error(...args);

// ---------------------------------------------------------------------------
// new
// ---------------------------------------------------------------------------
async function cmdNew(rest) {
  const opts = parseFlags(rest, ['template', 'name', 'idea']);
  const dir = opts._[0];
  if (!dir) die('usage: idea2prototype new <dir> [--template web|api|cli] [--name "..."] [--idea "..."]');

  const template = opts.template ?? 'web';
  const templateDir = join(TEMPLATES_DIR, template);
  if (template === 'features' || !existsSync(templateDir) || !statSync(templateDir).isDirectory()) {
    die(`unknown template "${template}" — run: idea2prototype list`);
  }

  const slug = basename(resolve(dir)).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-_]*$/.test(slug)) {
    die(`invalid directory name "${slug}" — use letters, digits, dashes, underscores`);
  }
  const name = (opts.name ?? basename(resolve(dir))).replace(/[<>]/g, '');
  const idea = opts.idea ?? '(describe the idea in one sentence)';

  const target = resolve(process.cwd(), dir);
  if (existsSync(target) && readdirSyncSafe(target).length > 0) {
    die(`"${target}" exists and is not empty — idea2prototype never overwrites existing files`);
  }

  await cp(templateDir, target, { recursive: true });
  await replacePlaceholders(target, {
    '{{name}}': name,
    '{{slug}}': slug,
    '{{idea}}': idea,
    __IDEA2PROTOTYPE_BIN__: JSON.stringify(fileURLToPath(import.meta.url)).slice(1, -1),
  });

  const markerPath = join(target, '.idea2prototype.json');
  const marker = JSON.parse(await readFile(markerPath, 'utf8'));
  marker.createdAt = new Date().toISOString();
  await writeFile(markerPath, JSON.stringify(marker, null, 2) + '\n');

  SAY(`prototype ready: ${slug} (${template} template, zero dependencies)`);
  SAY(`  spec:   ${join(dir, 'PROTOTYPE.md')}  <- fill Goal + Core flows before coding`);
  SAY(`  run:    cd ${dir} && ${template === 'cli' ? 'node cli.mjs help' : 'npm start'}`);
  SAY(`  verify: cd ${dir} && npm run check`);
}

// ---------------------------------------------------------------------------
// add
// ---------------------------------------------------------------------------
const FEATURES = {
  'api-crud': {
    appliesTo: ['web', 'api'],
    files: (o) => ({
      [`routes/${o.resource}.mjs`]: 'route.tmpl.mjs',
      [`tests/${o.resource}.test.mjs`]: 'test.tmpl.mjs',
    }),
    summary: (o) => [
      `routes/${o.resource}.mjs   GET/POST /api/${o.resource} + GET/PUT/DELETE /api/${o.resource}/:id`,
      `tests/${o.resource}.test.mjs  CRUD roundtrip + validation`,
    ],
  },
  'auth-local': {
    appliesTo: ['web', 'api'],
    files: () => ({
      'routes/auth.mjs': 'route.tmpl.mjs',
      'tests/auth.test.mjs': 'test.tmpl.mjs',
    }),
    summary: () => [
      'routes/auth.mjs   register/login/logout/me — scrypt hashes + HMAC-signed cookies',
      'tests/auth.test.mjs  full session flow incl. tamper + validation cases',
      'protect routes: import { requireAuth } from "./auth.mjs"',
    ],
  },
  upload: {
    appliesTo: ['web', 'api'],
    files: () => ({
      'routes/uploads.mjs': 'route.tmpl.mjs',
      'tests/uploads.test.mjs': 'test.tmpl.mjs',
    }),
    summary: () => [
      'routes/uploads.mjs   POST /api/uploads (multipart) + GET /api/uploads/:name',
      'tests/uploads.test.mjs  upload roundtrip + validation/traversal cases',
      'files stored in uploads/ (5MB cap); zero-dependency multipart parser',
    ],
  },
};

async function cmdAdd(rest) {
  const feature = rest[0]?.startsWith('--') ? undefined : rest[0];
  const opts = parseFlags(rest.slice(feature ? 1 : 0), ['resource']);
  const available = Object.keys(FEATURES).join(', ');
  if (!feature) die(`usage: idea2prototype add <feature> — available: ${available}`);
  const def = FEATURES[feature] ?? ((() => die(`unknown feature "${feature}" — available: ${available}`))());

  const marker = await loadMarker();
  if (!def.appliesTo.includes(marker.template)) {
    die(`${feature} applies to ${def.appliesTo.join('/')} templates (this project: ${marker.template})`);
  }

  if (feature === 'api-crud') {
    const resource = opts.resource ?? die('--resource <name> is required (e.g. --resource todos)');
    if (!/^[a-z][a-z0-9-]*$/.test(resource)) {
      die(`invalid resource name "${resource}" — lowercase letters, digits, dashes`);
    }
    opts.resource = resource;
  }

  const files = def.files(opts);
  for (const dest of Object.keys(files)) {
    if (existsSync(join(process.cwd(), dest))) die(`${dest} already exists`);
  }
  for (const [dest, tmplFile] of Object.entries(files)) {
    const tmpl = await readFile(join(FEATURES_DIR, feature, tmplFile), 'utf8');
    await mkdir(dirname(join(process.cwd(), dest)), { recursive: true });
    await writeFile(join(process.cwd(), dest), tmpl.replaceAll('{{resource}}', opts.resource ?? ''));
  }

  marker.features.push({
    name: feature,
    ...(opts.resource ? { resource: opts.resource } : {}),
    addedAt: new Date().toISOString(),
  });
  await writeFile(join(process.cwd(), '.idea2prototype.json'), JSON.stringify(marker, null, 2) + '\n');

  SAY(`added ${feature}${opts.resource ? ` resource "${opts.resource}"` : ''}`);
  for (const line of def.summary(opts)) SAY(`  ${line}`);
  SAY(`  verify: npm run check`);
}

// ---------------------------------------------------------------------------
// check / verify — the compact verdict
// ---------------------------------------------------------------------------
async function cmdCheck(rest) {
  const opts = parseFlags(rest, []);
  await loadMarker(); // must run inside a idea2prototype project
  return runChecks(process.cwd(), 'json' in opts);
}

// verify: run the same verdict on ANY Node project — used to judge projects
// this tool never scaffolded (benchmark control arm, external code).
async function cmdVerify(rest) {
  const dir = rest.find((a) => !a.startsWith('--'));
  const target = resolve(process.cwd(), dir ?? '.');
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    die(`no such directory: ${target}`);
  }
  return runChecks(target, rest.includes('--json'));
}

async function runChecks(projectDir, asJson) {
  const steps = [];
  const syntax = await stepSyntax(projectDir);
  steps.push(syntax);
  const tests = await stepTests(projectDir, syntax.status === 'pass');
  steps.push(tests);
  const boot = await stepBoot(projectDir, tests.status === 'pass');
  steps.push(boot);

  const failed = steps.filter((s) => s.status === 'fail');
  const summary = failed.length === 0 ? 'PASS' : 'FAIL';
  const passedCount = steps.filter((s) => s.status === 'pass').length;

  if (asJson) {
    SAY(JSON.stringify({ tool: 'idea2prototype', version: VERSION, project: projectDir, status: summary, steps }, null, 2));
  } else {
    SAY(``);
    SAY(`Idea2Prototype check — ${summary} (${passedCount}/${steps.length} passed)  [${projectDir}]`);
    for (const s of steps) {
      const icon = s.status === 'pass' ? 'PASS ' : s.status === 'fail' ? 'FAIL ' : 'SKIP ';
      SAY(`  ${s.name.padEnd(7)} ${icon} ${s.detail}`);
      for (const note of s.notes ?? []) SAY(`      ${note}`);
    }
  }
  process.exitCode = failed.length ? 1 : 0;
}

async function stepSyntax(projectDir) {
  const files = await collectNodeFiles(projectDir);
  const failures = [];
  for (const file of files) {
    const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (res.status !== 0) {
      failures.push(firstMeaningfulLine(res.stderr || res.stdout));
    }
  }
  return failures.length
    ? { name: 'syntax', status: 'fail', detail: `${failures.length}/${files.length} files invalid`, notes: failures.slice(0, 3) }
    : { name: 'syntax', status: 'pass', detail: `${files.length} files parse clean` };
}

async function stepTests(projectDir, syntaxPassed) {
  const testDir = join(projectDir, 'tests');
  if (!syntaxPassed) return { name: 'tests', status: 'skip', detail: 'skipped (syntax failed)' };
  let testFiles = [];
  try {
    testFiles = (await readdir(testDir)).filter((f) => f.endsWith('.test.mjs'));
  } catch {
    return { name: 'tests', status: 'skip', detail: 'no tests/ directory' };
  }
  if (!testFiles.length) return { name: 'tests', status: 'skip', detail: 'no *.test.mjs files' };

  // Pass explicit file paths: glob args to `node --test` are Node >= 21 only.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
  const res = spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', '--test-timeout=15000', ...testFiles.map((f) => join('tests', f))],
    { encoding: 'utf8', timeout: 90_000, cwd: projectDir, maxBuffer: 16 * 1024 * 1024, env },
  );
  const out = `${res.stdout ?? ''}\n${res.stderr ?? ''}`.replaceAll('\r\n', '\n');
  const counts = {};
  for (const m of out.matchAll(/^# (tests|pass|fail|skipped|cancelled) (\d+)$/gm)) counts[m[1]] = Number(m[2]);

  if (res.status === 0 && !counts.fail && !counts.cancelled) {
    const ran = counts.tests ?? testFiles.length;
    return { name: 'tests', status: 'pass', detail: `${ran} tests passed (${testFiles.length} files)` };
  }
  const notes = [...out.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]).slice(0, 3);
  const runnerError = /^# (Error:.*)$/m.exec(out)?.[1];
  if (runnerError) notes.unshift(runnerError);
  if (!notes.length && res.error) notes.push(String(res.error.message ?? res.error));
  if (!notes.length) notes.push(firstMeaningfulLine(out));
  return {
    name: 'tests',
    status: 'fail',
    detail: `${counts.fail ?? '?'} failed of ${counts.tests ?? '?'}`,
    notes,
  };
}

async function stepBoot(projectDir, testsPassed) {
  const serverPath = join(projectDir, 'server.mjs');
  if (!testsPassed) return { name: 'boot', status: 'skip', detail: 'skipped (tests failed)' };
  if (!existsSync(serverPath)) return { name: 'boot', status: 'skip', detail: 'no server.mjs' };

  const started = Date.now();
  try {
    const withTimeout = (promise, ms, label) =>
      Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
      ]);
    const mod = await withTimeout(import(pathToFileURL(serverPath).href), 15_000, 'server import');
    if (typeof mod.start !== 'function') {
      return { name: 'boot', status: 'skip', detail: 'server.mjs does not export start()' };
    }
    const app = await withTimeout(mod.start(0), 10_000, 'server start');
    const res = await withTimeout(fetch(`http://127.0.0.1:${app.port}/api/health`), 10_000, 'health request');
    const body = await res.json();
    await app.close();
    if (res.status !== 200 || body.status !== 'ok') {
      return { name: 'boot', status: 'fail', detail: `health returned ${res.status} ${JSON.stringify(body)}` };
    }
    return { name: 'boot', status: 'pass', detail: `GET /api/health -> 200 in ${Date.now() - started}ms` };
  } catch (err) {
    return { name: 'boot', status: 'fail', detail: String(err?.message ?? err) };
  }
}

// ---------------------------------------------------------------------------
// list / help
// ---------------------------------------------------------------------------
async function cmdList() {
  const templates = (await readdir(TEMPLATES_DIR, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && d.name !== 'features')
    .map((d) => d.name);
  SAY(`templates: ${templates.join(', ')}`);
  SAY(`features:  ${Object.entries(FEATURES).map(([name, def]) => `${name} (${def.appliesTo.join('/')})`).join(', ')}`);
}

// map — compact repo map (paths + LOC + exports) so an agent can decide what
// to read instead of loading whole files into context.
async function cmdMap(rest) {
  const dir = rest.find((a) => !a.startsWith('--'));
  const asJson = rest.includes('--json');
  const root = resolve(process.cwd(), dir ?? '.');
  if (!existsSync(root) || !statSync(root).isDirectory()) die(`no such directory: ${root}`);

  const SKIP = new Set(['node_modules', '.git', 'data', 'uploads', 'dist', 'coverage']);
  const code = [];
  const other = [];
  async function walk(current, prefix) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(current, entry.name), rel);
      else if (/\.(mjs|js)$/.test(entry.name)) {
        const text = await readFile(join(current, entry.name), 'utf8');
        code.push({ path: rel, loc: text.split('\n').length, exports: findExports(text) });
      } else other.push(rel);
    }
  }
  await walk(root, '');
  code.sort((a, b) => a.path.localeCompare(b.path));
  const totalLoc = code.reduce((n, f) => n + f.loc, 0);

  if (asJson) {
    SAY(JSON.stringify({ files: code, staticAssets: other }, null, 2));
  } else {
    SAY(`map — ${code.length} code files, ${totalLoc} LOC (${other.length} static files omitted)`);
    for (const f of code.slice(0, 30)) {
      const exports = f.exports.length ? `  → ${f.exports.join(', ')}` : '';
      SAY(`  ${f.path.padEnd(36)} ${String(f.loc).padStart(4)} LOC${exports}`);
    }
    if (code.length > 30) SAY(`  … +${code.length - 30} more files`);
  }
}

function findExports(text) {
  const names = new Set();
  for (const m of text.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(m[1]);
  }
  for (const m of text.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name) names.add(name);
    }
  }
  if (/export\s+default\s*[\[{(]/.test(text)) names.add('default');
  return [...names];
}

function help() {
  SAY(`idea2prototype ${VERSION} — token-lean prototype scaffolds + verification`);
  SAY(``);
  SAY(`  idea2prototype new <dir> [--template web|api|cli] [--name "..."] [--idea "..."]`);
  SAY(`  idea2prototype add <feature> [options]       api-crud --resource <n> | auth-local | upload`);
  SAY(`  idea2prototype check [--json]                   syntax + tests + boot, compact verdict`);
  SAY(`  idea2prototype verify [dir] [--json]            same verdict on ANY Node project (judge mode)`);
  SAY(`  idea2prototype map [dir] [--json]               compact repo map: paths + LOC + exports`);
  SAY(`  idea2prototype list                             available templates and features`);
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------
function parseFlags(args, valueFlags) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (valueFlags.includes(key)) out[key] = args[++i];
      else out[key] = true;
    } else {
      out._.push(arg);
    }
  }
  return out;
}

async function loadMarker() {
  const markerPath = join(process.cwd(), '.idea2prototype.json');
  if (!existsSync(markerPath)) {
    die(`not a idea2prototype project (no .idea2prototype.json in ${process.cwd()}) — run: idea2prototype new <dir>`);
  }
  try {
    return JSON.parse(await readFile(markerPath, 'utf8'));
  } catch {
    die('.idea2prototype.json is not valid JSON');
  }
}

async function replacePlaceholders(root, mapping) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      await replacePlaceholders(full, mapping);
      continue;
    }
    if (!TEXT_EXTENSIONS.has(extname(entry.name))) continue;
    let text = await readFile(full, 'utf8');
    const before = text;
    for (const [needle, value] of Object.entries(mapping)) text = text.replaceAll(needle, value);
    if (text !== before) await writeFile(full, text);
  }
}

async function collectNodeFiles(root) {
  const skip = new Set(['node_modules', '.git', 'public', 'data', 'dist', 'coverage']);
  const out = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.(mjs|js)$/.test(entry.name) && !entry.name.endsWith('.config.cjs')) out.push(full);
    }
  }
  await walk(root);
  return out;
}

function readdirSyncSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function firstMeaningfulLine(text) {
  if (!text) return '(no output)';
  const line = text.split('\n').find((l) => l.trim().length > 0) ?? '(no output)';
  return line.length > 200 ? `${line.slice(0, 197)}...` : line;
}

function die(message) {
  FAIL(`idea2prototype: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
const command = process.argv[2];
const rest = process.argv.slice(3);
try {
  switch (command) {
    case 'new': await cmdNew(rest); break;
    case 'add': await cmdAdd(rest); break;
    case 'check': await cmdCheck(rest); break;
    case 'verify': await cmdVerify(rest); break;
    case 'map': await cmdMap(rest); break;
    case 'list': await cmdList(); break;
    case 'version': case '--version': case '-v': SAY(VERSION); break;
    case 'help': case undefined: case '--help': case '-h': help(); break;
    default: die(`unknown command "${command}" — run: idea2prototype help`);
  }
} catch (err) {
  die(String(err?.message ?? err));
}
