# Claude Code hook payloads: spike findings

Ticket: `.scratch/mvp-slice/issues/01-payload-dump-spike.md`. Captured 2026-10-08 with Claude Code 2.1.294 on Windows, using `spikes/payload-logger.mjs` wired to 26 hook events through a throwaway repo's project-level `.claude/settings.local.json`. Sanitized fixtures are in `spikes/fixtures/claude-code/` (local paths and username redacted, strings truncated to 300 chars).

Re-run: `node spikes/setup-scratch-repo.mjs <dir>`, set `AGENTARIUM_SPIKE_OUT`, run `claude` in `<dir>`, then `node spikes/sanitize-fixtures.mjs`.

Permission-mode sequences for Claude Code 2.1.296 (every mode, allow/deny, rules, sub-agent prompts) are in `spikes/fixtures/claude-code/modes/`; see [permission-modes.md](permission-modes.md).

## What was captured

Captured, via two headless (`claude -p`) sessions: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse` (Read, Write, Bash, Grep, Agent, ToolSearch), `PermissionRequest` (Bash, WebFetch), `SubagentStart`, `SubagentStop`, `Stop`, `SessionEnd`.

**Interactive follow-up (second capture, `permission_mode: auto`):** `Notification` fired once with `notification_type: "permission_prompt"`, `message: "Claude needs your permission"`, right alongside a `PermissionRequest`. Newer payloads also carry `scratchpad_dir` and, on `SessionStart`, `model`. `idle_prompt` was NOT captured.

**Interactive close-out capture (2026-10-09, `permission_mode: auto`):**
- `Notification` `idle_prompt` (`message: "Claude is waiting for your input"`) fires once, about 60 s after `Stop`, and is not repeated.
- `AskUserQuestion` produces `PreToolUse`, then `PermissionRequest` (carrying the questions in `tool_input`), then `Notification` `permission_prompt` about 6 s later. `PostToolUse` arrives only when the user answers; in this capture that was 704 s later, with no events in between.
- `SubagentStop` with an empty `agent_type` and no prior `SubagentStart` follows some `Stop` events. Its `last_assistant_message` is a short title-like phrase, so these look like internal helper agents. The reducer ignores an `end` for an agent it never saw.
- New events: `ConfigChange` (`source`, `file_path`) and `CwdChanged` (`old_cwd`, `new_cwd`). The adapter ignores both.

**Still not captured:** `Notification` of type `elicitation_dialog`, `Elicitation`, `PostToolUseFailure`, `PermissionDenied`, `TaskCreated/Completed`. Headless mode never fires `Notification`, and a denied permission produced neither `PostToolUseFailure` nor `PermissionDenied`. These need an interactive session, which a script cannot drive. Treat their shape as unverified until someone runs the logger in a real terminal session and leaves a prompt idle for about 60 s.

## Findings

### Common fields
Every payload has `session_id`, `transcript_path`, `cwd`, `hook_event_name`. Most also have `prompt_id`, `permission_mode`, `effort`. `SessionStart`, `SessionEnd` and `UserPromptSubmit` omit some of those. Inside a sub-agent, payloads add `agent_id` and `agent_type`.

### Does SubagentStart carry the spawning tool call id? No.
`SubagentStart` has only `session_id`, `prompt_id`, `agent_id`, `agent_type`. There is no `tool_use_id`. Further:

- `PreToolUse` for the `Agent` tool has `tool_use_id` but no agent id yet.
- `PostToolUse` for `Agent` carries `tool_response.agentId`, which equals the later `agent_id`, plus `tool_use_id`. So the link is exact, but only after the sub-agent finishes.
- For a live parent link, correlate by order: a `SubagentStart` follows the most recent unmatched `Agent` `PreToolUse` in the same session and `prompt_id`. This is ambiguous for parallel Agent calls; resolve it retroactively from `PostToolUse(Agent).tool_response.agentId`.
- Tool calls made inside a sub-agent carry its `agent_id`. `SubagentStop` carries `agent_id` and `agent_transcript_path`.

Consequence for the reducer: `parent_id` for a sub-agent is "inferred" at spawn and "observed" once the `Agent` `PostToolUse` arrives. Payloads without `agent_id` belong to the root agent of the session.

### Which events signal waiting?
- `PermissionRequest` fires when a tool needs approval, and it fires after that tool's `PreToolUse`. It carries `tool_name`, `tool_input`, `permission_suggestions`, but no `tool_use_id`. Match it to the pending call by session, `agent_id` and `tool_name`.
- There is no event for the user's answer in the captured data. In headless mode a denied tool produced no `PostToolUse` and no failure event, so the pending request cleared only on the next event (`PreToolUse` retry) or `Stop`. Clearing the Needs-input flag must therefore also happen on any later event from that agent.
- `Notification` `permission_prompt` and `idle_prompt` are captured (see above). `elicitation_dialog` is documented but not captured.
- A question from Claude (`AskUserQuestion`) is signalled as a `PermissionRequest`, so it raises the Needs-input flag with no special handling.

### Other observations
- `SessionEnd` has `reason` (`other` in headless runs).
- `Stop` carries `last_assistant_message` and `stop_hook_active`. That field holds content and must be dropped before reaching the UI.
- `PostToolUse` has `duration_ms` and a tool-specific `tool_response`. Payloads contain file contents and commands, so the adapter must reduce them to a short summary.
- `ToolSearch` is a tool call like any other; it maps to `search`.
- Each hook invocation is a separate process; the logger exits 0 with no output and did not disturb the session.

## Proposal on the nine action categories

**Freeze the nine** (read, write, exec, search, network, delegate, think, wait, error) with these mappings, verified against real tool names:

| Category | Source |
|---|---|
| read | `Read`, `NotebookRead` |
| write | `Write`, `Edit`, `MultiEdit`, `NotebookEdit` |
| exec | `Bash`, `PowerShell` |
| search | `Grep`, `Glob`, `ToolSearch` |
| network | `WebFetch`, `WebSearch` |
| delegate | `Agent` (the spawning call) |
| think | no tool call between `UserPromptSubmit` and the first `PreToolUse`, or after a `PostToolUse` |
| wait | `PermissionRequest` pending, or `Notification` of type permission/elicitation |
| error | `PostToolUseFailure`, `StopFailure` (not yet captured) |

Amendments to carry into the schema ticket:

1. Unknown tools (MCP tools, `TaskCreate`, future tools) need a default. Proposal: map them to `think` and keep the real tool name in `summary`. Mapping MCP tools (`mcp__server__tool`) to `network` is plausible but unverified.
2. `think` and `wait` are derived by the reducer, not from tool names. Only seven categories come from the tool table.
3. `error` cannot be confirmed from this capture.

No new categories are needed.
