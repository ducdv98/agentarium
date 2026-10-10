# 06: Codex lifecycle hooks show in the room

**What to build:** A Codex CLI session appears as a character in the room, moving through the thinking, tool and idle states, driven only by trusted lifecycle and tool hooks. The Codex hook install goes through the safe install path from the first install-safety slice.

**Blocked by:** 04, 05

**Status:** resolved

- [x] Starting a Codex session adds a character to the room
- [x] A Codex tool call shows the tool's category, mapped under ADR 0004
- [x] A completed Codex turn shows as idle, not as needs-input
- [x] Codex hook install uses the same guarded write path as Claude Code install
- [x] Fixtures from ticket 05 drive the tests

**Known limits:** hooks carry no Bash exit code, so a Bash `PostToolUse` shows as completed (`ok: true`) even when the command failed. A failed patch, an MCP error or a declined approval sends no `PostToolUse`. That call stays pending until the turn's `Stop` or `Interrupt` clears it. Sub-agent parent links are `inferred` from spawn order.

## Comments

**Agent decisions (2026-10-10), please review:**
- **Hook trust:** `init` writes `~/.codex/hooks.json` but does not mark the hooks trusted. Codex shows "Hooks need review" and the user approves them once. Writing `trusted_hash` ourselves would skip Codex's own review. Re-running `init` with a different port or install path changes the command, so Codex asks for review again.
- **Forwarder:** Codex hooks cannot call HTTP, so the handler is a command: `"<node>" "<cli bin.js>" hook codex --port N --home <agentarium home>`. No token is written into `hooks.json`. The forwarder reads it from the Agentarium home at run time, is always silent, and always exits 0. Port and home are in the command because the hook runs with Codex's environment, not ours (the end-to-end run caught this). The absolute paths break if the package moves (for example an `npx` cache), and re-running `init` fixes them.
- **Codex install is conditional:** Codex hooks are installed only when the Codex home (`$CODEX_HOME` or `~/.codex`) exists. Otherwise `init` reports that it skipped them.
- **`SubagentStop` maps to `stop` (idle), not `end`:** a Codex sub-agent can get more input later. Sub-agents end when the root's `SessionEnd` arrives, or through the lost timeout.
- **`Interrupt` maps to `stop` on the root:** cancelled turns send `Interrupt` instead of `Stop`.
- **Verified end to end** against Codex 0.160.0: `codex exec` with a sub-agent produced the expected events in the daemon's log.

**Code review (2026-10-10):** `isOurs` now matches only the exact command shape Agentarium installs, so a user command that happens to contain `hook codex` is never removed.
