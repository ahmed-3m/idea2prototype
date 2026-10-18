---
name: Feature request
about: A new template, feature module, or engine capability
title: ''
labels: enhancement
assignees: ''
---

**What is it?**

A new template (`new --template <name>`), a feature module (`add <name>`), or an engine change.

**Why is it token-lean?**

Idea2Prototype only ships things a deterministic scaffold can own better than the model. Explain what an agent currently spends tokens/time on that this would make deterministic.

**Scope check**

Templates and features follow the contribution recipes in [CONTRIBUTING.md](../../CONTRIBUTING.md) — a template is a directory that passes `check` on a clean scaffold; a feature is `route.tmpl.mjs` + `test.tmpl.mjs` + one registry entry. Does this fit that shape? If it needs runtime dependencies, say so up front (they are banned by design rule 2).
