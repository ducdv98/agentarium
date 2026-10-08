# Dump real Claude Code hook payloads

Status: resolved
Type: task
Blocked by: none

Write a small Node logger in `spikes/` and run it from a throwaway project-level `.claude/settings.local.json` in a scratch repo (never edit user-level config). Capture a session with tool use, a sub-agent, a permission request and an idle prompt.

Acceptance:
- Payload fixtures saved, secrets stripped.
- Answers: does SubagentStart carry the spawning tool call id? Which events signal waiting?
- Proposal to freeze or amend the nine action categories.

## Comments

## Answer

Findings, fixtures and the category proposal are in `docs/research/hook-payloads.md`; fixtures in `spikes/fixtures/claude-code/`.

- `SubagentStart` does not carry the spawning tool call id. The link comes from `PostToolUse(Agent).tool_response.agentId` (exact, after the fact) or ordering by `prompt_id` (live, ambiguous when parallel).
- Waiting signals: `PermissionRequest` (no `tool_use_id`) is confirmed. `Notification` types were not captured: headless mode never fires them. Gap remains until someone captures an interactive session.
- Proposal: freeze the nine categories; only seven come from the tool table, `think` and `wait` are reducer-derived.
