# Claude Code adapter and init/uninstall CLI

Status: ready-for-agent
Type: task
Blocked by: 02

Map Claude Code hook payloads to Events. `init` is idempotent, backs up user-level settings, writes http hooks with short timeouts and the real port; `uninstall` reverses it. `start`/`stop` manage the detached daemon.

Acceptance: init twice changes nothing; uninstall restores the backup; a down daemon never blocks a Claude Code session.

## Comments
