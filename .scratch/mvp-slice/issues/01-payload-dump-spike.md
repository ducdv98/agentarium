# Dump real Claude Code hook payloads

Status: ready-for-agent
Type: task
Blocked by: none

Write a small Node logger in `spikes/` and run it from a throwaway project-level `.claude/settings.local.json` in a scratch repo (never edit user-level config). Capture a session with tool use, a sub-agent, a permission request and an idle prompt.

Acceptance:
- Payload fixtures saved, secrets stripped.
- Answers: does SubagentStart carry the spawning tool call id? Which events signal waiting?
- Proposal to freeze or amend the nine action categories.

## Comments
