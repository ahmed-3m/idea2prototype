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
- `check` — syntax + tests + boot, compact verdict; also wired as `npm run check` inside projects
- `verify [dir]` — same verdict on ANY Node project (judge mode)
- `map [dir]` — compact repo map (paths + LOC + exports); run it before opening files
- `list` — show available templates/features

## Workflow (follow in order)

1. **Spec first.** Run `new`, then fill the generated `PROTOTYPE.md`: Goal (max 3 bullets), 1–3 core flows, out-of-scope list. Do not start coding before the spec exists.
2. **Never hand-write scaffold files.** `server.mjs`, `tests/`, `package.json`, `.idea2prototype.json` belong to the tool. Edit business logic, not plumbing. A `web` project gets: static frontend + health endpoint + tests; `api`: JSON API + index manifest + tests; `cli`: arg-parsed command + tests; `worker`: persistent job queue + tests; `library`: importable module (`index.mjs`) + tests.
3. **Add capabilities with `add`, not from scratch.** Persistence → `add api-crud --resource todos`; accounts → `add auth-local` (then guard routes with `requireAuth`); files → `add upload`; abuse protection → `add rate-limit` (then wrap hot handlers with `rateLimit()`). The server auto-loads `routes/*.mjs`; handlers return `[status, payload]`.
4. **Tight loop: edit → `check` → fix.** Run `npm run check` (or the script's `check`) after every meaningful change. Read the verdict only — never run tests directly and never read raw logs. Need context? `map` first, then open only the files you're changing.
5. **Done = check PASS + spec flows implemented.** Report the verdict lines and the spec checklist, then stop.

## Token discipline (why this exists)

- Scaffolding ~15 files by hand costs ~10–30k output tokens; `new` costs ~0.
- Raw build/test logs run 5–20k tokens per iteration; the verdict is ~60.
- Rules that keep savings real: never cat log files, never regenerate files the tool owns, keep edits diff-sized, read only the files you're changing.

## Notes

- Tests use the built-in `node:test`; no installs, no dependencies ever added by the tool.
- `check` exits non-zero on failure, prints at most 3 failure notes — fix those, re-run. A trailing `note` line about scaffold/engine version drift is informational, not a failure. `check --json` gives the same verdict machine-readable. `verify [dir]` runs the same verdict on any Node project (benchmark/judge mode).
- If the user asks for dependencies (a framework, a database), ask once, then add via `npm install` and extend the tests accordingly.
- Projects are plain Node — `npm start` (web/api), `node cli.mjs help` (cli), `import ... from './index.mjs'` (library); no other tooling assumed.
