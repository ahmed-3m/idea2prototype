---
description: Scaffold a verified prototype from an idea (Idea2Prototype)
argument-hint: <idea in one sentence>
---

Turn the idea "$ARGUMENTS" into a running, tested prototype using the idea2prototype skill.

0. Load the idea2prototype skill first — it documents the workflow and provides the bundled script path (`<skill-base>/scripts/idea2prototype.mjs`) used below. If `<skill-base>` is not substituted or the skill was installed via the universal Agent Skills standard, use `npx @ahmed-3m/idea2prototype` (or `i2p` if globally installed).
1. Grill first (Step 0 — Socratic Alignment): if the template or scope is ambiguous, ask the user 2–3 sharp questions before scaffolding — (1) template: web / api / cli / worker / library, (2) the 1–3 must-have core flows, (3) what is explicitly out of scope to keep the build token-lean. An unambiguous idea skips the questions.
2. Pick the template: a UI demo or full web app → `web`; a service/API → `api`; a terminal tool → `cli`; background jobs → `worker`; a reusable module/util → `library` (default: `web`, or the grilled answer).
3. Derive a short slug directory name from the idea.
4. Scaffold: `node <skill-base>/scripts/idea2prototype.mjs new <slug> --template <t> --name "<Name>" --idea "$ARGUMENTS"` (or `npx @ahmed-3m/idea2prototype new <slug> --template <t> --name "<Name>" --idea "$ARGUMENTS"`).
5. Fill the generated `PROTOTYPE.md` with the grill answers (derive them now if the questions were skipped): Goal (max 3 bullets), 1–3 core flows, out-of-scope list.
6. Run `npm run check` inside the project and confirm PASS.
7. Implement the core flows in the smallest possible edits, running `npm run check` after each change. Use `add api-crud --resource <name>` for anything needing persistence instead of hand-writing CRUD.
8. Finish when check is PASS and every core flow works; report the final verdict lines and the flow checklist. Do not hand-write scaffold files and do not read raw test logs — the check verdict is the only feedback you need.
