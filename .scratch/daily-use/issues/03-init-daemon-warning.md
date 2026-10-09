# `init` warns when the daemon is not running

Status: resolved
Type: task
Blocked by: none

After writing hooks, `init` checks whether a daemon is reachable on the configured port. If none is, it prints one line saying the hooks will do nothing until the daemon runs, plus the exact `start` command. It still exits successfully. A daemon of a different version gets the existing `stop` hint.

Acceptance: tests cover the running, not-running and different-version cases; `init` stays idempotent.

## Comments
- 2026-10-09: `init` is now async. After writing hooks it probes the configured port and reports `daemon`: `running`, `not-running` or `other-version`. The bin prints the one-line `agentarium start` warning when not running, or the shared different-version stop hint (now `differentVersionMessage`, also used by `start`). Exit stays 0. Tests in `packages/cli/test/lifecycle.test.ts` cover running, not-running, different-version (a stub `/health` server) and idempotency. Typecheck, the full suite and the CLI suite pass locally on Windows. The Codex standards and spec reviews did not return a verdict, so the review was done by hand against the diff: no blocking findings. Follow-up noted: a non-agentarium process on the port reads as "not-running". Resolved.
