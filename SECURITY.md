# Security Policy

idea2prototype runs locally with zero dependencies: it copies templates,
spawns `node --test`/`node --check`, and (for `web`/`api` scaffolds) starts a
local HTTP server bound to loopback. This page covers the tool itself; what
you build with it is your code.

## Supported versions

Only the latest release line is supported.

| Version | Supported |
| ------- | --------- |
| latest minor | ✅ |
| older | ❌ |

## Reporting a vulnerability

Please report privately: open a **GitHub private security advisory** on this
repository (Security tab → "Report a vulnerability"). Do not open a public
issue for anything exploitable.

Include the command you ran, the verdict/output, and Node version. If a
scaffolded template has a flaw (e.g. the auth or upload modules), say which
template and feature — those files are copied into user projects, so template
bugs ship with every scaffold.

## Scope notes

- `auth-local` is a prototype-grade account system (scrypt + HMAC-signed
  cookies). It is deliberately simple; do not treat it as hardened
  production auth.
- `upload` enforces a 5MB cap and path-traversal guards, but performs no
  content-type sniffing or virus scanning.
- The scaffolds bind to loopback by default; exposing them to a network is
  your responsibility.
