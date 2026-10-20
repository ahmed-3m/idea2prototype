# AGENTS.md — use idea2prototype in this project

Copy this file into any project where your coding agent should build with idea2prototype. Works with any agent that reads AGENTS.md conventions.

You have `idea2prototype` (`i2p`) available — a zero-dependency prototype tool. Use it instead of hand-writing scaffolding. If the npm package isn't installed or available, run the engine directly instead of `npx @ahmed-3m/idea2prototype`: `node <path-to-idea2prototype-repo>/skills/idea2prototype/scripts/idea2prototype.mjs <command>`.

If starting from a fuzzy or unformed idea, run `npx @ahmed-3m/brainstorm2idea` (or load the `brainstorm2idea` skill) first to generate a verified `brief.md` that hands off directly into `idea2prototype new`.

## Commands

- `npx @ahmed-3m/idea2prototype new <dir> --template web|api|cli|worker|library` — scaffold a running, tested project (~0 tokens vs 10–30k hand-written)
- `npx @ahmed-3m/idea2prototype add api-crud --resource <name>` — JSON-file CRUD resource + roundtrip tests
- `npx @ahmed-3m/idea2prototype add auth-local` — register/login/logout/me (scrypt + signed cookies) + tests; `requireAuth` protects other routes
- `npx @ahmed-3m/idea2prototype add upload` — multipart file uploads + fetch-back + tests
- `npx @ahmed-3m/idea2prototype add rate-limit` — per-key fixed-window limiter (429 + Retry-After headers); `rateLimit()` wraps any handler
- `npx @ahmed-3m/idea2prototype add cors` — CORS wrapper (preflight + access-control-* headers, origin allowlists); `cors()` wraps any handler
- `npx @ahmed-3m/idea2prototype add sse` — Server-Sent Events stream (`GET /api/events`) + heartbeats
- `npx @ahmed-3m/idea2prototype add worker-jobs` — persistent background job queue (`data/jobs.json`, 3 attempts) with demo routes
- `npm run check` (inside a project) — syntax + tests + boot, ~10-line verdict
- `npx @ahmed-3m/idea2prototype map` — paths + LOC + exports; read this before opening files

## Workflow

1. Scaffold with `new`, then fill `PROTOTYPE.md` (Goal ≤ 3 bullets, 1–3 core flows, out-of-scope).
2. Never hand-write files the tool owns (`server.mjs`, scaffold `tests/`, `package.json`). Add capabilities with `add`, not from scratch.
3. After every meaningful change: `npm run check`. Read the verdict only — never run tests directly, never read raw logs.
4. Need context? `npx @ahmed-3m/idea2prototype map` first; open only the files you're changing.
5. Done = check PASS + spec flows work. Report the verdict lines.
