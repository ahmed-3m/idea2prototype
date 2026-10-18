---
description: Scaffold a verified prototype from an idea (Idea2Prototype)
argument-hint: <idea in one sentence>
---

Turn the idea "$ARGUMENTS" into a running, tested prototype using the idea2prototype skill.

0. Load the idea2prototype skill first — it documents the workflow and provides the bundled script path (`<skill-base>/scripts/idea2prototype.mjs`) used below. If the skill is unavailable, fall back to the plugin's `skills/idea2prototype/scripts/idea2prototype.mjs`.
1. Pick the template: a UI demo or full web app → `web`; a service/API → `api`; a terminal tool → `cli` (default: `web`).
2. Derive a short slug directory name from the idea.
3. Scaffold: `node <skill-base>/scripts/idea2prototype.mjs new <slug> --template <t> --name "<Name>" --idea "$ARGUMENTS"`.
4. Fill the generated `PROTOTYPE.md`: Goal (max 3 bullets), 1–3 core flows, out-of-scope list.
5. Run `npm run check` inside the project and confirm PASS.
6. Implement the core flows in the smallest possible edits, running `npm run check` after each change. Use `add api-crud --resource <name>` for anything needing persistence instead of hand-writing CRUD.
7. Finish when check is PASS and every core flow works; report the final verdict lines and the flow checklist. Do not hand-write scaffold files and do not read raw test logs — the check verdict is the only feedback you need.
