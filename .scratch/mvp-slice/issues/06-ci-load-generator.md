# CI on three OSes and synthetic load generator

Status: resolved
Type: task
Blocked by: none

pnpm workspace scaffold with CI matrix on Windows, macOS and Linux from the first commit; load generator (about 200 agents, bursty events) in the repo.

Acceptance: CI green on all three; load generator runs against the daemon once ticket 03 lands. Start alongside ticket 02.

## Comments

## Answer

- `.github/workflows/ci.yml`: ubuntu, macOS and Windows matrix (Node 24, pnpm pinned via `packageManager`): install with frozen lockfile, typecheck, test, UI build. Not yet run on GitHub: only the Windows result is verified locally, so the first push is the real check for macOS and Linux.
- `packages/loadgen`: seeded, bursty generator (default 200 agents, sub-agents, permission waits, global burst moments) and a runner that reports sent, failed and latency percentiles. CLI: `pnpm --filter @agentarium/loadgen loadgen -- --agents 200 --duration 30` against a running daemon. A test plays 200 agents through a real daemon and checks all arrive.
