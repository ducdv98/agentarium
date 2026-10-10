# 06: Delegation workflow uses the user's own Codex config

**What to build:** When Claude delegates research, implementation, or review to Codex in this repo, Codex runs with the approval and sandbox mode the user has configured. Nothing in the workflow forces bypass. The known failure of nested Codex inside a sandbox is documented with a fallback.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] `AGENTS.md` no longer hard-codes `--dangerously-bypass-approvals-and-sandbox`; delegated runs inherit the user's Codex configuration
- [x] The workflow states what happens when the user's mode needs approvals while Codex runs unattended, and what Claude does then
- [x] The nested-Codex failure is documented with its symptoms (`Reconnecting... waiting for network`, `Could not find home directory`) and a fallback: Codex's built-in sub-agents, or Claude doing the work itself
- [x] Verified by delegating one small task under a sandboxed configuration

## Answer

`AGENTS.md` now runs `codex exec "<prompt>" < /dev/null` with no permission flags and has a "Permission mode" section.

Verified 2026-10-10 with Codex 0.162.1, using `codex exec -c 'approval_policy="on-request"' -s workspace-write` from a scratch repo. The run header showed `approval: never` and `sandbox: workspace-write [workdir, /tmp, $TMPDIR]`, because exec ignores `approval_policy` and never waits for a person. The small task (add a test and run it) succeeded. A write to `F:\codex-sandbox-probe\outside.txt` failed with `Access to the path ... is denied` (exit 1) and Codex reported the failure. Nothing hung.
