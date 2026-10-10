# Permission modes

Agentarium was built and dogfooded with permissions effectively off: Codex `approval_policy = "never"` with `danger-full-access`, `--dangerously-bypass-approvals-and-sandbox` in the delegation workflow, and Claude Code in bypass mode. Real users run with approvals and sandboxes on. Agentarium must observe agents correctly in whatever permission mode the user has configured, and must never impose a mode of its own.

Three parts:

1. **Observation.** In every permission mode of Codex CLI and Claude Code, an approval that needs a person raises the **needs-input flag**, an automatic decision (Codex auto-review, Claude `auto` classifier, `dontAsk`) does not, and a denial shows as an outcome rather than leaving the agent waiting.
2. **Delegation workflow.** Our own Claude-orchestrates-Codex workflow runs Codex with the user's configured mode instead of hard-coding bypass.
3. **Launching.** Anything Agentarium launches in future inherits the user's effective mode.

Evidence: [docs/research/permission-modes.md](../../docs/research/permission-modes.md).

Verified 2026-10-10 on Windows, Codex CLI 0.162.1: Codex hooks reach the daemon from `read-only`, `workspace-write` and `danger-full-access` sandboxes, because hooks run outside the sandbox. A nested `codex exec` run as a shell command inside a sandboxed Codex session cannot reach the API: it loops on `invalid peer certificate: UnknownIssuer` and then `Reconnecting... waiting for network`. With `sandbox_workspace_write.network_access=true` it fails instead with `Could not find home directory`, because the Windows elevated sandbox user has no home.
