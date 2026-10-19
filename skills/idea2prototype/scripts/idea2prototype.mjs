#!/usr/bin/env node
// idea2prototype — token-lean prototype scaffolds + one-command verification for coding agents.
// Zero dependencies. Requires Node >= 18.17 (built-in test runner with TAP reporter).
//
// Commands:
//   idea2prototype new <dir> [--template web|api|cli|worker|library] [--name "..."] [--idea "..."]
//   idea2prototype add <feature>     api-crud --resource <name> | auth-local | upload | rate-limit
//   idea2prototype check [--json]    syntax + tests + boot, compact verdict
//   idea2prototype verify [dir] [--json]    same verdict on ANY Node project
//   idea2prototype map [dir] [--json]       repo map: paths + LOC + exports
//   idea2prototype list
//
// `check` prints a compact verdict (~10 lines) so an agent never reads raw logs.
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const VERSION = '0.7.0';
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
  if (!dir) die('usage: idea2prototype new <dir> [--template web|api|cli|worker|library] [--name "..."] [--idea "..."]');

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
  if (template === 'library') {
    // derive the hint from the template so it can't drift when exports change
    const tmplExports = findExports(await readFile(join(templateDir, 'index.mjs'), 'utf8'));
    const entry = join(dir, 'index.mjs').replaceAll('\\', '/'); // forward slashes: copy-pasteable JS
    SAY(`  use:    ${tmplExports.length ? `import { ${tmplExports.join(', ')} } from ` : 'import '}"${entry}"`);
  } else {
    SAY(`  run:    cd ${dir} && ${template === 'cli' ? 'node cli.mjs help' : 'npm start'}`);
  }
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
  'rate-limit': {
    appliesTo: ['web', 'api'],
    files: () => ({
      'routes/ratelimit.mjs': 'route.tmpl.mjs',
      'tests/ratelimit.test.mjs': 'test.tmpl.mjs',
    }),
    summary: () => [
      'routes/ratelimit.mjs   rateLimit({ max, windowMs, keyFn }) wrapper + GET /api/ping demo',
      'tests/ratelimit.test.mjs  429 + Retry-After + header + key-isolation cases',
      'wrap handlers: methods: { GET: rateLimit({ max: 10 })(handler) }',
      'demo route: delete GET /api/ping from routes/ratelimit.mjs (and its test) when done',
    ],
  },
  cors: {
    appliesTo: ['web', 'api'],
    files: () => ({
      'routes/cors.mjs': 'route.tmpl.mjs',
      'tests/cors.test.mjs': 'test.tmpl.mjs',
    }),
    summary: () => [
      'routes/cors.mjs   cors({ origin, methods, credentials }) wrapper + GET /api/cors-ping demo',
      'tests/cors.test.mjs  preflight + allowlist reflection + demo-route cases',
      'wrap handlers: methods: { GET: cors({ origin: ["https://my.app"] })(handler) }',
      'demo route: delete GET /api/cors-ping from routes/cors.mjs (and its test) when done',
    ],
  },
};

async function cmdAdd(rest) {
  const feature = rest[0]?.startsWith('--') ? undefined : rest[0];
  const opts = parseFlags(rest.slice(feature ? 1 : 0), ['resource']);
  const available = Object.keys(FEATURES).join(', ');
  if (!feature) die(`usage: idea2prototype add <feature> — available: ${available}`);
  const def = FEATURES[feature];
  if (!def) die(`unknown feature "${feature}" — available: ${available}`);

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
  const marker = await readMarker(projectDir); // null for foreign projects (verify mode)
  const steps = [];
  const syntax = await stepSyntax(projectDir);
  steps.push(syntax);
  const tests = await stepTests(projectDir, syntax.status === 'pass');
  steps.push(tests);
  const boot = await stepBoot(projectDir, tests.status === 'pass', marker);
  steps.push(boot);

  const failed = steps.filter((s) => s.status === 'fail');
  const summary = failed.length === 0 ? 'PASS' : 'FAIL';
  const passedCount = steps.filter((s) => s.status === 'pass').length;
  const drifted = marker?.version && marker.version !== VERSION;

  if (asJson) {
    SAY(JSON.stringify({
      tool: 'idea2prototype',
      version: VERSION,
      ...(marker ? { scaffoldVersion: marker.version } : {}),
      project: projectDir,
      status: summary,
      steps,
    }, null, 2));
  } else {
    SAY(``);
    SAY(`Idea2Prototype check — ${summary} (${passedCount}/${steps.length} passed)  [${projectDir}]`);
    for (const s of steps) {
      const icon = s.status === 'pass' ? 'PASS ' : s.status === 'fail' ? 'FAIL ' : 'SKIP ';
      SAY(`  ${s.name.padEnd(7)} ${icon} ${s.detail}`);
      for (const note of s.notes ?? []) SAY(`      ${note}`);
    }
    if (drifted) {
      SAY(`  note    scaffolded by v${marker.version}, engine v${VERSION} — generated files may differ`);
    }
  }
  process.exitCode = failed.length ? 1 : 0;
}

async function stepSyntax(projectDir) {
  const serverFiles = await collectServerFiles(projectDir);
  const frontendFiles = await collectFrontendFiles(projectDir);
  const failures = [];
  for (const file of serverFiles) {
    const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (res.status !== 0) {
      failures.push(firstMeaningfulLine(res.stderr || res.stdout));
    }
  }
  for (const file of frontendFiles) {
    const source = (await readFile(file, 'utf8')).replace(/^\uFEFF/, '');
    if (!parsesClean(source, 'module') && !parsesClean(source, 'commonjs')) {
      const rel = relative(projectDir, file).split(sep).join('/');
      failures.push(`${rel}: does not parse as ESM or classic script`);
    }
  }
  const total = serverFiles.length + frontendFiles.length;
  let detail;
  if (failures.length) {
    detail = `${failures.length}/${total} files invalid`;
  } else if (frontendFiles.length) {
    detail = `${total} files parse clean (${serverFiles.length} server + ${frontendFiles.length} frontend)`;
  } else {
    detail = `${serverFiles.length} files parse clean`;
  }
  return failures.length
    ? { name: 'syntax', status: 'fail', detail, notes: failures.slice(0, 3) }
    : { name: 'syntax', status: 'pass', detail };
}

// Browser JS can't take the plain `node --check <file>` path: an .js file
// with import/export parses as CommonJS and "fails" on Node < 22. Parse via
// stdin in BOTH modes instead — only code broken in each mode fails.
function parsesClean(source, inputType) {
  const res = spawnSync(process.execPath, ['--check', `--input-type=${inputType}`], {
    input: source,
    encoding: 'utf8',
    // 16 MiB matches stepTests. The default 1 MiB ENOBUFSs on parse errors in
    // big single-line (minified) files — status becomes null; a bumped buffer
    // keeps status meaningful. No error special-case: server-file parses treat
    // a null status as failure, and so does this.
    maxBuffer: 16 * 1024 * 1024,
  });
  return res.status === 0;
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
  // Strip NODE_TEST_CONTEXT so a check spawned from inside a test runner
  // doesn't put the child into child-reporter mode (no TAP summary).
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
  const fileArgs = testFiles.map((f) => join('tests', f));
  const spawnOpts = { encoding: 'utf8', timeout: 90_000, cwd: projectDir, maxBuffer: 16 * 1024 * 1024, env };
  const capture = (res) => `${res.stdout ?? ''}\n${res.stderr ?? ''}`.replaceAll('\r\n', '\n');

  let res = spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', '--test-timeout=15000', ...fileArgs],
    spawnOpts,
  );
  let out = capture(res);
  // Node < 20 rejects the newer runner flags as bad options — retry bare
  // (--test): the default non-TTY reporter there is already TAP.
  if (/bad option|unknown option|unknown switch/i.test(out)) {
    res = spawnSync(process.execPath, ['--test', ...fileArgs], spawnOpts);
    out = capture(res);
  }
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

async function stepBoot(projectDir, testsPassed, marker) {
  if (!testsPassed) return { name: 'boot', status: 'skip', detail: 'skipped (tests failed)' };
  // Library projects have no server to probe — boot = import the public API.
  if (marker?.template === 'library') return bootLibrary(projectDir);
  return bootServer(projectDir, marker);
}

async function bootLibrary(projectDir) {
  const started = Date.now();
  try {
    const mod = await withTimeout(import(pathToFileURL(join(projectDir, 'index.mjs')).href), 15_000, 'library import');
    const names = Object.keys(mod);
    if (!names.length) return { name: 'boot', status: 'fail', detail: 'index.mjs loads but exports nothing' };
    return {
      name: 'boot',
      status: 'pass',
      detail: `index.mjs loads in ${Date.now() - started}ms — exports: ${names.join(', ')}`,
    };
  } catch (err) {
    return { name: 'boot', status: 'fail', detail: `import failed: ${String(err?.message ?? err)}` };
  }
}

async function bootServer(projectDir, marker) {
  const serverPath = join(projectDir, 'server.mjs');
  if (!existsSync(serverPath)) return { name: 'boot', status: 'skip', detail: 'no server.mjs' };

  const started = Date.now();
  let app; // closed in finally once started — a leaked listener hangs the process forever
  try {
    const mod = await withTimeout(import(pathToFileURL(serverPath).href), 15_000, 'server import');
    if (typeof mod.start !== 'function') {
      return { name: 'boot', status: 'skip', detail: 'server.mjs does not export start()' };
    }
    app = await withTimeout(mod.start(0), 10_000, 'server start');
    // redirect: 'manual' — never follow a redirect off the probe target; the
    // 3xx itself counts as serving (foreign ok-range is 200–399).
    const probe = async (path) =>
      withTimeout(fetch(`http://127.0.0.1:${app.port}${path}`, { redirect: 'manual' }), 10_000, `${path} request`);
    let res = await probe('/api/health');
    let detail = `GET /api/health -> ${res.status}`;
    // Foreign projects (verify mode) may not implement our template's health
    // route — a server that starts and serves its own surface still boots.
    let rootProbed = false;
    if (res.status === 404) {
      res = await probe('/');
      detail = `GET /api/health -> 404, GET / -> ${res.status}`;
      rootProbed = true;
    }
    const body = await res.json().catch(() => ({}));

    // Scaffolded projects follow the template contract (health returns
    // {"status":"ok"}); foreign projects only have to start and serve.
    const ok = marker
      ? res.status === 200 && body.status === 'ok'
      : res.status >= 200 && res.status < 400;
    if (!ok) {
      return { name: 'boot', status: 'fail', detail: `${detail} ${JSON.stringify(body)}` };
    }

    // #18: a health route alone can certify an app whose every real route
    // 500s — also probe the root. 4xx on / is legitimate (API-only projects),
    // a 5xx root is a real defect. Symmetric for scaffolded and foreign
    // projects; a request error here surfaces via the outer catch.
    if (!rootProbed) {
      const root = await probe('/');
      detail += `, GET / -> ${root.status}`;
      if (root.status >= 500) {
        return { name: 'boot', status: 'fail', detail: `${detail} — root serves an error` };
      }
    }
    return { name: 'boot', status: 'pass', detail: `${detail} in ${Date.now() - started}ms` };
  } catch (err) {
    return { name: 'boot', status: 'fail', detail: String(err?.message ?? err) };
  } finally {
    if (typeof app?.close === 'function') await app.close().catch(() => {});
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
  SAY(`  idea2prototype new <dir> [--template web|api|cli|worker|library] [--name "..."] [--idea "..."]`);
  SAY(`  idea2prototype add <feature> [options]       api-crud --resource <n> | auth-local | upload | rate-limit | cors`);
  SAY(`  idea2prototype check [--json]                   syntax + tests + boot, compact verdict`);
  SAY(`  idea2prototype verify [dir] [--json]            same verdict on ANY Node project (judge mode)`);
  SAY(`  idea2prototype map [dir] [--json]               compact repo map: paths + LOC + exports`);
  SAY(`  idea2prototype list                             available templates and features`);
  SAY(`  idea2prototype version                          print the engine version`);
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------
const withTimeout = (promise, ms, label) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

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

// Canonical marker reader: null when absent or unparseable.
async function readMarker(projectDir) {
  try {
    return JSON.parse(await readFile(join(projectDir, '.idea2prototype.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function loadMarker() {
  const markerPath = join(process.cwd(), '.idea2prototype.json');
  if (!existsSync(markerPath)) {
    die(`not a idea2prototype project (no .idea2prototype.json in ${process.cwd()}) — run: idea2prototype new <dir>`);
  }
  const marker = await readMarker(process.cwd());
  if (!marker) die('.idea2prototype.json is not valid JSON');
  return marker;
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

// One canonical walker: collect files under root, skipping skip-set entries,
// keeping names matching keep(). File-class policies live at the call sites.
async function collectJsFiles(root, { skip, keep }) {
  const out = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (keep(entry.name)) out.push(full);
    }
  }
  await walk(root);
  return out;
}

// Server code must parse under Node's own rules (node --check). public/ is
// excluded here on purpose: browser ESM in .js must not have to parse as
// CommonJS — those files get the dual-parse treatment in stepSyntax (#17).
const SERVER_SKIP = new Set(['node_modules', '.git', 'public', 'data', 'dist', 'coverage', 'uploads']);
const collectServerFiles = (root) =>
  collectJsFiles(root, { skip: SERVER_SKIP, keep: (name) => /\.(mjs|js)$/.test(name) && !name.endsWith('.config.cjs') });

// public/ is browser territory: .js only, dual-parsed (ESM, then classic).
const FRONTEND_SKIP = new Set(['node_modules', '.git']);
const collectFrontendFiles = async (projectDir) => {
  const publicDir = join(projectDir, 'public');
  return existsSync(publicDir)
    ? collectJsFiles(publicDir, { skip: FRONTEND_SKIP, keep: (name) => name.endsWith('.js') })
    : [];
};

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
