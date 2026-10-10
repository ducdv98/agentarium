# 04: Record Claude Code fixtures in each permission mode

**What to build:** Recorded Claude Code 2.1.296 hook payloads in every permission mode, so the adapter can tell a person-routed prompt from an automatic decision and can see denials.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Headless (`-p`) captures in `manual`, `acceptEdits`, `plan`, `auto`, `dontAsk`, and `bypassPermissions`, plus an `ask` rule and a `deny` rule
- [ ] Interactive captures through a human-in-the-loop script: approve, deny, Esc, `AskUserQuestion`, plan-mode exit approval, a sub-agent's permission prompt, and an elicitation where reachable
- [ ] `PermissionDenied`, `PostToolUseFailure`, and `Notification` types are recorded wherever they fire, or recorded as not firing
- [ ] Hooks are supplied through `--settings` or an isolated config dir in a scratch repo; the user's real Claude settings are checked unchanged afterwards
- [ ] Fixtures are sanitized and sit beside the existing Claude Code payloads, and the research doc's "needs human capture" list is updated
