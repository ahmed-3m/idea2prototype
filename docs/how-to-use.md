# How to use idea2prototype

**Audience:** you as the human in the loop while an agent drives, or running the commands yourself. Every command is yours to run; the "report … then stop" phrasing is what your agent is told to do (`commands/proto-new.md`, `commands/proto-check.md`).

idea2prototype turns an idea into a running, tested prototype with minimal tokens. One zero-dependency Node script (Node >= 18.17) is the whole engine: `new` scaffolds a deterministic, tested project — web, api, cli, worker, or library — with zero LLM output; `add` generates feature modules (CRUD, auth, uploads, rate-limiting, CORS, SSE, background jobs) with tests baked in; `check` replaces raw logs with a compact syntax+tests+boot verdict (four lines, ~211 characters; token totals for from-scratch alternatives were not measured; see `README.md` and `skills/idea2prototype/SKILL.md`). The plugin/skill layer adds the workflow doc and two slash commands, `/proto-new` and `/proto-check`.

## Install

**Verified on a live checkout** (Windows/Git Bash, current engine) — four forms of the same engine:

```bash
npx @ahmed-3m/idea2prototype new my-app --template web --name "My App" --idea "recipe box"  # no install at all
npm i -g @ahmed-3m/idea2prototype   # short `i2p` + `idea2prototype` commands
git clone https://github.com/ahmed-3m/idea2prototype   # offline: run the engine file by path
node idea2prototype/skills/idea2prototype/scripts/idea2prototype.mjs list   # the cloned engine
```

npmjs.org is primary (README.md). **Documented but not executed here** (README.md): Claude Code — `claude plugin marketplace add ahmed-3m/idea2prototype` then `claude plugin install idea2prototype@ahmed-3m`; Agent Skills — `npx skills add ahmed-3m/idea2prototype` (skills CLI needs Node >= 22.20); Cline — `cline skill install ahmed-3m/idea2prototype` (the README offers no fallback beyond a marketplace PR — unverified until you run it). **Cursor** — the README documents no Cursor-specific command today (marketplace listing is via PR; `.cursor-plugin/plugin.json` awaits it), so use the npx/global paths. **ZCode** — the README only says "add this repo's marketplace, install `idea2prototype`" (plugin UI; no CLI command is documented, so none is quoted). **Root `plugin.json`** is metadata + suggestedPrompts, not an install path. `/proto-new` + `/proto-check` are wired by the `.claude-plugin`, `.cursor-plugin`, and `.zcode-plugin` manifests (`"commands": "./commands"`); Cline gets the skill only — no manifest in this repo wires commands there.

**Install → engine invocation** (the walkthrough uses `i2p`; substitute your row or you'll hit "command not found"):

| Install | Run the engine as |
|---|---|
| plugin/skill (Claude Code, ZCode) | `/proto-new <idea>` · `/proto-check` · `node "<skill-base>/scripts/idea2prototype.mjs" <cmd>` |
| `npx skills add` | `npx @ahmed-3m/idea2prototype <cmd>` (`<skill-base>` is not substituted for Agent-Skills installs — SKILL.md) |
| `npm i -g` | `i2p <cmd>` |
| clone | `node <repo>/skills/idea2prototype/scripts/idea2prototype.mjs <cmd>` |

`<skill-base>` is the skill's own directory, shown at the top of SKILL.md when it loads in ZCode (SKILL.md) — in this repo: `skills/idea2prototype`.

## Your first prototype

**0. Step 0 — Socratic alignment ("grill-me") — your agent does this; the engine never asks.** When template or scope is ambiguous, the skill makes the agent ask *you*: (1) template — web/api/cli/worker/library? (2) the 1–3 must-have core flows? (3) what is explicitly out of scope? An unambiguous request skips the questions, and the agent must then derive those same answers itself when filling the spec (`commands/proto-new.md`) — review them in Step 3. No skill loaded (npx/npm/clone)? Nothing asks: answer the three questions yourself and put them in the `new` flags, or copy `agents/AGENTS.md` (teaches commands; its workflow starts at the scaffold), or run brainstorm2idea `/b2i` for fuzzy ideas (`agents/AGENTS.md`). `/proto-new` drives exactly this step list; `/proto-check` drives Step 7.
1. **Pick the template** — web app/UI → `web`; service/API → `api`; terminal tool → `cli`; background jobs → `worker`; reusable module → `library`; default `web`. `i2p list` shows all. Templates are single-purpose: background jobs inside web/api come from `add worker-jobs`, never a second scaffold.
2. **Scaffold** from the parent dir — `new` refuses non-empty dirs and never overwrites (e.g. `i2p new recipe-box --template web --name "Recipe Box" --idea "a recipe box with search"`). `[brackets]` below mean optional. Defaults: `--template web`; `--name` ← the directory name; `--idea` ← the placeholder "(describe the idea in one sentence)" (engine script; verified live). Only `--resource` (api-crud) is ever required. A web scaffold is 10 files (README.md, SKILL.md), incl. `PROTOTYPE.md` (idea line + empty Goal / Core flows / Modules / Out-of-scope skeleton) and `.idea2prototype.json`.
3. **Spec first** — fill `PROTOTYPE.md`: Goal (≤3 bullets), 1–3 core flows (these become the done-checklist), out-of-scope; no coding before it exists.
4. **First check** — `npm run check` inside the project, or `i2p check <dir>` from any cwd (`check` takes one optional `[dir]`, default `.`). A clean scaffold must PASS (the repo's suite enforces it; green on the current engine).
5. **Implement each core flow** in small edits; loop = edit → `npm run check` → fix. Read only the verdict (header + one line per step), never raw logs. Context first: `i2p map` (paths+LOC+exports). Ownership: `server.mjs`/`package.json` are tool-owned — never recreate; `routes/`+`tests/` are generated once, then yours; `.idea2prototype.json` is the project marker — `new` writes template+version+createdAt, every `add` appends a feature record, `check`/`add` refuse to run without it — if you mangle it, restore valid JSON (else: `.idea2prototype.json is not a valid JSON object`) (engine script).
6. **Add, don't hand-write.** `add` has **no `[dir]`** — run it inside the project (it resolves files against the cwd, engine script; outside one it dies `not a idea2prototype project (no .idea2prototype.json …)`). Each feature generates route(s) **plus tests** and prints `verify: npm run check` — re-check after every add (live: tests went 3 → 6).

   | Feature (all web/api only) | Generates | Use it after install |
   |---|---|---|
   | `add api-crud --resource <n>` | route + CRUD tests | name: lowercase letters, digits, dashes (starts with letter); `--resource` required |
   | `add auth-local` | routes/auth.mjs + session tests | `import { requireAuth } from './auth.mjs'` → anon gets 401, handler gets `ctx.user`; stateless HMAC tokens — logout clears the cookie only, a copied token works until expiry; shorten TTL / add revocation for anything production-ish (SKILL.md) |
   | `add upload` | routes/uploads.mjs (POST/GET /api/uploads) + tests | files land in `uploads/`, 5 MB cap |
   | `add rate-limit` | routes/ratelimit.mjs + tests | `rateLimit({ max, windowMs, keyFn })` — thresholds are yours; 429 + Retry-After + X-RateLimit-* |
   | `add cors` | routes/cors.mjs + tests | `cors({ origin, methods, credentials })`; allowlist origins |
   | `add sse` | routes/sse.mjs (GET /api/events) + tests | write chunks to `ctx.res`, return nothing; heartbeats managed for you |
   | `add worker-jobs` | jobs.mjs + routes/jobs.mjs + tests | `import { registerHandler } from './jobs.mjs'` in server code; data/jobs.json, 3 attempts |
   | `add validation` | validation.mjs + tests | `import { validate, validated } from '../validation.mjs'` from `routes/*.mjs` (`'./validation.mjs'` from root modules); flat schemas, unknown-key rejection |

   Wrappers compose by nesting (`POST: requireAuth(rateLimit({…})(handler))`); the demo routes (`/api/ping`, `/api/cors-ping`, `/api/events`, `/api/jobs`) are yours to delete once real ones exist. On cli/worker/library scaffolds `add` refuses: `auth-local applies to web/api templates (this project: cli)` (live; engine script).
7. **If FAIL** — fix only what the ≤3 notes name, re-run, max 5 iterations; still failing → report notes + root cause + smallest fix. Never read raw logs. `/proto-check` runs exactly this loop (`commands/proto-check.md`).
8. **Run it** — web/api: `npm start` → http://127.0.0.1:3000 (live: `/api/health` → `{"status":"ok",…}`). A busy 3000 falls forward to 3001, 3002… and prints the true URL; an explicit busy `PORT` exits cleanly: `Port N is already in use. Run with PORT=<number> npm start, or free port N.` (server.mjs). cli: `node cli.mjs help`; worker: `npm start` (runs `node worker.mjs`); library: `import { createStore, memoAsync } from './index.mjs'`. JSON stores are single-writer — one server process per project dir.
9. **Done = check PASS + every spec core flow implemented** — report the three verdict lines and the flow checklist, then stop.

## A worked session (captured live for this guide — `$` prompts, `#` comments, and `exit_code=1` are annotations, not engine output)

```text
$ i2p new recipe-box --template web --name "Recipe Box" --idea "a recipe box with search"
prototype ready: recipe-box (web template, zero dependencies)
  spec:   recipe-box\PROTOTYPE.md  <- fill Goal + Core flows before coding
  run:    cd recipe-box && npm start
  verify: cd recipe-box && npm run check
$ npm run check   # inside recipe-box
Idea2Prototype check — PASS (3/3 passed)  [D:\...\recipe-box]
  syntax  PASS  3 files parse clean (2 server + 1 frontend)
  tests   PASS  3 tests passed (1 file)
  boot    PASS  GET /api/health -> 200, GET / -> 200 in 42ms
$ i2p add api-crud --resource recipes
added api-crud resource "recipes"
  routes/recipes.mjs   GET/POST /api/recipes + GET/PUT/DELETE /api/recipes/:id
  tests/recipes.test.mjs  CRUD roundtrip + validation
  compose with auth-local: wrap handlers in requireAuth — and give the tests a session (SKILL.md "Composing features")
  verify: npm run check
$ npm run check
Idea2Prototype check — PASS (3/3 passed)  [D:\...\recipe-box]
  syntax  PASS  5 files parse clean (4 server + 1 frontend)
  tests   PASS  6 tests passed (2 files)
  boot    PASS  GET /api/health -> 200, GET / -> 200 in 46ms
$ i2p add api-crud --resource users
idea2prototype: resource name "users" is reserved — auth-local stores accounts in data/users.json; pick another name
$ node server.mjs   # background, then probe
GET /api/health -> 200  body: {"status":"ok","uptime":1977}
GET /         -> 200
Idea2Prototype app running at http://127.0.0.1:3000
$ echo 'const x = {' >> routes/recipes.mjs && npm run check
Idea2Prototype check — FAIL (0/3 passed)  [D:\...\recipe-box]
  syntax  FAIL  1/5 files invalid
      D:\...\routes\recipes.mjs:136
  tests   SKIP  skipped (syntax failed)
  boot    SKIP  skipped (syntax failed)
exit_code=1
```

Full reserved-resource list (engine script): `users, auth, jobs, uploads, events, sse, ping, ratelimit, cors, cors-ping, health`.

## Command reference

Engine output, run in this repo (`… idea2prototype.mjs list` + no-args help), annotated:

```text
templates: api, cli, library, web, worker
features:  api-crud (web/api), auth-local (web/api), upload (web/api), rate-limit (web/api), cors (web/api), sse (web/api), worker-jobs (web/api), validation (web/api)
new <dir> [--template …] [--name] [--idea]   scaffold; refuses non-empty dirs
add <feature> [options]                      no [dir] — run inside the project; only api-crud takes an option (--resource)
check [dir] [--json]                         syntax+tests+boot; requires .idea2prototype.json (a scaffolded project)
verify [dir] [--json]                        same verdict on ANY Node project (judge mode): no marker, boot ok = HTTP 200–399, an empty dir FAILs
map [dir] [--json]                           compact repo map: paths + LOC + exports
list [--json] / version                      what's available / engine version (`--json` emits `{ok, version, templates, features}`)
```

`check --json` shape (verified): `{"tool","version","scaffoldVersion","project","status","steps":[{"name","status","detail"}…]}`. A trailing `note  scaffolded by v..., engine v... — generated files may differ` is informational, never a failure.

## Troubleshooting

- **Non-empty target dir** → scaffold elsewhere or empty it yourself; the tool never deletes (live).
- **Port already in use** → `npm start` auto-hunts upward; with an explicit `PORT`, pick another (error text above).
- **Two processes, one project dir** → last writer clobbers the whole store file; run one server per dir.
- **`data/<name>.json.corrupt-<ts>` appeared** → a store failed to parse on read; the original bytes are preserved in that file and the process started empty with a stderr note. Recovery is manual (inspect, fix, rename back) — the tool never auto-wipes.
- **`command not found: i2p`** → not globally installed; use your row in the install→invocation table.
- **Node too old** → engine needs >= 18.17 (package.json engines); the `skills` CLI additionally >= 22.20.

## Pins, upgrades, OS, network

A scaffold's `npm run check` deliberately pins the engine that built it: checkout/plugin scaffolds pin the absolute engine path (`node "…idea2prototype.mjs" check`), published-install scaffolds pin `npx -y @ahmed-3m/idea2prototype@<version> check` (first run fetches; a cleared cache or new machine re-fetches the same version — README.md). Older scaffolds keep their built behavior; run a newer engine by hand and it only adds the drift note. Update the global CLI with `npm i -g @ahmed-3m/idea2prototype@latest`; plugin update/uninstall is your host's plugin management — no command for it is documented in this repo. OS: Windows/macOS/Linux — CI runs ubuntu+windows × Node 18/22/24 (README.md), and the engine suite and worked session ran green on Windows at capture time (the engine itself rejects Windows reserved device names and >200-char dir names on every OS, engine script).

---

Sources — read: README.md; skills/idea2prototype/SKILL.md; commands/proto-new.md, commands/proto-check.md; agents/AGENTS.md; the engine `skills/idea2prototype/scripts/idea2prototype.mjs`; web/worker/api templates + all seven feature templates; the three plugin manifests; root plugin.json; package.json. Verified by running: `node --test tests/engine.test.mjs tests/consistency.test.mjs` (all passing on the current engine); the worked session in a temp dir (scaffold → check PASS → add → reserved-name refusal → check PASS → server + health probe → induced FAIL verdict), temp scaffolds deleted afterward. Not run: the Claude/Cline/`skills`-CLI installs, `verify` against a foreign project, the npm publish path.
