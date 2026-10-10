# 05: Capture live Codex fixtures

**What to build:** Recorded Codex CLI payloads, pinned to a specific CLI version, covering the cases the mapping research could not verify from source: root, child and grandchild sessions, failed and denied tools, and approvals. These fixtures are the basis for the Codex adapter and for the gap decisions in ticket 09.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The Codex CLI version is pinned and recorded with the fixtures
- [ ] Payloads for root, child and grandchild sessions are captured, with `session_id` meaning established
- [ ] Failed exec, denied or aborted approval, patch failure, MCP `isError`, and long-running exec completion are captured
- [ ] It is recorded which paths emit `PostToolUse`, and which response fields establish success
- [ ] Each open question 1–4 in `docs/research/codex-event-mapping.md` is answered or marked unresolved
