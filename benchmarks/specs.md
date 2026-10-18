# Idea2Prototype benchmark — 10 fixed prototype specs

Measure what Idea2Prototype actually saves. Same agent, same model, same machine; two arms:

- **Control**: agent builds the spec from scratch with no harness.
- **Idea2Prototype**: agent has the skill + commands (this repo).

## Specs

Each spec must end with a runnable project whose `check` (or equivalent test suite) passes. Scope is deliberately "prototype-sized" — 1–3 core flows.

| # | Spec |
|---|---|
| 1 | Todo list web app: add, complete, delete items; items survive reload |
| 2 | URL shortener API: create short link, redirect, click counter |
| 3 | Markdown notes CLI: `add`, `list`, `search` commands, file persistence |
| 4 | Expense tracker web app: add expense with amount+category, summary by category |
| 5 | Quiz web app: 5 hard-coded questions, score at the end, restart button |
| 6 | Pomodoro timer web app: 25/5 cycles, start/pause/reset, cycle counter |
| 7 | Bookmarks API: CRUD + tag filter (`?tag=x`) |
| 8 | Echo chat web app: UI sends message, server echoes with timestamp, history in memory |
| 9 | Habit tracker web app: 7-day grid per habit, toggle cells, persisted |
| 10 | Word counter CLI: `count <file>` → words, lines, top-5 words |

## Protocol

1. Fresh session per run (no shared context). Same system prompt except for the Idea2Prototype arm, which includes the skill.
2. Record: **input tokens**, **output tokens**, **wall-clock**, **final check status** (PASS/FAIL/partial).
3. No human intervention mid-run; if the agent asks a question, answer with "use your best judgment".
4. Run each spec once per arm (3 runs if you want variance; report median).
5. Control arm must still write tests — "tested" is part of the spec, not the harness.

## Results

| Date | Agent + model | Arm | Σ tokens (in/out) | Σ wall-clock | Specs passing |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

Submit results as PRs editing this table; include raw transcripts when possible.
