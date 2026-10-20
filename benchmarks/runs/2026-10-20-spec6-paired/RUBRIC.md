# Spec 6 rubric — Pomodoro timer web app (pre-registered 2026-10-20T14:28:11Z, BEFORE either arm ran)

Spec text (verbatim, both arms): "Build a working prototype: Pomodoro timer web app: 25/5 cycles, start/pause/reset, cycle counter. Requirements: runnable with Node.js, include automated tests, finish only when it works end to end. When finished reply with DONE and instructions to run it."

Five binary criteria. Like spec 5, a pomodoro is UI/timer-centric and may legitimately be fully client-side, so c2–c4 are operationalized at the SERVED-SOURCE level on LINE-based predicates (line granularity is stronger than whole-source contains: the tokens must co-occur on one line, as real duration/control declarations do). The judge collects the app's own delivery surface exactly like the hardened spec-5 collector: root HTML + same-origin `<script src>` assets + static import specifiers + first-arg `fetch('…')` literals (GET-only, same-origin, bounded rounds/assets). Pre-registered limitation, same as spec 5: source-presence cannot prove a ticking timer; it applies identically to both arms.

- **c1 — app starts using its documented command**: `GET /` answers 200 with an HTML document (content-type `text/html`) within 15s of the documented start command, PORT overridden.
- **c2 — 25/5 durations**: on the collected source lines, a work duration of 25 minutes AND a break duration of 5 minutes are declared. Work: a line matching `25 * 60` or `1500`, or a line containing the token `25` AND a duration-ish word (`min|minute|work|focus|dur|pomodoro`). Break: a line matching `5 * 60` or `300`, or a line containing the token `5` AND (`min|minute|break|rest|short|pause`). Case-insensitive.
- **c3 — start and pause controls**: collected source contains both a start/play identifier and a pause identifier (`\b(start|play)\b` and `\bpause\b`, case-insensitive).
- **c4 — reset control + cycle counter**: collected source contains a reset/restart identifier (`\b(reset|restart)\b`, case-insensitive) AND a cycle counter identifier (`\b(cycle|session|round|pomodoro)s?\b`, case-insensitive).
- **c5 — own test command passes**: the project's own documented test command exits 0 (runs FIRST, before any judge traffic; `NODE_TEST_CONTEXT` stripped).

Judge: `benchmarks/judge-spec6.mjs <projectDir> <port> "<startCmd>" "<testCmd>"` — judge-spec4/5/7 conventions (recorded-flags integrity: exactly five entries always; readiness short-circuit; c5-first; whole-tree kill Windows `taskkill /T`, POSIX detached group ESRCH-guarded).
