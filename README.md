# Idea2Prototype (`i2p`)

<p align="center">
  <a href="https://github.com/ahmed-3m/idea2prototype/actions/workflows/ci.yml"><img src="https://github.com/ahmed-3m/idea2prototype/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@ahmed-3m/idea2prototype"><img src="https://img.shields.io/npm/v/@ahmed-3m/idea2prototype" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://nodejs.org/en/about/previous-releases"><img src="https://img.shields.io/badge/node-%3E%3D18.17-green.svg" alt="Node 18.17 or later"></a>
</p>

**Status:** v1.0.2 · actively maintained · 1.x — the check/verify contract and template shapes are stable; new capabilities arrive as `add` modules.

Your coding agent spends the turn writing a server and a test harness, then reads the log to see if it boots. Idea2Prototype is one Node file, with zero dependencies, on Node >= 18.17. It scaffolds that harness and prints syntax, tests, and boot in four lines.

```text
Idea2Prototype check — PASS (3/3 passed)  [my-app]
  syntax  PASS  3 files parse clean (2 server + 1 frontend)
  tests   PASS  3 tests passed (1 file)
  boot    PASS  GET /api/health -> 200, GET / -> 200 in 72ms
```

The tool prints the real project directory; this sample abbreviates it to `my-app`, and the millisecond figure is from this run, not a limit.

```bash
npx @ahmed-3m/idea2prototype new my-app --template web --name "My App" --idea "recipe box"
cd my-app
npm run check
```

```bash
npm start
```

The process stays in the foreground, and the template prints the URL it bound.

A complete walkthrough — every install path and the first-prototype flow — lives in [docs/how-to-use.md](docs/how-to-use.md).

## Why

The alternative is letting the agent write the scaffold.

| | Agent writes it | `i2p new` |
|---|---|---|
| What is on disk first | an empty directory | a fresh `web` scaffold, 10 files, and `i2p map` prints 4 lines |
| What the agent reads back | the server log | four lines, 211 characters |
| What gets proved | whatever the agent remembered to run | syntax (`node --check` on server code, and every `public/**/*.js` parsed as both ESM and a classic script), the scaffold's own `node:test` suite, and a live HTTP probe of `GET /api/health` and `GET /` |

## Add a module

`i2p add <feature>` drops one module and its tests into the project.

| Feature | Mechanism |
|---|---|
| `api-crud` | JSON-file CRUD and roundtrip tests. No validation layer. |
| `auth-local` | `node:crypto` scrypt passwords, HMAC-signed cookies, and `requireAuth`. |
| `upload` | a small hand-rolled multipart parser, a fetch-back endpoint, and tests. |
| `rate-limit` | per-key fixed window: 429, `Retry-After`, and `X-RateLimit-*`. |
| `cors` | preflight, `access-control-*` headers, and an origin allowlist. |
| `sse` | `GET /api/events` as `text/event-stream`, with heartbeats. |
| `worker-jobs` | `data/jobs.json`, 3 attempts, then status `failed`. |

<details>
<summary>Prototype limits</summary>

- JSON stores are a single-writer in-memory list. Two servers on the same directory clobber each other. A file that fails to parse is quarantined as `data/<name>.json.corrupt-<timestamp>` and is not silently wiped.
- Logout clears the cookie only. A copied auth token stays valid until it expires.
- Templates do not compose with each other. Features compose inside one template. `add worker-jobs` is how a web or api app gets the persistent queue.
- `npm run check` inside a scaffold calls the engine version that created it. A newer engine, run by hand, prints a drift note.

</details>

Connecting two features is a small edit to generated files the tool now considers yours; the worked example is in [`skills/idea2prototype/SKILL.md`](skills/idea2prototype/SKILL.md).

## For an agent

Plugin manifests live in [`.claude-plugin/`](.claude-plugin/) and [`.cursor-plugin/`](.cursor-plugin/); the skill is at [`skills/idea2prototype/SKILL.md`](skills/idea2prototype/SKILL.md).

| Agent | Install |
|---|---|
| Claude Code | `claude plugin marketplace add ahmed-3m/idea2prototype` → `claude plugin install idea2prototype@ahmed-3m` |
| Any agent (Agent Skills standard) | `npx skills add ahmed-3m/idea2prototype` (the `skills` CLI needs Node 22.20 or later) |
| Cursor | via the Cursor marketplace (listing via marketplace PR) or the universal skills command above |
| Cline | `cline skill install ahmed-3m/idea2prototype` (or via marketplace PR) |
| ZCode | add this repo's marketplace and install `idea2prototype`, then pick the skill in the composer or use `/proto-new a recipe box with search` |

One prompt to hand your agent:

```text
Add a recipes resource with `npx @ahmed-3m/idea2prototype add api-crud --resource recipes`, then run `npm run check`. Keep the verdict green.
```

**Make any agent use it:** copy [`agents/AGENTS.md`](agents/AGENTS.md) (or `agents/CLAUDE.md`) into your project — it teaches the agent the commands and the check-first workflow.

## Benchmarks

Every spec is a paired run: the same agent builds the same prototype with and without the harness. Hypotheses are registered ahead of time, and failures are kept. Tokens were not measured. The full record is [`benchmarks/specs.md`](https://github.com/ahmed-3m/idea2prototype/blob/main/benchmarks/specs.md).

| Spec | Result |
|---|---|
| 7, bookmarks API | Treatment wrote about 86 lines by hand against about 240, with 6 tests against 2, and a full boot (3/3) against a boot-skip (2/3). The control was faster, about 37s against about 46s. Both judged 5/5. |
| 5, quiz web app | Treatment was faster, about 4m08s against about 7m28s, because the control's hand-rolled tests needed two fix cycles. The line-count gap was small, about 165 against about 184. |
| 3, micro-CLI | The harness lost. About 47s against about 16s, and more hand-written code (149 against 129). Both arms skipped boot. Both judged 5/5. |
| 6, pomodoro | The judge scored the harness lower, 4/5 against 5/5. Line count was parity, 241 against 236. The control was faster, about 1m49s against about 4m44s. |

A boot-skip still PASSes; it is not a failed control. Several other small builds were also faster without the harness — the repeated difference is hand-written lines and the scaffold's tests.

## Commands

| Command | What it does |
|---|---|
| `i2p new <dir> --template web\|api\|cli\|worker\|library` | scaffold a running, tested project (zero dependencies) |
| `i2p add <feature>` | drop in a feature module with tests: `api-crud`, `auth-local`, `upload`, `rate-limit`, `cors`, `sse`, `worker-jobs` |
| `i2p check [dir] [--json]` | syntax + tests + boot, the verdict above (also `npm run check` inside projects) |
| `i2p verify [dir] [--json]` | the same verdict on any Node project — judge mode |
| `i2p map [dir] [--json]` | repo map: paths + LOC + exports |

`i2p list` prints the templates and features; `i2p version` prints the engine version.

The syntax step runs `node --check` on server code and parses every `public/**/*.js` as both ESM and a classic script — only code broken in both modes fails.

## Design rules

1. **Deterministic outside the model, instructions inside.** Anything a template can own, the template owns.
2. **Zero dependencies, forever.** No install step between "scaffolded" and "verified".
3. **Verdicts, not logs.** Failure output is capped at 3 notes so context stays clean.
4. **No destructive operations.** `new` refuses non-empty directories.
5. **Portable core.** One `.mjs` engine; plugin/skill/npm wrappers are sugar.

## Contributing

New templates and features are exactly two template files + one registry entry — see [CONTRIBUTING.md](CONTRIBUTING.md). The engine suite (`node --test tests/engine.test.mjs tests/consistency.test.mjs`) runs on ubuntu/windows across Node 18/22/24 in CI and must stay green. `AGENTS.md` documents the architecture for humans and coding agents alike.

If the idea is still fuzzy, [brainstorm2idea](https://github.com/ahmed-3m/brainstorm2idea) is an optional stage before this one — a Socratic dialogue that turns raw thought into a brief you can scaffold from.

## License

MIT — see [LICENSE](LICENSE).
