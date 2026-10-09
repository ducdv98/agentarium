# `init` warns when the daemon is not running

Status: ready-for-agent
Type: task
Blocked by: none

After writing hooks, `init` checks whether a daemon is reachable on the configured port. If none is, it prints one line saying the hooks will do nothing until the daemon runs, plus the exact `start` command. It still exits successfully. A daemon of a different version gets the existing `stop` hint.

Acceptance: tests cover the running, not-running and different-version cases; `init` stays idempotent.

## Comments
