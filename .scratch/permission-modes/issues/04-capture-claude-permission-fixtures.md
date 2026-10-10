# 04: Record Claude Code fixtures in each permission mode

**What to build:** Recorded Claude Code 2.1.296 hook payloads in every permission mode, so the adapter can tell a person-routed prompt from an automatic decision and can see denials.

**Blocked by:** 01

**Status:** resolved

- [x] Headless (`-p`) captures in `manual`, `acceptEdits`, `plan`, `auto`, `dontAsk`, and `bypassPermissions`, plus an `ask` rule and a `deny` rule
- [x] Interactive captures through a human-in-the-loop script: approve, deny, Esc, `AskUserQuestion`, plan-mode exit approval, a sub-agent's permission prompt, and an elicitation where reachable
- [x] `PermissionDenied`, `PostToolUseFailure`, and `Notification` types are recorded wherever they fire, or recorded as not firing
- [x] Hooks are supplied through `--settings` or an isolated config dir in a scratch repo; the user's real Claude settings are checked unchanged afterwards
- [x] Fixtures are sanitized and sit beside the existing Claude Code payloads, and the research doc's "needs human capture" list is updated

## Answer

Headless sequences for 2.1.296 are in `spikes/fixtures/claude-code/modes/`, recorded with `spikes/claude/capture-headless.mjs`. That script answers prompts over the stdio control protocol, so allow and deny were scripted. Findings are in [permission-modes.md](../../../docs/research/permission-modes.md#claude-code-2196-headless-fixtures).

Every mode was captured, plus an `ask` rule, a `deny` rule, a failing tool, sub-agent allow and deny, and the plan-exit approval (`PermissionRequest(ExitPlanMode)`). `PermissionDenied` never fired. `PostToolUseFailure` fires only for a tool that ran and failed, never for a denial.

The interactive TUI cases (deny, Esc, Notification timing, AskUserQuestion, an elicitation) have a human-in-the-loop script, `spikes/claude/capture-interactive.mjs`, which has not been run yet. `~/.claude/settings.json` was not modified (mtime predates the captures). One plan file that a capture wrote into `~/.claude/plans/` was removed.
