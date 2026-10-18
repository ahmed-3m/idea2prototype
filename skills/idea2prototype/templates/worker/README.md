# {{name}}

Idea2Prototype prototype (worker template).

- Run demo: `npm start` (or `node worker.mjs`)
- Verify: `npm run check`
- Spec: see `PROTOTYPE.md`

Built-in job types: `echo`, `delay`, `fail`. Register your own:
`registerHandler('email', async ({ payload }) => { ... })`.
Jobs persist in `data/jobs.json`; failures retry up to 3 attempts.
Zero runtime dependencies — Node >= 18 only.
