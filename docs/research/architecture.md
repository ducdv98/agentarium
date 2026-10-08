# Architecture

Research date: 2026-10-08. Terms follow [glossary.md](glossary.md). Event
sources are in [event-sources.md](event-sources.md); structure in
[topologies.md](topologies.md); scene layer in [themes.md](themes.md) and
[rendering.md](rendering.md). Prior art in [prior-art.md](prior-art.md).

## Goals

- Install once, globally; start in a repo folder; one command to see it work.
- Many projects in parallel, each with its own room, on one machine.
- Windows, macOS and Linux from day 0.
- Right seams at day 0 so scale (more agents, more machines, more viewers) is
  an extension, not a rewrite.

## Process model: one global daemon, many rooms

One per-repo daemon was rejected: hook config is per file, not per process, so
it would need a different port per repo; the user would juggle ports and tabs;
there would be no cross-project view.

```
npm i -g agentarium
agentarium init        # once: install hooks into user-level agent configs
cd ~/code/my-project
agentarium start       # start daemon if needed, open this repo's room
```

- The daemon listens on one well-known port on `127.0.0.1` (default to be
  chosen; overridable by env var; `init` writes the actual port into hook URLs).
- **Room = repo.** Derived from the event's `cwd`: the git root, resolved
  through the git common directory so worktrees of one repo share a room.
  Unknown directories either auto-create a room or go to an "unassigned" room
  (open question).
- `agentarium start` only ensures the daemon is running and opens
  `/r/<room>`. Collection does not depend on it.
- Home page: all active rooms as small thumbnails with each room's needs-input
  flag. This is the cross-project triage view.
- Lifecycle MVP: `start` launches a detached daemon, `stop` stops it.
  Auto-start on login (launchd, systemd user unit, Task Scheduler) is a later
  `service install`.

## Hook installation

- User-level hooks (`~/.claude/settings.json` and equivalents) cover every repo
  without touching any repo. Project-level
  (`.claude/settings.local.json`, gitignored) is an opt-in alternative.
- `init` is idempotent, backs up before editing, and has a matching
  `uninstall`.
- Claude Code uses the `http` hook type (no shim). Other providers use command
  hooks with a Node shim, not `curl` or shell scripts (Windows).
- Codex requires a one-time trust review for non-managed command hooks; `init`
  must explain this.

### Hook failure behavior (verified for Claude Code)

From the Claude Code hooks reference: an `http` hook whose URL is unreachable,
returns non-2xx, or returns an invalid body is a **non-blocking error** and
execution continues. A timed-out hook is canceled and its output discarded; a
timed-out `PreToolUse` hook does not block the tool call. Command hooks that
cannot start, or exit with a code other than 2 without valid JSON on stdout,
are also non-blocking. Default timeouts are long (600 s for most events; 30 s
for `UserPromptSubmit`), so set a short explicit `timeout` on our hooks.
Observation hooks must never exit 2 or return decision JSON. A down daemon
therefore cannot break an agent session on Claude Code. Not verified for Codex,
Gemini CLI or Cursor (Cursor's docs state failures are fail-open).

## Core design: event sourcing

```
adapters --> normalized AgentEvent --> bus --> append-only log
                                          \--> pure reducer --> state --> patches --> WebSocket --> UI
```

1. Adapters emit normalized, versioned events (`schema_version` on every
   event) onto a bus.
2. A **pure reducer** (no I/O) derives all state from the log. Benefits:
   replay, reconnect recovery, deterministic tests, ability to run the reducer
   anywhere.
3. State never changes outside the reducer.
4. **Identity** is `machine_id : provider : session_id : agent_id` from day 0.
   Adding `machine_id` later is a painful migration.
5. **Transport interface:** the bus is in-process now; later it can be an
   authenticated network relay so remote or cloud agents push the same events.

## Packages (pnpm workspace)

| Package | Responsibility |
|---|---|
| `core` | Schema, reducer, types. Pure TypeScript, no I/O; shared by daemon and UI |
| `adapters` | One module per source (Claude Code, Codex, Gemini, OTel, proxy, log tail) |
| `server` | Ingest, room router, WebSocket, storage, static UI hosting |
| `renderer-2d` | PixiJS isometric renderer, no React |
| `ui-web` | React shell: panels, overlays, routing |
| `themes` | Data and assets, validated against a schema |
| `cli` | `init`, `start`, `stop`, later `service` |
| later: `renderer-3d` | Second implementation of the same `Renderer` interface |

Pixel Agents splits `core`, `server`, `adapters`, `webview-ui` similarly,
which supports this shape.

## Wire protocol (daemon to UI)

- Snapshot on connect, then patches; the UI receives state diffs, not raw
  events.
- Sequence numbers so a client can detect gaps and resync.
- Per-client backpressure: coalesce or drop stale updates for slow clients.
- High-frequency events (token streams, tool bursts) are coalesced or sampled
  before reaching the UI.
- Rooms are the partition unit.

## Storage

- Behind an interface. Start with an append-only JSON-lines log per room.
- `node:sqlite` is still marked Stability 1.2 (release candidate) in the
  Node.js docs as of v26.x, not Stable; do not depend on it yet.
- A native SQLite module is an install-failure risk on some OS; avoid unless
  prebuilt binaries cover all three platforms (not verified here).

## Security

- Bind `127.0.0.1` only. Validate `Host` and `Origin` (browsers can reach
  localhost services; a web page could post fake events or read the stream).
- Random token for ingest and for the UI URL; hook installation requires the
  token. Pixel Agents uses the same model and documents its caveat: a token in
  a URL can land in browser history and logs, so treat it as a secret.
- A read-only viewer role for later multi-viewer use.
- Binding to `0.0.0.0` must be an explicit opt-in with a warning.

## Cross-platform rules

- Node.js (current LTS) for daemon and CLI.
- No shell scripts in install or hook paths.
- TCP on `127.0.0.1`, not Unix sockets.
- No native modules unless proven on all three OSes.
- Normalize path separators and drive letters; compare case-insensitively on
  Windows and macOS when deriving rooms.
- CI matrix on all three OSes from the first commit.
- Distribution is npm. A single-file executable is possible later: Node 25.5
  added `--build-sea`, but SEA still needs per-platform builds, re-signing on
  macOS and Windows, and a CommonJS bundle; treat it as a later option, not a
  day-0 dependency.

## Scalability map

| Kind of scale | Day-0 seam |
|---|---|
| More agents and rooms on one machine | Rooms as partition; patches not raw events |
| High event rates | Coalescing before the UI; cheap pure reducer |
| Multi-machine / team | `machine_id` in identity; auth tokens; transport interface |
| Many viewers | Patch broadcast; viewer role |
| Replay / history | Append-only log |

Not needed now: a message broker, microservices, a database server, a
distributed state store.

## Testing at day 0

- A synthetic load generator (around 200 agents, bursty events) in the repo.
- Recorded real event streams as fixtures, replayed through the reducer and
  through a headless browser (Playwright) for screenshot comparison.
- CI on Windows, macOS and Linux.

## Open questions

- Auto-create versus unassigned rooms for unknown directories.
- Worktree grouping edge cases (detached worktrees, submodules, monorepos).
- Hook failure semantics for Codex, Gemini CLI and Cursor.
- Which storage backend after JSON-lines (SQLite variant) and when.
- Default port and collision handling.
- Whether `start` should refuse or reuse when a daemon of a different version
  is already running.
