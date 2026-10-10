# 02: Record Codex fixtures with approvals turned on

**What to build:** Recorded Codex CLI 0.162.1 payloads, hooks and live app-server messages together, for sessions where approvals are on. These replace the approval fixtures captured under `untrusted`, which 0.162.1 no longer accepts.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `on-request` with `workspace-write` and with `read-only`: exec approval accepted, declined, and cancelled
- [ ] File-change approval, `request_permissions`, `request_user_input`, and MCP elicitation, each where reachable
- [ ] `--approve-for-me` (auto-review): approved and rejected requests, recording whether `PermissionRequest` fires
- [ ] A sandbox failure under `never` beside a sandbox escalation under `on-request`, on the Windows elevated sandbox
- [ ] Each capture records the hook `permission_mode` value, so the mapping from approval policy (including granular and auto-review) to that field is known
- [ ] Cases that need the TUI (`/permissions` presets) are driven through a human-in-the-loop script, not skipped silently
- [ ] Every capture uses an isolated `CODEX_HOME` and a scratch repo; the user's real Codex configuration is checked unchanged afterwards
- [ ] Fixtures are sanitized and sit beside the existing Codex fixtures, and the research doc's "needs human capture" list is updated

**Hazard:** on Windows, Codex runs shell commands through PowerShell, where `$home` is the read-only `$HOME`. Do not use it as a variable name for the isolated home.
