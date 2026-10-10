# Codex event gaps: decisions

Decided 2026-10-10 for Phase 2 (ticket 09). This document records decisions and changes no schema. Each gap comes from [codex-event-mapping.md](codex-event-mapping.md#gaps-where-codex-has-no-equivalent). The evidence comes from the Codex CLI 0.160.0 captures in [codex-captures.md](codex-captures.md) (fixtures in [`spikes/fixtures/codex/`](../../spikes/fixtures/codex/)) and from how the adapter behaves (`packages/adapters/src/codex.ts`, `codex-live.ts`).

## Codex-side gaps

| # | Gap | Verdict | Settled by |
|---|---|---|---|
| 1 | No Claude-style `Notification` hook | **Confirmed.** It causes no harm. | `hooks/list` reports the twelve events in the enum and no `Notification`. In every fixture a finished turn sends `Stop` and the adapter shows idle, not waiting (`exec-fail`, `tui`). |
| 2 | No dedicated failure or denial hooks | **Confirmed**, and it is wider than the research expected | `patch-fail`, `mcp` (`fx_fail`), `approve-decline`, `approve-cancel` and `interrupt` send no `PostToolUse`. `exec-fail` and `sandbox-deny` do send `PostToolUse`, but the response is only output text with no exit code. The live connection (`item/completed.status`) and OTel (`tool_result.success: "false"`) recover these outcomes. |
| 3 | No hook feed for hosted tools | **Not reproduced** | `web`: hosted web search and page open both send `PreToolUse` and `PostToolUse` as tool `webrun`, and the adapter maps them to `network`. |
| 4 | No durable record of approval or user-input starts in rollout JSONL | **Confirmed** | The rollouts behind `approve-accept`, `approve-decline` and `tui` hold `session_meta`, `turn_context`, `response_item`, and `event_msg` records (`task_started`, `item_completed`, `task_complete`, `turn_aborted`). None of them is an approval or permission request. Rollouts are used for identity only, never for waits. |
| 5 | No permanent sub-agent end hook | **Confirmed** | `subagents`: each sub-agent sends `SubagentStart` and `SubagentStop`, and nothing marks a permanent end. `collaborationinterrupt_agent` returns the child's last status and does not end it. |
| 6 | No ambient public event bus | **Not reproduced for TUI sessions. Confirmed for `codex exec`** | `tui`: a second client on the shared app-server daemon's control socket received the pending approval, its resolution, and item outcomes. `codex exec` runs outside the daemon, so those sessions are hook-only. |

## Agentarium-side decisions

### Neutral resume / input-resolved event: **no**

The live connection does not need it. On `serverRequest/resolved` the live mapper sends the tool's `tool_start` again with the same id, tool and category. The reducer then shows the agent working on that tool, with its other pending calls kept, which is the state a neutral resume event would have produced. A decline is followed at once by `item/completed` with `status: declined`, which becomes `tool_end ok: false`.

Hook-only sessions are covered as well. After an accept, the next hook is `PostToolUse` (`approve-accept`, `tui`), so the wait clears when the tool finishes. After a decline or cancel, the wait lasts until the model's next tool or the turn's `Stop` or `Interrupt`. That is a few seconds in the captures.

Revisit this if usage-log entries show stale waiting states, for example a user-input or elicitation request with no tool item to restart.

### Standalone error event: **no**

The `error` category still comes only from a failed `tool_end`, and turn-level failures map to `stop`. No capture produced a turn failure (`turn/completed` with `status: failed`, or `exec` `turn.failed`). Interrupts and cancels finish as `stop` (`interrupt`, `approve-cancel`). Every tool failure in the fixtures maps to an existing failed `tool_end` once the live connection or OTel is present. No capture shows a case that needs a new event, so there is nothing to add yet.

### Sub-agent termination: **accept lost-timeout cleanup**

The other option is to use live shutdown outcomes. It was not chosen, because no capture showed a live notification meaning "this sub-agent is gone for good": `thread/closed` reports that the observer's subscription closed. The adapter does this instead:

- `SubagentStop` and a live `turn/completed` mark the sub-agent idle (`stop`), because it can be given more input.
- The root's `SessionEnd` ends every sub-agent the adapter tracked for that session.
- Any other sub-agent that goes silent becomes lost through the existing timeout (`lostMs`, 10 minutes) and leaves the scene.

Revisit this if a later Codex version adds a permanent shutdown signal for sub-agents.

## Follow-ups

None of these decisions changes the schema, so no follow-up ticket is needed. The two "revisit" conditions above are the triggers to watch for in the usage log.
