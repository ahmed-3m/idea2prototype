---
name: idea2prototype
description: Build working prototypes from ideas — zero-dependency scaffolds, CRUD features, and a four-line check (syntax + tests + boot). Use when creating an MVP, demo, web app, API, CLI, or library prototype from an idea, or whenever asked to scaffold/start a new small project or verify one iteratively.
---

# Idea2Prototype — scaffold, then a four-line check

Idea2Prototype turns an idea into a running, tested prototype. The scaffolds and CRUD modules are generated deterministically by a script (zero LLM output), and `check` replaces raw logs with a four-line verdict.

## The tool

Everything runs through one zero-dependency Node script (Node >= 18.17) bundled in this skill:

```
node "<skill-base>/scripts/idea2prototype.mjs" <command>
```

`<skill-base>` is this skill's own directory (shown at the top of this skill when loaded in ZCode).

If `<skill-base>` is not substituted or the skill was installed via the Agent Skills standard (`npx skills add`), run via `npx` or the global CLI instead:

```
npx @ahmed-3m/idea2prototype <command>
# or `i2p <command>` if globally installed
```

Commands:

- `new <dir> --template web|api|cli|worker|library --name "..." --idea "..."` — scaffold a project
- `add api-crud --resource <name>` — add a JSON-file CRUD resource + tests (web/api). Names another feature owns are refused (`users`, `auth`, `jobs`, `uploads`, `events`, `ping`, …) — e.g. use `members`, not `users`, next to `auth-local`
- `add auth-local` — register/login/logout/me accounts: scrypt hashes, HMAC-signed cookies, `requireAuth` helper (web/api)
- `add upload` — multipart file uploads with fetch-back endpoint + tests (web/api)
- `add rate-limit` — per-key fixed-window limiter: `rateLimit({ max, windowMs, keyFn })` wraps any handler, 429 + Retry-After + X-RateLimit-* headers, `GET /api/ping` demo (web/api)
- `add cors` — Cross-Origin Resource Sharing: `cors({ origin, methods, credentials })` wraps any handler, answers OPTIONS preflights, stamps access-control-* headers, `GET /api/cors-ping` demo (web/api)
- `add sse` — Server-Sent Events: `GET /api/events` stream (`text/event-stream`) — write chunks to `ctx.res` directly and return nothing; the server keeps the stream open and cleans up heartbeats on disconnect (web/api)
- `add worker-jobs` — persistent background job queue inside web/api: `enqueue`/`list`/`registerHandler`, `data/jobs.json` persistence, 3 attempts with terminal `failed` state, demo `POST/GET /api/jobs` routes + tests (web/api)
- `check [dir] [--json]` — syntax + tests + boot, compact verdict; also wired as `npm run check` inside projects, or pass `<dir>` to check a project from outside it (no cd needed). Syntax covers server files (`node --check`) and every `.js` under `public/`, recursively (dual ESM/classic parse — broken-in-both fails)
- `verify [dir] [--json]` — same verdict on ANY Node project (judge mode)
- `map [dir] [--json]` — compact repo map (paths + LOC + exports); run it before opening files
- `list` — show available templates/features

## Workflow (follow in order)

0. **Socratic alignment (grill-me).** Before scaffolding, if the template choice or scope is ambiguous, ask the user 2–3 sharp questions — (1) template: `web`/`api`/`cli`/`worker`/`library`, (2) the 1–3 must-have core flows, (3) what is explicitly out of scope to keep the build small — then write the answers straight into the generated `PROTOTYPE.md` and proceed without further delay. An unambiguous request skips the questions and goes straight to `new`.
1. **Spec first.** Run `new`, then fill the generated `PROTOTYPE.md`: Goal (max 3 bullets), 1–3 core flows, out-of-scope list. Do not start coding before the spec exists.
2. **Never hand-write what `add` can generate; hand-edits are yours to keep.** `server.mjs`, `package.json`, `.idea2prototype.json` belong to the tool — never recreate them. Files under `routes/` and `tests/` are generated once, then yours: edit them in place (the tool never overwrites them). Edit business logic, not plumbing. A `web` project gets: static frontend + health endpoint + tests; `api`: JSON API + index manifest + tests; `cli`: arg-parsed command + tests; `worker`: persistent job queue + tests; `library`: importable module (`index.mjs`) + tests.
3. **Add capabilities with `add`, not from scratch.** Persistence → `add api-crud --resource todos`; accounts → `add auth-local` (then guard routes with `requireAuth`); files → `add upload`; abuse protection → `add rate-limit` (then wrap hot handlers with `rateLimit()`); live updates → `add sse`; background jobs → `add worker-jobs` (own handlers via `registerHandler`). The server auto-loads `routes/*.mjs`; handlers return `[status, payload]` — or write chunks to `ctx.res` directly and return nothing to stream (the `sse` demo shows the pattern).
4. **Tight loop: edit → `check` → fix.** Run `npm run check` (or the script's `check`) after every meaningful change. Read the verdict only — never run tests directly and never read raw logs. Need context? `map` first, then open only the files you're changing.
5. **Done = check PASS + spec flows implemented.** Report the verdict lines and the spec checklist, then stop.

## Composing features (worked example: auth × CRUD)

Features compose by wrapping handlers — `add` generates each feature standalone, then you connect them with small edits to files you now own. Protecting `POST /api/posts` so only logged-in users may create, with the author stamped on the item:

1. `add auth-local` and `add api-crud --resource posts`.
2. In `routes/posts.mjs`, import the wrapper and wrap the POST handler (this is the whole route change):

```js
import { requireAuth } from './auth.mjs';

// inside the '/api/posts' route object's methods:
POST: requireAuth(async ({ body, user }) => {
  const bad = requireObject(body);
  if (bad) return bad;
  const item = { ...body, id: randomUUID(), createdAt: new Date().toISOString(), author: user.username };
  (await load()).push(item);
  await persist();
  return [201, item];
}),
```

`requireAuth` rejects anonymous requests with 401 and provides `ctx.user` (`{ username }`) to the wrapped handler. `rateLimit(...)` from `add rate-limit` and `cors(...)` from `add cors` wrap handlers the same way — compose them by nesting.

3. Fix the generated test: all four of its POSTs go out anonymously and now get 401 — the POST in `posts CRUD roundtrip`, both POSTs in `posts ignores client-sent id and createdAt`, and the POST in `posts rejects non-object bodies`. Bootstrap a session once and pass the cookie on every protected call. Note the helper takes the SERVER ROOT — the test's existing `base` variable points at `/api/posts`, so build a separate origin string (register/login live at `/api/auth/*`):

```js
const JSON_HEADERS = { 'content-type': 'application/json' };
async function session(root) {
  const username = `author_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  await fetch(`${root}/api/auth/register`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ username, password: 'correct horse battery' }) });
  const login = await fetch(`${root}/api/auth/login`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ username, password: 'correct horse battery' }) });
  return { cookie: login.headers.get('set-cookie').split(';')[0], username };
}

// inside a test (root = `http://127.0.0.1:${app.port}` — NOT the /api/posts base):
// const { cookie, username } = await session(root);
// const res = await fetch(base, { method: 'POST', headers: { ...JSON_HEADERS, cookie }, body: ... });
// anonymous POSTs still assert 401; authed POSTs assert 201 and item.author === username
```

Then `check` — the anon-401/authed-201 contract and the rest of the CRUD suite must all pass.

## Why the verdict stays short

- A fresh `web` scaffold is 10 files. `new` writes them without an LLM. Token totals for a from-scratch alternative were not measured.
- `check` prints four lines: syntax, tests, and boot. Read that verdict. Do not read the raw log.
- Never regenerate files the tool owns, keep edits diff-sized, and read only the files you are changing. `map` lists them.

## Notes

- Tests use the built-in `node:test`; no installs, no dependencies ever added by the tool.
- `check` exits non-zero on failure, prints at most 3 failure notes — fix those, re-run. A trailing `note` line about scaffold/engine version drift is informational, not a failure. `check --json` gives the same verdict machine-readable. `check <dir>` accepts a project directory so it works from any cwd. `verify [dir]` runs the same verdict on any Node project (benchmark/judge mode).
- If the user asks for dependencies (a framework, a database), ask once, then add via `npm install` and extend the tests accordingly.
- Projects are plain Node — `npm start` (web/api), `node cli.mjs help` (cli), `import ... from './index.mjs'` (library); no other tooling assumed.
- JSON stores (`data/*.json`) are single-writer: one server process per project dir — a second server's persist clobbers the first's acknowledged writes. A store that fails to parse on first read is quarantined (`data/<name>.json.corrupt-<ts>`, original bytes preserved) and the process starts empty with a loud stderr note — never a silent wipe.
- `auth-local` session tokens are stateless HMAC: logout clears the browser cookie only, and a token copied before logout stays valid until it expires — production-ish apps should shorten the TTL or add a server-side revocation list (the route's docblock says the same).
- Templates are single-purpose: no cross-template composition exists. If a task needs background jobs inside a web/api project, `add worker-jobs` brings the worker template's queue in as a feature — no need to scaffold both. Feature composition (`auth-local` × `api-crud`, `rate-limit`, `cors`, `sse` streaming, `worker-jobs`) is supported; template composition is not.
