# Claude Code adapter and init/uninstall CLI

Status: resolved
Type: task
Blocked by: 02

Map Claude Code hook payloads to Events. `init` is idempotent, backs up user-level settings, writes http hooks with short timeouts and the real port; `uninstall` reverses it. `start`/`stop` manage the detached daemon.

Acceptance: init twice changes nothing; uninstall restores the backup; a down daemon never blocks a Claude Code session.

## Comments

## Answer

- `packages/adapters`: stateful Claude Code mapper (hook payload to Events; sub-agent parent inferred at `SubagentStart`, observed at `PostToolUse(Agent)`; summaries never carry content). The daemon exposes it at `POST /hooks/claude-code` (always 204 for authenticated calls).
- `packages/cli`: `init`/`uninstall` (user-level `~/.claude/settings.json`, or `$CLAUDE_CONFIG_DIR`; http hooks, 2 s timeout, real port, bearer token header; one-time backup, byte-exact restore when nothing else changed), `start`/`stop` (detached daemon, pid and port in `~/.agentarium/daemon.json`, refuses a different-version daemon).
- Notes: Claude Code runs only command hooks for `SessionStart`, so sessions appear on their first other event. The bearer token is stored in plain text in the settings file. The daemon runs from TS sources via `tsx` until a build/packaging step exists, and `bin` points at `src/bin.ts` for the same reason. Unknown tools (incl. MCP) map to `think`.
