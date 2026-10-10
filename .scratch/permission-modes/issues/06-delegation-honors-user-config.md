# 06: Delegation workflow uses the user's own Codex config

**What to build:** When Claude delegates research, implementation, or review to Codex in this repo, Codex runs with the approval and sandbox mode the user has configured. Nothing in the workflow forces bypass. The known failure of nested Codex inside a sandbox is documented with a fallback.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `AGENTS.md` no longer hard-codes `--dangerously-bypass-approvals-and-sandbox`; delegated runs inherit the user's Codex configuration
- [ ] The workflow states what happens when the user's mode needs approvals while Codex runs unattended, and what Claude does then
- [ ] The nested-Codex failure is documented with its symptoms (`Reconnecting... waiting for network`, `Could not find home directory`) and a fallback: Codex's built-in sub-agents, or Claude doing the work itself
- [ ] Verified by delegating one small task under a sandboxed configuration
