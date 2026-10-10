# 05: Claude Code: prompts that need a person raise the needs-input flag

**What to build:** A user running Claude Code in any permission mode sees the agent waiting exactly when Claude is waiting for them. Decisions made by the `auto` classifier or `dontAsk` are not shown as waiting, and denials show as outcomes.

**Blocked by:** 04

**Status:** resolved

- [x] A person-routed prompt (`PermissionRequest`, `Notification` of type `permission_prompt`, `AskUserQuestion`) shows the agent as waiting in every mode where it occurs
- [x] The `permission_mode` hook field is kept on the agent, so `auto` and `dontAsk` decisions are not shown as waiting
- [x] A denial is recorded as a failed or aborted outcome; when no closing hook arrives, the wait clears on the next event or `Stop`
- [x] A sub-agent's prompt raises the needs-input flag on the sub-agent, and through it on its lead
- [x] Behaviour in bypass mode is unchanged (regression check against the existing fixtures)

## Answer

Events now carry the provider's `permission_mode`, and the reducer keeps it as `AgentState.permissionMode`. It goes through `/events` ingest and the event log, so it survives a restart. The Claude adapter matches each `PermissionRequest` to its open `PreToolUse` by tool and input (`permission-prompts.ts`). A prompted call with no `PostToolUse` when the agent's turn closes (`Stop`, `UserPromptSubmit`, `SubagentStop`, `SessionEnd`) is recorded as a failed `tool_end`. Tests replay the 2.1.296 mode fixtures.

`auto`, `auto-risky`, `dontAsk`, `bypass` and the deny rule never raise the flag. Every person-routed prompt does, including the plan-exit approval and a sub-agent's prompt, which also flags its lead.

Known limit: under `--permission-prompts none` Claude fires `PermissionRequest` although nobody is asked. That shows as waiting for the few milliseconds until `Stop`.
