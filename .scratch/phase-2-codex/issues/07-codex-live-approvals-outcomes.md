# 07: Codex approvals and tool outcomes from the live connection

**What to build:** Where a supported Codex client connection exists, a pending approval shows the agent as waiting on the user, and a tool call's result shows as success or failure. Hook-only fidelity is kept as the fallback.

**Blocked by:** 06

**Status:** resolved

- [x] A pending human approval shows the agent as waiting on the user
- [x] A resolved approval clears the wait; the tool's execution state is handled as the spec's gap notes describe
- [x] A tool result shows success or failure, with unknown outcomes recorded as unknown, not as success
- [x] Without a live connection, the adapter falls back to hook-only behavior and says so in the UI or logs

**Known limits:** only sessions on the shared Codex app-server daemon can be observed live. In 0.160.0 that means the TUI. `codex exec` sessions stay hook-only. Resuming a thread keeps it subscribed while Agentarium is connected. Requests without a tool item (user input, elicitation) stay waiting until the next event after they are resolved.

## Comments

**Agent decisions (2026-10-10), please review:**
- **Connection:** the daemon connects to `$CODEX_HOME/app-server-control/app-server-control.sock` (JSON-RPC over WebSocket) as a second client. It finds threads with `thread/loaded/list` every 2 seconds plus `thread/resume {excludeTurns: true}`, and never replies to server requests. It reconnects every 5 seconds, logs each change between connected and hooks-only once to `daemon.log`, and reports `codexLive` in `/health`. `AGENTARIUM_CODEX_LIVE=0` turns it off.
- **Clearing a wait:** with no neutral resume event in the schema, `serverRequest/resolved` sends the open item's `tool_start` again (same id, tool and category). The agent then shows working on that tool, with its other pending calls kept.
- **Outcome de-duplication:** hooks and the live connection can both send `tool_end` for the same id (live item id == hook `tool_use_id`). The outcome gate drops a hook outcome that comes after a live one, and drops a live success that comes after a hook one. A live failure after a hook success is kept, because a Bash hook cannot tell success from failure.
- **Unknown item statuses** produce no `tool_end` and are logged as `codex live: unknown outcome …`.
- **Verified end to end** with a real Codex 0.160.0 TUI in tmux: an approval prompt showed as waiting, approving it showed exec again and then the completion, and Esc (decline) gave `tool_end ok:false` and then idle.
