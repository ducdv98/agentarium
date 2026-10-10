# 08: Claude Code: a denial in the TUI ends the wait

**What to build:** When the user answers a Claude Code permission prompt with No or Esc in the interactive UI, the agent stops showing as waiting and the call is recorded as a failed outcome. This must not depend on the user typing another prompt.

**Blocked by:** None (can start immediately)

**Status:** resolved

Evidence: `spikes/fixtures/claude-code/modes/tui-deny.json` and `tui-esc.json`. After the `PermissionRequest` no hook fires at all; only the next `UserPromptSubmit` closes the call (ticket 05 behaviour). The transcript (`transcript_path`, on every payload) records the rejection right away: a user entry with a `tool_result` for the same `tool_use_id`, `toolUseResult: "User rejected tool use"`, then `[Request interrupted by user for tool use]`.

- [x] While a Claude agent is waiting on a prompt, the daemon detects the rejection in the transcript (bounded tail read, only `tool_result` ids and the rejection marker; no prompt or tool content is kept) and emits a failed `tool_end` plus `stop`
- [x] An approved prompt is unaffected; an answered `AskUserQuestion` is not mistaken for a rejection
- [x] Only transcript paths that look like Claude session transcripts are read
- [x] Tested against the `tui-deny`, `tui-esc` and `tui-idle-prompt` fixtures plus a transcript excerpt fixture

## Answer

The Claude adapter keeps the transcript path of each open root-agent prompt. It exposes them through `waitingPrompts()`, and `reject()` turns one into a failed `tool_end` followed by `stop`. The tracker forgets an entry when its call finishes, closes, or its session ends.

While any prompt is open, the daemon polls those transcripts (`transcriptPollMs`, default 1 s). It uses `readClaudeRejections` in `packages/server/src/claude-transcripts.ts`, which:
- reads only `<config>/projects/<slug>/<session-uuid>.jsonl` regular files;
- reads a bounded 256 KiB tail, through the `tail.ts` helper now shared with the Codex rollout reader;
- matches only a `tool_result` that has `is_error` for a waiting id and `toolUseResult: "User rejected tool use"`.

`close()` waits for a poll already in flight. Sub-agent prompts are not polled: their payload names only the parent's transcript, and they already close at `SubagentStop`.

Tests: transcript excerpts made with `spikes/claude/extract-transcript.mjs` (deny, Esc, approved, answered AskUserQuestion), adapter tests on `tui-*`, and a daemon integration test where the agent goes from waiting to idle with no further hook. Reviewed by Codex on both axes. Fixed from the review: the path layout check, regular files only, close awaiting the poll, and map pruning. Not changed: async reads (each read is bounded and happens only while a prompt is open).
