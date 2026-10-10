# Codex CLI event mapping

Research date: 2026-10-10. Read-only research; this report is the only repository change.

Evidence: official OpenAI documentation and source from [openai/codex at `c3d3b142d10f4316b46e35aad7e5317e7e506cb7`](https://github.com/openai/codex/tree/c3d3b142d10f4316b46e35aad7e5317e7e506cb7). This is a source snapshot of `main`, not a claim that every released or installed CLI supports these features. No live Codex payload capture was performed. Source schemas establish fields; proposed adapter behavior below still needs runtime fixtures.

Repository contract: [CONTEXT.md](../../CONTEXT.md), [ADR 0003](../adr/0003-event-sourced-core-with-pure-reducer.md), [ADR 0004](../adr/0004-theme-neutral-core-with-closed-action-categories.md), [Claude hook findings](hook-payloads.md), and [event-source research](event-sources.md). The actual schema is [packages/core/src/types.ts](../../packages/core/src/types.ts), rather than a root `src/core` directory. [The reducer](../../packages/core/src/reducer.ts) determines the resulting state and category. The earlier Codex entry in event-sources.md was based on search summaries; the source verification here supersedes its unverified details.

## Codex signals

### Lifecycle and tool hooks

The source's `HookEventName` enum contains twelve events: `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `SubagentStart`, `SubagentStop`, `Stop`, `Interrupt`, `PreCompact`, and `PostCompact`. It has no `Notification`, `PostToolUseFailure`, `PermissionDenied`, or `StopFailure` hook. [Hook enum][protocol]

Hooks are discovered beside active config layers, including user `~/.codex/hooks.json`, inline hooks in `~/.codex/config.toml`, and trusted project `.codex/` equivalents; enabled plugins can contribute hooks too. Non-managed definitions require trust review, separate from ordinary command approval. Multiple matching command handlers launch concurrently. Command handlers receive JSON on stdin; supported MCP handlers offer another delivery route. Use one observer registration to avoid duplicate ingestion. [Official hook documentation][hooks-doc]

The generated input schemas supply the precise wire contract. Shared fields include `session_id`, nullable `transcript_path`, `cwd`, and `hook_event_name`; most relevant hooks also expose model, permission mode, and `turn_id`. Tool hooks carry `tool_name`, `tool_input`, and, for pre/post hooks, `tool_use_id`. Post hooks add an unconstrained `tool_response`, with no common `ok` field. `PermissionRequest` omits `tool_use_id`. Normal hooks inside thread-spawned sub-agents can carry `agent_id` and `agent_type`. [Generated schemas][hook-schemas], [post-tool serializer][post-tool]

Canonical shell hook name is `Bash`, including unified `exec_command`. `apply_patch` matches aliases `Edit` and `Write` but keeps its canonical name in the payload. `spawn_agent` also matches `Agent`. Local function and MCP calls are covered; hosted tools such as web search bypass this hook path. A later `write_stdin` poll can deliver the original command's post hook; it does not start another pre hook for that existing command. [Official tool coverage][hooks-doc], [pre-tool implementation][pre-tool]

Important timing limits:

- `PermissionRequest` runs before approval is resolved; another hook or policy can decide without presenting a user prompt. It is evidence of a pending approval path, not proof the user is being asked.
- `Stop` and `SubagentStop` are completion checks that can request continuation. An observer sees an attempted stop before the combined hook result is known.
- `SessionEnd` applies to the main thread, not sub-agents. The inspected input schema has reason `other`; abrupt process loss cannot guarantee this hook.
- `Interrupt` is main-thread only.
- `SessionStart` may run after compaction. The source schema also accepts `fork`, beyond the source values listed in the prose documentation. Neither a compaction start nor a fork automatically means a new spawning relationship.

These distinctions follow the [event schemas][hook-schemas] and [stop implementation][stop-source]; permanent sub-agent termination must be confirmed separately.

### Legacy notify and terminal notifications

Top-level `notify = ["program", "..."]` invokes an external program with JSON appended as its **last argv argument**, not stdin. The inspected implementation only supports `type: "agent-turn-complete"`. Payload fields are kebab-case: `thread-id`, `turn-id`, `cwd`, optional `client`, `input-messages`, and nullable `last-assistant-message`. The program is spawned without waiting for delivery completion; its standard streams are discarded. This is turn completion, not permanent session termination. [Legacy notify implementation][notify-source]

`tui.notifications` can include `approval-requested`, but terminal notifications are presentation signals (OSC/BEL), with focus/visibility settings. They do not extend the external notify JSON contract and should not be parsed as a structured adapter feed. [TUI notification documentation][config-doc]

### Rollout/session JSONL files

Local rollout recording uses `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<timestamp>-<thread-id>.jsonl` (default home `~/.codex`) and an `archived_sessions` area. Prefer an observed transcript path or discovered metadata over constructing filenames; reverted threads can have another rollout suffix. Recording is queued, can be materialized lazily, and flush timing is not a live-delivery guarantee. [Recorder][recorder], [directory constants][rollout-lib]

Tagged records include `session_meta`, `response_item`, `event_msg`, `turn_context`, and `compacted`, plus additional internal record types. Response items can contain function/custom tool calls and outputs, tool search, web search, and reasoning. Session metadata includes thread ID, root `session_id`, optional immediate `parent_thread_id`, cwd, CLI version, and source classification. Older thread-spawn source metadata also identifies a parent thread. [Rollout wire format][rollout-wire], [session/source metadata][protocol], [response-item definitions][models]

**A protocol event's existence does not mean it reaches a rollout file.** The persistence policy drops live execution begin/end events, approval requests, user-input requests, elicitation requests, tool begins, collaboration begin/end events, shutdown, errors, and deltas. Both history modes retain turn start/complete/abort events. Legacy history retains selected legacy completions; paginated history retains completed typed items instead. Some calls/outputs remain discoverable through response items, but they cannot reconstruct every live pause or execution interval. [Persistence policy][rollout-policy]

A tailer therefore needs explicit history-mode/version handling, complete-line buffering, archive/revert handling, and deduplication between response items and completed items. Logs are useful for recovery and topology, not sufficient for triage.

### OpenTelemetry

OTel export is opt-in under `[otel]`; exporters include `none`, `otlp-http`, and `otlp-grpc`, with separate trace-export configuration in source. Logs include conversation identity and version/model metadata. Verified activity signals include `codex.conversation_starts`, `codex.user_prompt`, `codex.tool_decision`, `codex.tool_result`, and API/SSE/WebSocket diagnostics. `tool_decision` exposes tool name, `call_id`, decision, and optional source; `tool_result` exposes tool name, `call_id`, duration, success, and a result sequence. [Telemetry implementation][telemetry], [shared metadata][otel-shared], [export configuration][otel-config], [tool-result emission][tool-result]

`log_user_prompt = false` redacts user prompt text; it is not universal content redaction. Tool-result diagnostic logs can contain arguments and output previews. Reduce all inputs to allowlisted identifiers and short summaries before daemon/UI ingestion. Trace-safe metadata has different content fields from diagnostic logs. Metrics aggregate counts/durations and cannot by themselves reconstruct per-agent events. [Prompt logging][telemetry], [tool-result fields][tool-result]

OTel decisions are **outcomes**, not an approval-prompt-start feed. API transport events describe model communication, not an agent performing a network tool action. Export batching and missing events limit live timing.

### Live protocol, approval events, and exec JSON output

The internal protocol defines paired `ExecCommandBegin/End`, patch/MCP/web-search begin/end, collaboration events, and `ExecApprovalRequest`, `ApplyPatchApprovalRequest`, `RequestPermissions`, `RequestUserInput`, and `ElicitationRequest`. Exec events carry `call_id`, turn ID, command, cwd, parsed command information, optional process ID, and completion status/exit code. These are live runtime signals, not an ambient subscription API for every unrelated CLI process. [Protocol events][protocol], [approval event structures][approvals]

For a client controlling a Codex app-server connection, the public protocol exposes `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `item/tool/requestUserInput`, `mcpServer/elicitation/request`, and `serverRequest/resolved`. Requests/resolution can establish genuine user-wait intervals when routed to a human. Connecting to a different server does not establish visibility into an existing CLI's pending approvals. [App-server method declarations][app-protocol]

`codex exec --json` emits stdout JSONL: `thread.started`, `turn.started`, `turn.completed`, `turn.failed`, `item.started`, `item.updated`, `item.completed`, and `error`. Typed items include command execution, file change, MCP calls, collaboration calls, web search, reasoning, messages, and todo lists. Command items expose status and nullable exit code; file changes can be completion-only. This stream projects app-server notifications and omits many other notification kinds, including dedicated approval requests; it is not a dump of the internal protocol. [Exec event schema][exec-events], [JSON event projection][exec-json]

## Mapping table

### AgentEvent contract and identity

Every emitted adapter record uses `schema_version: 1` and `agent: { machine, provider, session, agent }`; proposed provider is `codex`. The adapter emits `NewEvent`; the daemon assigns `ts` in milliseconds. Source timestamps, turn IDs, cwd, raw payloads, process IDs, and diagnostics belong in adapter bookkeeping because this AgentEvent union does not expose them.

Use Codex's root session ID for `AgentRef.session`, `root` for the root agent, and child thread/agent IDs for sub-agents. Current session metadata provides root session and immediate parent IDs; reconcile hook, OTel conversation/thread, and rollout identities through that registry. A hook's `session_id` refers to its parent session context, so do not assume it alone identifies the ultimate root or immediate spawning agent at every nesting depth. Missing lineage requires explicit inference, not silently treating every thread as a root. [Schema](../../packages/core/src/types.ts), [session metadata][protocol], [hook schemas][hook-schemas]

The category column describes the reducer's resulting category unless a tool-start category is specified. Lifecycle events have no category field. `think` and user `wait` arise through reducer transitions; errors arise from `tool_end(ok: false)`. There is no `thinking`, `message`, `error`, or `approval_resolved` event kind despite the older illustrative event-sources.md example.

### Hook signals

| Codex signal | AgentEvent mapping | Category or gap |
|---|---|---|
| SessionStart, first observation/start/resume | `session_start` on root | Idle, category null. Avoid replaying onto an already working agent. |
| SessionStart after compact | No event by default | Maintenance; emitting session_start would incorrectly set idle. |
| UserPromptSubmit | `prompt`; discard prompt content | Derived `think`; clears pending tools, so only once per actual new turn. |
| PreToolUse | `tool_start`, ID from tool_use_id, canonical tool name, allowlisted summary | Tool category from table below. |
| PostToolUse | `tool_end`, same tool_use_id; decode tool-specific response for ok | Success resumes pending category or derived `think`; failure gives `error`/blocked. No universal success field: unknown outcome is a gap, not proof of success. |
| PermissionRequest | Candidate `needs_input`, after confirming human routing; match pending call by agent/turn/tool | Derived `wait`. No call ID; overlapping same-tool approvals can be ambiguous. Hook/policy decisions can make a hook-only wait transient or false. |
| SubagentStart | `spawn`, agent=child, parent=resolved immediate spawning agent, provenance observed or inferred | Child begins in derived `think`; parent's spawn tool is `delegate`. Hook alone lacks explicit immediate-parent/spawning-call fields. |
| Stop | Provisional `stop`; prefer confirmed turn completion | Idle/null. Other hooks can continue the turn. |
| SubagentStop | Provisional child `stop`, then confirm turn outcome | Idle/null. Do not translate directly to permanent `end`; child can continue or receive more input. |
| SessionEnd | Root `end` | Done/null; no sub-agent equivalent hook. |
| Interrupt | `stop` for interrupted root turn | Idle/null. Cancellation reason is lost; use confirmed runtime abort when available. |
| PreCompact / PostCompact | Ignore for v1; retain diagnostic bookkeeping | No schema equivalent; keep current activity rather than injecting a fake prompt/tool. |

Sources: [generated hook inputs][hook-schemas], [stop/continuation behavior][stop-source], [pre/post tool behavior][pre-tool], [post-tool serializer][post-tool].

### Tool categories (ADR 0004)

| Codex tool/activity | AgentEvent mapping | Category or gap |
|---|---|---|
| Shell/Bash/exec_command | `tool_start/end`, correlated by call ID | `exec` by default, including PowerShell execution. |
| A shell command positively classified as reading a file or local search/listing | Same pair; optional versioned classifier using parsed command metadata | `read` or `search`; inference, not a Bash hook category. Complex scripts remain `exec`. |
| apply_patch (Edit/Write aliases) | `tool_start/end` | `write`; use canonical name to prevent duplicates. |
| view_image or explicitly known file/resource read | `tool_start/end` | `read`. |
| tool discovery/tool search; explicitly known local search tools | `tool_start/end` when exposed | `search`; no universal dedicated hook for hosted paths. |
| Hosted web search/open/find | Live web item/begin-end or rollout call/completion -> `tool_start/end` | `network`, consistent with the existing Claude WebSearch mapping. Local search remains `search`. |
| spawn_agent / send_input / close_agent / resume_agent / collab calls | `tool_start/end`; successful creation additionally emits child `spawn` | `delegate`; closing confirms child `end` only when termination is observed. |
| wait for sub-agents | `tool_start/end` | `delegate` proposed for v1. Setting tool category wait is allowed by the type but breaks the documented derived-category convention; never emit needs_input. |
| update_plan and unknown local/MCP tools | `tool_start/end` if a call is observed; preserve tool name | Proposed fallback `think`, following hook-payloads.md; no new category. |
| Known MCP file/search/network/delegation tools | `tool_start/end` with allowlisted capability mapping | `read/write/search/network/delegate` as appropriate. MCP transport alone does not imply network work. |
| Local image-generation tool or other uncovered activity | Actual tool pair, if exposed | Semantic category uncertain; proposed unknown-tool fallback `think`. Generated artifacts alone do not prove a file write. |
| request_user_input / elicitation requiring a human answer | Tool pair if observed, plus `needs_input` for confirmed user request | Derived `wait`; hook coverage alone needs verification. |

Tool classification is an adapter proposal, not a claim that Codex emits ADR categories. Sources: [tool hooks][hooks-doc], [exec/protocol metadata][protocol], [exec typed items][exec-events], [response tools][models].

### Other observation surfaces

| Codex signal | AgentEvent mapping | Category or gap |
|---|---|---|
| notify agent-turn-complete | `stop` on thread resolved through identity registry | Idle/null. No prompt, tool, approval-start, or permanent-end coverage. |
| TUI approval-requested | No direct mapping from terminal escape/bell | Structured identity/payload gap; use hook or live approval request. |
| Rollout session_meta / OTel conversation_starts / exec thread.started | First observation -> `session_start`; known child metadata -> observed `spawn` | Idle/null for root; derived `think` for child. Resume/deduplication matters. |
| Rollout turn_started / OTel user_prompt / exec turn.started | `prompt` once per turn | Derived `think`. User messages and turn starts are alternate signals, not multiple prompts. |
| Response function/custom/local-shell calls and corresponding outputs | `tool_start/end` with call_id and tool-specific outcome parser | Tool category; file-tail timing approximates observation, not actual start time. |
| Completed rollout items / exec item.completed without a start | Completion-only evidence; optionally reconstruct a synthetic start immediately before end | Loses interval fidelity; successful orphan tool_end alone would spuriously set `think`. |
| Rollout turn_complete / successful exec turn.completed | `stop` | Idle/null; turn_complete can carry an error, so inspect outcome. |
| Rollout turn_aborted | `stop` for cancellation, with diagnostic reason outside AgentEvent | Idle/null; terminal errors remain a schema gap. |
| Live ExecCommandBegin/End or exec command item start/completion | `tool_start/end`, call_id or stream item.id | `exec` by default; ok from terminal status and exit code, not merely item.completed. |
| Live patch/MCP/web begin/end or matching exec items | `tool_start/end`, outcome from success/status/result | `write`, mapped MCP category, or `network`. |
| Live CollabAgentSpawnEnd / exec successful spawn_agent item with receiver IDs | Observed child `spawn` with sender as parent, plus parent tool_end | Child `think`, parent `delegate`; failed spawn produces no child. |
| Live collab child completed / closed / errored status | Completed turn -> child `stop`; confirmed shutdown -> child `end`; standalone error -> gap | Do not equate completed with shutdown. |
| Live ExecApprovalRequest / ApplyPatchApprovalRequest / RequestPermissions; public requestApproval methods | Human-routed request -> `needs_input` | Derived `wait`; auto-review is not user waiting. Correlate approval_id as well as item/call ID. |
| Live RequestUserInput / ElicitationRequest; public requestUserInput / elicitation methods | `needs_input` when awaiting a person | Derived `wait`; prompt content is discarded. |
| Approval RPC reply / serverRequest/resolved | Track resolution in adapter; resume on genuine subsequent tool activity | No exact AgentEvent for clearing needs_input while preserving pending tools. Resolution alone is not tool completion. |
| OTel tool_decision approved | Correlate decision; no event by default | No approval-wait-start or neutral resume equivalent; not proof execution has begun. |
| OTel tool_decision denied/abort | Confirm terminal call failure before `tool_end(ok: false)` | Derived `error`; another policy retry may follow. |
| OTel tool_result | `tool_end`, call_id, ok=success | Derived `think`/remaining tool category or `error`. No start signal or latency-accurate interval by itself. |
| OTel API/SSE/WebSocket/startup/cost/usage/sandbox diagnostics and metrics | Ignore as direct AgentEvents; retain separate diagnostics as needed | Model transport is not `network` tool work; retry errors are not automatically blocked agents. |
| Reasoning/message deltas, reasoning items, todo-list updates | No exact event mapping; retain existing state | `think` intent is visible, but no non-resetting activity/heartbeat kind. Do not inject prompt to refresh activity. |
| exec turn.failed / error / error item; live Error | No exact standalone-error mapping | `error` category exists, but requires a failed tool_end in current reducer. Do not invent a failed tool. Warnings projected as error items may be nonfatal. |
| Live ShutdownComplete / confirmed owning exec process exit | `end` when session lifetime is actually over | Done/null; exiting a client attachment may leave a server-owned thread alive. |
| Silent/crashed process, missing end | Daemon-generated `tick` and configured timeouts | Derived lost; never forge observed end. |

Sources: [notify][notify-source], [rollout persistence][rollout-policy], [internal protocol][protocol], [approvals][approvals], [public methods][app-protocol], [OTel][telemetry], [tool results][tool-result], [exec projection][exec-json].

For paired tools, use one authoritative surface and keep provider call IDs as adapter keys. Exec item IDs are projection IDs and must not be assumed identical to hook tool_use_id. Do not ingest every surface as independent events: duplicate prompt/session-start/stop records can clear pending work or regress state. A tool_end for a failed call puts the reducer in blocked/error; nonzero exits used intentionally for search or tests require an explicit adapter policy.

## Gaps where Codex has no equivalent

Distinguish absent Codex signals from signals that exist but cannot be represented by today's AgentEvent.

1. **No Claude-style Notification hook.** The inspected hook enum has no structured idle_prompt, permission_prompt, or elicitation_dialog notification. A completed turn maps to idle via stop; it should not raise needs-input merely because another prompt could be supplied. External notify only covers turn completion.
2. **No dedicated failure/denial hooks.** There is no PostToolUseFailure, PermissionDenied, or StopFailure. Tool-specific post responses, OTel success/decisions, and live protocol outcomes can recover some failures. Hook-only failure and denial coverage must be captured rather than assumed.
3. **No complete hook feed for hosted tools.** Hosted web search bypasses local pre/post hooks. A hook-only adapter can show thinking while network work occurs; live items are needed for exact coverage.
4. **No durable approval/user-input-start equivalent in rollout JSONL.** Requests are explicitly filtered out of persistence. Completed calls or text resembling a question cannot establish a live user-wait interval.
5. **No permanent sub-agent-end hook equivalent.** SubagentStop is a continuable completion check; SessionEnd excludes sub-agents. Confirm termination using live shutdown/close outcomes or accept lost-timeout cleanup.
6. **No general ambient public event bus established by these sources.** Exec JSON and app-server events expose runs/connections under the observer's control. They do not prove that a separate observer can attach to every already-running CLI. Hooks remain the clearest way to instrument those CLI sessions.

Agentarium-side gaps:

- There is no neutral approval-resolved/resume event. prompt clears pending tools, tool_start needs a real start, and tool_end means completion; none exactly clears user wait while preserving execution state.
- There is no standalone error, non-resetting activity heartbeat, maintenance/compaction, cancellation reason, or explicit non-user-wait event.
- Nested parent identity is recoverable from current metadata/live collaboration, but hooks alone lack immediate-parent/call correlation. The core only models spawned_by; Codex communication does not automatically become a new spawning relationship.
- The daemon stamps ingestion time. Replaying historical source data as fresh live activity can create false current work; recovery needs a deliberate policy.
- Generic tool success and shell semantic classification require provider-specific parsing. Neither tool_response nor MCP transport determines an ADR category by itself.

**Conclusion:** the closed nine categories cover the observed activity with conservative fallbacks. No tenth category is justified. The meaningful limitations are event semantics and source coverage. Proposed first adapter: trusted lifecycle/tool hooks, with live app-server approval/tool outcomes where a supported client connection is available; rollout metadata for identity/recovery; OTel for correlated outcomes and diagnostics. This is a recommendation inferred from the inspected coverage, not an implemented adapter.

## Open questions

1. Which minimum released Codex version includes the inspected hooks, session metadata, and history modes? Pin a release and capture CLI version with fixtures; main is not a compatibility guarantee.
2. Capture root, child, and grandchild payloads: does hook session_id refer to immediate parent or ultimate root in each path, and how do OTel conversation IDs join to the same AgentRef?
3. Capture failed exec, denied/aborted approvals, patch failures, MCP isError, and long-running exec/write_stdin completion. Which paths emit PostToolUse, and what exact response fields establish ok?
4. Does every actual human permission/input/elicitation path emit a usable hook? Which auto-review or hook-allowed cases emit PermissionRequest without a user pause?
5. Can Agentarium obtain supported live request/resolution notifications from an already-running CLI without owning its client connection? If not, how much hook-only triage fidelity is acceptable?
6. Should the event union gain a neutral resume/input-resolved event and a standalone error event? These would extend event semantics while preserving ADR 0004's categories.
7. Should waiting on another agent stay delegate in v1, or receive an explicit non-user-wait event? needs_input must remain reserved for user triage.
8. Can stop/subagent-stop completion checks be confirmed through notify/live turn completion to avoid transient idle states when another hook continues work?
9. How should bootstrap/recovery, silent thinking beyond the 30-second idle timeout, and source-clock timestamps work without fake prompt/tool events?
10. How should unknown tools, command classifiers, source priorities, duplicate identifiers, out-of-order asynchronous hooks/OTel, and intentionally nonzero command exits be handled?
11. Validate full tool coverage for code mode, specialized local tools, hosted tools, resumable sub-agents, and root-client/server termination. Source inspection cannot replace these fixtures.

[hooks-doc]: https://learn.chatgpt.com/docs/hooks
[config-doc]: https://learn.chatgpt.com/docs/config-file/config-advanced
[protocol]: https://github.com/openai/codex/blob/c3d3b142d10f4316b46e35aad7e5317e7e506cb7/codex-rs/protocol/src/protocol.rs
[hook-schemas]: https://github.com/openai/codex/tree/c3d3b142d10f4316b46e35aad7e5317e7e506cb7/codex-rs/hooks/schema/generated
[pre-tool]: https://github.com/openai/codex/blob/c3d3b142d10f4316b46e35aad7e5317e7e506cb7/codex-rs/hooks/src/events/pre_tool_use.rs
[post-tool]: https://github.com/openai/codex/blob/c3d3b142d10f4316b46e35aad7e5317e7e506cb7/codex-rs/hooks/src/events/post_tool_use.rs
[stop-source]: https://github.com/openai/codex/blob/c3d3b142d10f4316b46e35aad7e5317e7e506cb7/codex-rs/hooks/src/events/stop.rs
[notify-source]: https://github.com/openai/codex/blob/c3d3b142d10f4316b46e35aad7e5317e7e506cb7/codex-rs/hooks/src/legacy_notify.rs
[recorder]: https://github.com/openai/codex/blob/c3d3b142d10f4316b46e35aad7e5317e7e506cb7/codex-rs/rollout/src/recorder.rs
[rollout-lib]: https://github.com/openai/codex/blob/c3d3b142d10f4316b46e35aad7e5317e7e506cb7/codex-rs/rollout/src/lib.rs
[rollout-wire]: https://github.com/openai/codex/blob/c3d3b142d10f4316b46e35aad7e5317e7e506cb7/codex-rs/history/src/rollout_payload.rs
[rollout-policy]: https://github.com/openai/codex/blob/c3d3b142d10f4316b46e35aad7e5317e7e506cb7/codex-rs/rollout/src/policy.rs
[models]: https://github.com/openai/codex/blob/c3d3b142d10f4316b46e35aad7e5317e7e506cb7/codex-rs/protocol/src/models.rs
[telemetry]: https://github.com/openai/codex/blob/c3d3b142d10f4316b46e35aad7e5317e7e506cb7/codex-rs/otel/src/events/session_telemetry.rs
[otel-shared]: https://github.com/openai/codex/blob/c3d3b142d10f4316b46e35aad7e5317e7e506cb7/codex-rs/otel/src/events/shared.rs
[otel-config]: https://github.com/openai/codex/blob/c3d3b142d10f4316b46e35aad7e5317e7e506cb7/codex-rs/core/src/config/otel.rs
[tool-result]: https://github.com/openai/codex/blob/c3d3b142d10f4316b46e35aad7e5317e7e506cb7/codex-rs/otel/src/tool_result.rs
[approvals]: https://github.com/openai/codex/blob/c3d3b142d10f4316b46e35aad7e5317e7e506cb7/codex-rs/protocol/src/approvals.rs
[app-protocol]: https://github.com/openai/codex/blob/c3d3b142d10f4316b46e35aad7e5317e7e506cb7/codex-rs/app-server-protocol/src/protocol/common.rs
[exec-events]: https://github.com/openai/codex/blob/c3d3b142d10f4316b46e35aad7e5317e7e506cb7/codex-rs/exec/src/exec_events.rs
[exec-json]: https://github.com/openai/codex/blob/c3d3b142d10f4316b46e35aad7e5317e7e506cb7/codex-rs/exec/src/event_processor_with_jsonl_output.rs

