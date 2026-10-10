# 07: Codex approvals and tool outcomes from the live connection

**What to build:** Where a supported Codex client connection exists, a pending approval shows the agent as waiting on the user, and a tool call's result shows as success or failure. Hook-only fidelity is kept as the fallback.

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] A pending human approval shows the agent as waiting on the user
- [ ] A resolved approval clears the wait; the tool's execution state is handled as the spec's gap notes describe
- [ ] A tool result shows success or failure, with unknown outcomes recorded as unknown, not as success
- [ ] Without a live connection, the adapter falls back to hook-only behavior and says so in the UI or logs
