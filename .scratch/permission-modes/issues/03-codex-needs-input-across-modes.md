# 03: Codex: approvals that need a person raise the needs-input flag

**What to build:** A user running Codex with approvals on sees the agent waiting whenever Codex is waiting for them, and only then. An automatic review is not shown as waiting. A declined or cancelled request shows as an outcome, and the agent stops waiting even when no closing hook arrives.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Each approval kind in the 02 fixtures that routes to a person shows the agent as waiting, from hooks alone and from the live connection
- [ ] The hook `permission_mode` field (which reflects the approval policy, not the sandbox) is kept on the agent
- [ ] Requests routed to auto-review do not raise the needs-input flag
- [ ] A decline or cancel ends the wait and is recorded as a failed or aborted outcome, never as success
- [ ] In hook-only mode, a request with no closing hook clears on the agent's next event, `Stop`, or `Interrupt`
- [ ] Behaviour under `never` and under bypass is unchanged (regression check against the existing fixtures)
- [ ] Verified end to end with a real Codex session in `on-request` mode
