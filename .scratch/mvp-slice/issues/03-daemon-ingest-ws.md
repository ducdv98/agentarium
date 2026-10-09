# Daemon: ingest, room router, log, WebSocket

Status: resolved
Type: task
Blocked by: 02

Fastify-or-equivalent server on 127.0.0.1, token plus Host/Origin checks, Room router (git common dir, worktrees share a room, non-git to unassigned), JSON-lines log behind a storage interface, snapshot then sequenced patches over WebSocket with coalescing.

Acceptance: integration test posting fixtures and receiving patches; gap detection resync works; refuses to start on a different-version daemon.

## Comments

## Answer

Implemented in `packages/server` (daemon, ingest validation, room router, JSONL storage) plus `packages/core/src/patch.ts` (diff/apply patch, `createPatchClient` with gap detection). Ingest contract: `POST /events` with `{cwd?, event}` (no `ts`; daemon assigns it), token via `Authorization: Bearer` or `x-agentarium-token`. WebSocket: `/ws?token=&room=`. Known minor: a backpressured client stays stale until the next flush; `?room=` creates rooms on demand.
