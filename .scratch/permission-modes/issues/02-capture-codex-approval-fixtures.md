# 02: Record Codex fixtures with approvals turned on

**What to build:** Recorded Codex CLI 0.162.1 payloads, hooks and live app-server messages together, for sessions where approvals are on. These replace the approval fixtures captured under `untrusted`, which 0.162.1 no longer accepts.

**Blocked by:** 01

**Status:** resolved

- [x] `on-request` with `workspace-write` and with `read-only`: exec approval accepted, declined, and cancelled
- [x] File-change approval, `request_permissions`, `request_user_input`, and MCP elicitation, each where reachable
- [x] `--approve-for-me` (auto-review): approved and rejected requests, recording whether `PermissionRequest` fires
- [x] A sandbox failure under `never` beside a sandbox escalation under `on-request`, on the Windows elevated sandbox
- [x] Each capture records the hook `permission_mode` value, so the mapping from approval policy (including granular and auto-review) to that field is known
- [x] Cases that need the TUI (`/permissions` presets) are driven through a human-in-the-loop script, not skipped silently
- [x] Every capture uses an isolated `CODEX_HOME` and a scratch repo; the user's real Codex configuration is checked unchanged afterwards
- [x] Fixtures are sanitized and sit beside the existing Codex fixtures, and the research doc's "needs human capture" list is updated

**Hazard:** on Windows, Codex runs shell commands through PowerShell, where `$home` is the read-only `$HOME`. Do not use it as a variable name for the isolated home.

## Answer

Fixtures are in `spikes/fixtures/codex/` (`onreq-*`, `file-*`, `mcp-elicit`, `auto-*`, `never-sandbox-deny`), and the findings are in [permission-modes.md](../../../docs/research/permission-modes.md#codex-01621-approval-fixtures). The harness now writes PowerShell hook commands on Windows. `capture-app.mjs` takes optional `thread/start` params, and `sanitize.mjs` keeps the rollout `turn_context` permission fields.

Key finding: under auto-review the `PermissionRequest` hook still fires, and its `permission_mode` is `default`, the same as for a person-routed request. Only the live `item/autoApprovalReview/*` messages or the rollout `turn_context.approvals_reviewer` tell the two apart.

Not reached: `request_user_input`, `request_permissions`, a granular policy, and an auto-review denial. TUI presets have a human-run script, `spikes/codex/capture-tui.mjs`, which has not been run. The real `~/.codex` files were checked by SHA-256 before and after: unchanged.

Checklist: on-request + workspace-write/read-only accept/decline (cancel on read-only only) ✔; file change ✔; MCP elicitation ✔; request_permissions/user_input unreachable ✘; auto-review approved ✔, rejected ✘; never vs on-request sandbox ✔; permission_mode mapping ✔; TUI script ✔ (not run); isolation ✔; sanitized + docs ✔.

Remaining for a person (status `ready-for-human`):
- Run `spikes/codex/capture-tui.mjs` for the `/permissions` presets.
- Capture an auto-review rejection. The `--approve-for-me` item stays open because only approvals were captured.
- Capture `request_permissions` and `request_user_input`, and cancel under `workspace-write`, if a model emits them.

2026-10-10: `tui-permissions` captured with the fixed script. It covers only the default preset (`on-request` + `workspace-write`, reviewer `user`); the other presets are still to do.

2026-10-10, second TUI run: `tui-permissions` now covers the auto-review, full-access and read-only presets, with Esc and approve under read-only. Each preset change shows up as a new rollout `turn_context`. The hook `permission_mode` reports `bypassPermissions` only for `never` and `default` for everything else. Resolved. Still open, and listed in the research doc as reachable only later: a custom profile, an auto-review rejection, `request_permissions`/`request_user_input`, and cancel under `workspace-write`.

2026-10-10, gaps closed. New fixtures:
- `onreq-ww-cancel`: cancel under `workspace-write`.
- `auto-reject`: the reviewer denied a POST of a fake `.env` to `https://exfil.invalid`. `PermissionRequest` still fires, and the item ends `declined` with no `PostToolUse`.
- `reqperm-accept` and `reqperm-decline`, captured with feature flag `request_permissions_tool`.
- `user-input`, captured with feature flag `default_mode_request_user_input`.
- `granular-deny`, `granular.sandbox_approval = false`, which needs the `experimentalApi` capability: the escalation is auto-rejected with no request and no `PostToolUse`.

Neither `request_permissions` nor `request_user_input` fires a `PermissionRequest` hook. The Codex hook adapter now raises needs-input at their `PreToolUse`; a reviewer-routed `request_permissions` is excluded. A `request_permissions` that grants nothing is recorded as failed. Still not captured: a TUI custom profile (the granular fixture covers the underlying policy), the Windows `unelevated` sandbox, and managed `requirements.toml`. They remain listed in the research doc.
