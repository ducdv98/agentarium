# Daemon: ingest, room router, log, WebSocket

Status: ready-for-agent
Type: task
Blocked by: 02

Fastify-or-equivalent server on 127.0.0.1, token plus Host/Origin checks, Room router (git common dir, worktrees share a room, non-git to unassigned), JSON-lines log behind a storage interface, snapshot then sequenced patches over WebSocket with coalescing.

Acceptance: integration test posting fixtures and receiving patches; gap detection resync works; refuses to start on a different-version daemon.

## Comments
