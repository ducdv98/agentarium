# 05: Capture live Codex fixtures

**What to build:** Recorded Codex CLI payloads, pinned to a specific CLI version, covering the cases the mapping research could not verify from source: root, child and grandchild sessions, failed and denied tools, and approvals. These fixtures are the basis for the Codex adapter and for the gap decisions in ticket 09.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] The Codex CLI version is pinned and recorded with the fixtures
- [x] Payloads for root, child and grandchild sessions are captured, with `session_id` meaning established
- [x] Failed exec, denied or aborted approval, patch failure, MCP `isError`, and long-running exec completion are captured
- [x] It is recorded which paths emit `PostToolUse`, and which response fields establish success
- [x] Each open question 1–4 in `docs/research/codex-event-mapping.md` is answered or marked unresolved

**Known limits:** only Codex CLI 0.160.0 was captured, so the minimum released version is still open. File-change approvals, `request_permissions`, `request_user_input`, MCP elicitation and auto-review were not captured. OTel was not captured. Findings: `docs/research/codex-captures.md`. Fixtures: `spikes/fixtures/codex/`.

## Comments

**Agent decision (2026-10-10), please review:** the capture `CODEX_HOME` marks the hooks trusted by writing `[hooks.state."<key>"] trusted_hash` into its own throwaway `config.toml`, using the hashes from app-server `hooks/list`. This is acceptable for an isolated test home. For the real install (ticket 06), Agentarium should **not** write `trusted_hash` into the user's `~/.codex/config.toml`, because that would skip Codex's own hook review. The user trusts the hooks once in Codex instead.

**Agent note:** the capture used the existing ChatGPT login, copied into the isolated home's `auth.json`. The runs cost about 20 short model turns.
