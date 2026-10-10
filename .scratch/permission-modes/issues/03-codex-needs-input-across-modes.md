# 03: Codex: approvals that need a person raise the needs-input flag

**What to build:** A user running Codex with approvals on sees the agent waiting whenever Codex is waiting for them, and only then. An automatic review is not shown as waiting. A declined or cancelled request shows as an outcome, and the agent stops waiting even when no closing hook arrives.

**Blocked by:** 02

**Status:** resolved

- [x] Each approval kind in the 02 fixtures that routes to a person shows the agent as waiting, from hooks alone and from the live connection
- [x] The hook `permission_mode` field (which reflects the approval policy, not the sandbox) is kept on the agent
- [x] Requests routed to auto-review do not raise the needs-input flag
- [x] A decline or cancel ends the wait and is recorded as a failed or aborted outcome, never as success
- [x] In hook-only mode, a request with no closing hook clears on the agent's next event, `Stop`, or `Interrupt`
- [x] Behaviour under `never` and under bypass is unchanged (regression check against the existing fixtures)
- [x] Verified end to end with a real Codex session in `on-request` mode

## Answer

The Codex hook adapter now keeps `permission_mode` on its events and uses the shared `permission-prompts.ts`. A prompted call with no `PostToolUse` when the turn closes (`Stop`, `Interrupt`, `UserPromptSubmit`, `SubagentStop`, `SessionEnd`) becomes a failed `tool_end`.

Auto-review fires the same `PermissionRequest` hook as a person-routed request, so it is handled two ways:
- **Hook-only:** the daemon reads the last rollout `turn_context.approvals_reviewer` (`readCodexApprovalsReviewer`, bounded tail read). When it is `auto_review`, no needs-input is raised.
- **Live:** the mapper treats `item/autoApprovalReview/started` as the call resuming.

The 0.160.0 `never`/bypass fixture tests still pass unchanged.

End to end, 2026-10-10 on Codex 0.162.1: a real `on-request` + `read-only` session, hooks forwarded by the built `agentarium hook codex` to a dev daemon in isolated homes. Decline logged `needs_input`, then `tool_end ok=false`, then `stop`. Accept logged `needs_input`, then `tool_end ok=true`. Every event had `permission_mode: default`.
