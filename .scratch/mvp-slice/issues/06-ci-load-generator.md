# CI on three OSes and synthetic load generator

Status: ready-for-agent
Type: task
Blocked by: none

pnpm workspace scaffold with CI matrix on Windows, macOS and Linux from the first commit; load generator (about 200 agents, bursty events) in the repo.

Acceptance: CI green on all three; load generator runs against the daemon once ticket 03 lands. Start alongside ticket 02.

## Comments
