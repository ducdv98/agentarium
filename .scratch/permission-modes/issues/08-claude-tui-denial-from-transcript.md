# 08: Claude Code: a denial in the TUI ends the wait

**What to build:** When the user answers a Claude Code permission prompt with No or Esc in the interactive UI, the agent stops showing as waiting and the call is recorded as a failed outcome. This must not depend on the user typing another prompt.

**Blocked by:** None (can start immediately)

**Status:** needs-triage

Evidence: `spikes/fixtures/claude-code/modes/tui-deny.json` and `tui-esc.json`. After the `PermissionRequest` no hook fires at all; only the next `UserPromptSubmit` closes the call (ticket 05 behaviour). The transcript (`transcript_path`, on every payload) records the rejection right away: a user entry with a `tool_result` for the same `tool_use_id`, `toolUseResult: "User rejected tool use"`, then `[Request interrupted by user for tool use]`.

- [ ] While a Claude agent is waiting on a prompt, the daemon detects the rejection in the transcript (bounded tail read, only `tool_result` ids and the rejection marker; no prompt or tool content is kept) and emits a failed `tool_end` plus `stop`
- [ ] An approved prompt is unaffected; an answered `AskUserQuestion` is not mistaken for a rejection
- [ ] Only transcript paths that look like Claude session transcripts are read
- [ ] Tested against the `tui-deny`, `tui-esc` and `tui-idle-prompt` fixtures plus a transcript excerpt fixture
