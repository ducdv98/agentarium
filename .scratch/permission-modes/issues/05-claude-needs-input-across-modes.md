# 05: Claude Code: prompts that need a person raise the needs-input flag

**What to build:** A user running Claude Code in any permission mode sees the agent waiting exactly when Claude is waiting for them. Decisions made by the `auto` classifier or `dontAsk` are not shown as waiting, and denials show as outcomes.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] A person-routed prompt (`PermissionRequest`, `Notification` of type `permission_prompt`, `AskUserQuestion`) shows the agent as waiting in every mode where it occurs
- [ ] The `permission_mode` hook field is kept on the agent, so `auto` and `dontAsk` decisions are not shown as waiting
- [ ] A denial is recorded as a failed or aborted outcome; when no closing hook arrives, the wait clears on the next event or `Stop`
- [ ] A sub-agent's prompt raises the needs-input flag on the sub-agent, and through it on its lead
- [ ] Behaviour in bypass mode is unchanged (regression check against the existing fixtures)
