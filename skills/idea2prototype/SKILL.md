---
name: idea2prototype
description: Build working prototypes from ideas with minimal tokens — zero-dependency scaffolds, CRUD features, and a compact verified check (syntax + tests + boot). Use when creating an MVP, demo, web app, API, CLI, or library prototype from an idea, or whenever asked to scaffold/start a new small project or verify one iteratively.
---

# Idea2Prototype — token-lean prototype workflow

Idea2Prototype turns an idea into a running, tested prototype while spending as few tokens as possible. The scaffolds and CRUD modules are generated deterministically by a script (zero LLM output), and `check` replaces raw logs with a ~10-line verdict.

## The tool

Everything runs through one zero-dependency Node script (Node >= 18.17) bundled in this skill:

```
node "<skill-base>/scripts/idea2prototype.mjs" <command>
```

`<skill-base>` is this skill's own directory (shown at the top of this skill when loaded). Commands:

- `new <dir> --template web|api|cli|worker|library --name "..." --idea "..."` — scaffold a project
- `add api-crud --resource <name>` — add a JSON-file CRUD resource + tests (web/api)
- `add auth-local` — register/login/logout/me accounts: scrypt hashes, HMAC-signed cookies, `requireAuth` helper (web/api)
- `add upload` — multipart file uploads with fetch-back endpoint + tests (web/api)
- `add rate-limit` — per-key fixed-window limiter: `rateLimit({ max, windowMs, keyFn })` wraps any handler, 429 + Retry-After + X-RateLimit-* headers, `GET /api/ping` demo (web/api)
- `add cors` — Cross-Origin Resource Sharing: `cors({ origin, methods, credentials })` wraps any handler, answers OPTIONS preflights, stamps access-control-* headers, `GET /api/cors-ping` demo (web/api)
- `add sse` — Server-Sent Events: `GET /api/events` stream (`text/event-stream`) — write chunks to `ctx.res` directly and return nothing; the server keeps the stream open and cleans up heartbeats on disconnect (web/api)
- `check` — syntax + tests + boot, compact verdict; also wired as `npm run check` inside projects. Syntax covers server files (`node --check`) and `public/*.js` (dual ESM/classic parse — broken-in-both fails)
- `verify [dir]` — same verdict on ANY Node project (judge mode)
- `map [dir]` — compact repo map (paths + LOC + exports); run it before opening files
- `list` — show available templates/features

## Workflow (follow in order)

1. **Spec first.** Run `new`, then fill the generated `PROTOTYPE.md`: Goal (max 3 bullets), 1–3 core flows, out-of-scope list. Do not start coding before the spec exists.
2. **Never hand-write what `add` can generate; hand-edits are yours to keep.** `server.mjs`, `package.json`, `.idea2prototype.json` belong to the tool — never recreate them. Files under `routes/` and `tests/` are generated once, then yours: edit them in place (the tool never overwrites them). Edit business logic, not plumbing. A `web` project gets: static frontend + health endpoint + tests; `api`: JSON API + index manifest + tests; `cli`: arg-parsed command + tests; `worker`: persistent job queue + tests; `library`: importable module (`index.mjs`) + tests.
3. **Add capabilities with `add`, not from scratch.** Persistence → `add api-crud --resource todos`; accounts → `add auth-local` (then guard routes with `requireAuth`); files → `add upload`; abuse protection → `add rate-limit` (then wrap hot handlers with `rateLimit()`); live updates → `add sse`. The server auto-loads `routes/*.mjs`; handlers return `[status, payload]` — or write chunks to `ctx.res` directly and return nothing to stream (the `sse` demo shows the pattern).
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
  const item = { id: randomUUID(), createdAt: new Date().toISOString(), ...body, author: user.username };
  (await load()).push(item);
  await persist();
  return [201, item];
}),
```

`requireAuth` rejects anonymous requests with 401 and provides `ctx.user` (`{ username }`) to the wrapped handler. `rateLimit(...)` from `add rate-limit` and `cors(...)` from `add cors` wrap handlers the same way — compose them by nesting.

3. Fix the generated test: BOTH of its POSTs (`posts CRUD roundtrip` and `posts rejects non-object bodies`) go out anonymously and now get 401. Bootstrap a session once and pass the cookie on every protected call. Note the helper takes the SERVER ROOT — the test's existing `base` variable points at `/api/posts`, so build a separate origin string (register/login live at `/api/auth/*`):

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

## Token discipline (why this exists)

- Scaffolding ~15 files by hand costs ~10–30k output tokens; `new` costs ~0.
- Raw build/test logs run 5–20k tokens per iteration; the verdict is ~60.
- Rules that keep savings real: never cat log files, never regenerate files the tool owns, keep edits diff-sized, read only the files you're changing.

## Notes

- Tests use the built-in `node:test`; no installs, no dependencies ever added by the tool.
- `check` exits non-zero on failure, prints at most 3 failure notes — fix those, re-run. A trailing `note` line about scaffold/engine version drift is informational, not a failure. `check --json` gives the same verdict machine-readable. `verify [dir]` runs the same verdict on any Node project (benchmark/judge mode).
- If the user asks for dependencies (a framework, a database), ask once, then add via `npm install` and extend the tests accordingly.
- Projects are plain Node — `npm start` (web/api), `node cli.mjs help` (cli), `import ... from './index.mjs'` (library); no other tooling assumed.
- Templates are single-purpose: no cross-template composition exists (a `web` scaffold cannot absorb the `worker` job queue, and vice versa). If a task needs both shapes, scaffold the primary one and hand-build the smaller part (e.g. a `worker/` module inside a web project) — `check` still covers it as server code. Feature composition (`auth-local` × `api-crud`, `rate-limit`, `cors` wrapping handlers) is supported; template composition is not.
