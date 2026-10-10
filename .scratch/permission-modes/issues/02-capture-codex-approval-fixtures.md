# 02: Record Codex fixtures with approvals turned on

**What to build:** Recorded Codex CLI 0.162.1 payloads, hooks and live app-server messages together, for sessions where approvals are on. These replace the approval fixtures captured under `untrusted`, which 0.162.1 no longer accepts.

**Blocked by:** 01

**Status:** resolved

- [ ] `on-request` with `workspace-write` and with `read-only`: exec approval accepted, declined, and cancelled
- [ ] File-change approval, `request_permissions`, `request_user_input`, and MCP elicitation, each where reachable
- [ ] `--approve-for-me` (auto-review): approved and rejected requests, recording whether `PermissionRequest` fires
- [ ] A sandbox failure under `never` beside a sandbox escalation under `on-request`, on the Windows elevated sandbox
- [ ] Each capture records the hook `permission_mode` value, so the mapping from approval policy (including granular and auto-review) to that field is known
- [ ] Cases that need the TUI (`/permissions` presets) are driven through a human-in-the-loop script, not skipped silently
- [ ] Every capture uses an isolated `CODEX_HOME` and a scratch repo; the user's real Codex configuration is checked unchanged afterwards
- [ ] Fixtures are sanitized and sit beside the existing Codex fixtures, and the research doc's "needs human capture" list is updated

**Hazard:** on Windows, Codex runs shell commands through PowerShell, where `$home` is the read-only `$HOME`. Do not use it as a variable name for the isolated home.

## Answer

Fixtures are in `spikes/fixtures/codex/` (`onreq-*`, `file-*`, `mcp-elicit`, `auto-*`, `never-sandbox-deny`), and the findings are in [permission-modes.md](../../../docs/research/permission-modes.md#codex-01621-approval-fixtures). The harness now writes PowerShell hook commands on Windows. `capture-app.mjs` takes optional `thread/start` params, and `sanitize.mjs` keeps the rollout `turn_context` permission fields.

Key finding: under auto-review the `PermissionRequest` hook still fires, and its `permission_mode` is `default`, the same as for a person-routed request. Only the live `item/autoApprovalReview/*` messages or the rollout `turn_context.approvals_reviewer` tell the two apart.

Not reached: `request_user_input`, `request_permissions`, a granular policy, and an auto-review denial. TUI presets have a human-run script, `spikes/codex/capture-tui.mjs`, which has not been run. The real `~/.codex` files were checked by SHA-256 before and after: unchanged.

Checklist: on-request + workspace-write/read-only accept/decline (cancel on read-only only) ✔; file change ✔; MCP elicitation ✔; request_permissions/user_input unreachable ✘; auto-review approved ✔, rejected ✘; never vs on-request sandbox ✔; permission_mode mapping ✔; TUI script ✔ (not run); isolation ✔; sanitized + docs ✔.
