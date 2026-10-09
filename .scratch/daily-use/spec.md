# Phase 1: Daily use

Goal: anyone with Node can install Agentarium in one command and use it every day on one machine. Terms follow `CONTEXT.md`; decisions are in `docs/adr/0001-0005`. Follows `.scratch/mvp-closeout/issues/01-closeout.md` (resolved). Real usage is logged in `usage-log.md` throughout this phase.

## Scope

- A real build step: nothing runs through `tsx` or from `src/` at runtime.
- One published package, `@agentarium/cli`, whose command is `agentarium` (ADR 0005). It bundles the CLI, daemon, adapters, core and built UI. Workspace packages stay private.
- MIT LICENSE and a README.
- Releases triggered by a `v*` tag, published through npm trusted publishing (OIDC) with provenance; no npm token stored as a secret.
- `init` warns when the daemon is not running and shows the `start` command.
- Fixed scope plus whatever `usage-log.md` shows: known gaps are `needs-triage` issues, promoted only if the log shows them hurting triage.

Out of scope: auto-start on login, multiple machines or a network relay, a second provider, the isometric Theme, the all-rooms home page.

## Decisions (from grilling, 2026-10-09)

- Localhost and one machine only for this phase.
- Node `>=22.18`; CI tests Node 22 and 24 on all three OSes. Raise the minimum to 24 when 22 reaches end of life (April 2027).
- The bearer token stays in plain text in the Claude Code settings file and is documented in the README's security notes: it guards against other local processes, which could read it from any location.
- Auto-start waits for a later `service` command if the log shows `start` being forgotten.
