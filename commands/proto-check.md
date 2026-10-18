---
description: Verify a prototype and fix it until the check passes (Idea2Prototype)
---

Run the Idea2Prototype verifier on the current project and drive it to green.

1. Load the idea2prototype skill for the bundled script path (`<skill-base>/scripts/idea2prototype.mjs`) if it is not already in context.
2. Run `npm run check` in the project root (if no `.idea2prototype.json` is present, ask the user which project to check, or scaffold first with the proto-new command).
3. If the verdict is PASS, report the three verdict lines and stop.
4. If it is FAIL, fix only what the failure notes name (max 3 shown), then re-run `check`. Repeat at most 5 iterations.
5. If still failing after 5 iterations, report the failing notes, your diagnosis of the root cause, and the smallest proposed fix — do not continue blind iterations.
6. Never read raw test/build logs or `cat` log files; the verdict is the feedback loop.
