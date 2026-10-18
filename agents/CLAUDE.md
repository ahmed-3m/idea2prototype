# AGENTS.md — use idea2prototype in this project

Copy this file into any project where your coding agent should build with idea2prototype. Works with any agent that reads AGENTS.md conventions.

You have `idea2prototype` (`i2p`) available — a zero-dependency prototype tool. Use it instead of hand-writing scaffolding.

## Commands

- `npx idea2prototype new <dir> --template web|api|cli` — scaffold a running, tested project (~0 tokens vs 10–30k hand-written)
- `npx idea2prototype add api-crud --resource <name>` — JSON-file CRUD resource + roundtrip tests
- `npx idea2prototype add auth-local` — register/login/logout/me (scrypt + signed cookies) + tests; `requireAuth` protects other routes
- `npx idea2prototype add upload` — multipart file uploads + fetch-back + tests
- `npm run check` (inside a project) — syntax + tests + boot, ~10-line verdict
- `npx idea2prototype map` — paths + LOC + exports; read this before opening files

## Workflow

1. Scaffold with `new`, then fill `PROTOTYPE.md` (Goal ≤ 3 bullets, 1–3 core flows, out-of-scope).
2. Never hand-write files the tool owns (`server.mjs`, scaffold `tests/`, `package.json`). Add capabilities with `add`, not from scratch.
3. After every meaningful change: `npm run check`. Read the verdict only — never run tests directly, never read raw logs.
4. Need context? `i2p map` first; open only the files you're changing.
5. Done = check PASS + spec flows work. Report the verdict lines.
