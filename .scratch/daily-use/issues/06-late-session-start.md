# Sessions appear only on their first event after SessionStart

Status: needs-triage
Type: task
Blocked by: none

Claude Code runs only command hooks for `SessionStart`, and we use http hooks, so a new session shows up only on its next event. A `SessionStart` command hook would conflict with keeping hook paths free of shell scripts and would cost a process spawn per session. Promote only if `usage-log.md` shows a newly started session being missed in a way that hurts triage.

## Comments
