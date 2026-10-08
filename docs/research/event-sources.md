# Event sources: how to observe agents across providers

The hardest part of the project is collecting events, not rendering. There is
no universal source, so build a thin adapter per source that all emit one
normalized event, and choose sources by fidelity.

Research date: 2026-10-08.

**Verification levels**

- **Read directly**: Claude Code (hooks, OpenTelemetry), Gemini CLI (hooks and
  telemetry, read from the GitHub raw docs).
- **Via search summaries only**: Codex CLI and Cursor. Their docs sites were
  unreachable from the research sandbox, so exact event lists and payload
  fields must be confirmed on a real install.

## Ways to get events (best fidelity first)

| # | Method | Fidelity | Notes |
|---|---|---|---|
| 1 | Native hooks / callbacks | High, tool-level | Claude Code, Codex, Gemini CLI, Cursor |
| 2 | Telemetry (OpenTelemetry) | Medium to high | Claude Code, Codex, Gemini CLI; frameworks via OpenInference/OpenLLMetry |
| 3 | Tail session logs on disk | High but after the fact, format-fragile | Fallback only |
| 4 | LLM API proxy (base-URL override) | Medium, uniform | For tools without hooks (Aider, Cline, Copilot) |
| 5 | OS observation (process tree, file watcher) | Low ("busy / where") | Last resort, closed-source tools |

## Adapter table

| Provider | Hooks | Telemetry | Log fallback |
|---|---|---|---|
| **Claude Code** (read directly) | 30+ events in `settings.json`: `SessionStart/End`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse(Failure)`, `PermissionRequest`, `Notification`, `SubagentStart/Stop`, `TaskCreated/Completed`, `Stop`, and more. Handler types: `command`, `http`, `mcp_tool`, `prompt`, `agent`. | OTLP metrics, events, and traces (beta, `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA`). | `transcript_path` in every hook payload |
| **Codex CLI** (search only) | Lifecycle hooks in `~/.codex/hooks.json`, `config.toml`, or `<repo>/.codex/`: `PreToolUse`, `PermissionRequest`, `PostToolUse`, `UserPromptSubmit`, `SubagentStart/Stop`, `Stop`, `SessionStart`, compaction events. Newer versions reportedly add `Interrupt`, `SessionEnd`. Non-managed command hooks must be trusted before running. | `[otel]` in `config.toml`; exporter `none`, `otlp-http`, `otlp-grpc`. Log events for API requests, approvals, tool results. Prompts redacted by default. | `notify` for turn completion; session file path not re-verified |
| **Gemini CLI** (read directly) | 11 events: `BeforeTool`, `AfterTool`, `BeforeAgent`, `AfterAgent`, `BeforeModel`, `AfterModel`, `BeforeToolSelection`, `SessionStart/End`, `Notification`, `PreCompress`. Command hooks only; experimental (needs `tools.enableHooks` and `hooks.enabled`). | Off by default. Targets `local`, `gcp`, OTLP, or outfile. Events `gemini_cli.tool_call`, `api_request`, `api_response`, `api_error`. | `transcript_path` in hook payload |
| **Cursor** (search only) | `.cursor/hooks.json` or `~/.cursor/hooks.json`: `beforeShellExecution`, `afterFileEdit`, `stop`, plus prompt, tool, subagent, MCP events. Cloud agents run only some hooks. | None found | None found |

## Claude Code details

- Hook config nests event, matcher group, handler. Common input fields:
  `session_id`, `transcript_path`, `cwd`, `permission_mode`,
  `hook_event_name`, `prompt_id`; plus `agent_id` and `agent_type` inside
  subagents.
- The `http` handler POSTs the event JSON to a URL, so the daemon can receive
  events directly with no shim script. This is the lowest-friction adapter.
- "Waiting for the user" has no dedicated event. Use `Notification` (matchers
  `permission_prompt`, `idle_prompt`, `elicitation_dialog`),
  `PermissionRequest`, and `Elicitation`.
- Telemetry env: `CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_METRICS_EXPORTER`,
  `OTEL_LOGS_EXPORTER`, `OTEL_EXPORTER_OTLP_PROTOCOL`,
  `OTEL_EXPORTER_OTLP_ENDPOINT`. Log events: `user_prompt`, `tool_decision`,
  `tool_result`, `api_request`, `api_error`, and others, all joinable by
  `session.id`, `prompt.id`, `tool_use_id`.
- Trace spans: `claude_code.interaction` > `llm_request`, `tool` >
  `tool.blocked_on_user`, `tool.execution`. Subagent spans nest under the
  parent tool span.
- Content logging (prompts, tool details, raw API bodies) is off by default.

## Gemini CLI details

- Common hook input: `session_id`, `transcript_path`, `cwd`,
  `hook_event_name`, `timestamp`. Exit code 0 = success, 2 = block.
- Telemetry `logPrompts` defaults to `true`; the installer should turn it off.

## Cursor / Codex notes

- Cursor hooks: JSON on stdin and stdout, exit 2 blocks, other failures are
  fail-open. Config is hot-reloaded. Project and global hooks both run.
- Codex: matching command hooks for an event start concurrently. English and
  Spanish docs listed different event sets, so check the live page.

## Proposed architecture

```
[hook shim] [log tailer] [OTel receiver] [LLM proxy] [process watcher]
      \          |            |              |            /
       └──────► adapters ──► normalized AgentEvent ──► local daemon
                                                         │ (state reducer)
                                                    WebSocket
                                                         ▼
                                                  room UI (2D/3D)
```

Normalized event:

```json
{ "agent_id": "claude:sess_ab12", "provider": "claude-code",
  "ts": 1760000000,
  "kind": "tool_start|tool_end|thinking|message|needs_input|error|spawn|stop",
  "tool": "Edit", "category": "read|write|exec|search|network|delegate",
  "summary": "src/app.ts", "parent_id": null, "repo": "agentarium" }
```

A per-provider table maps tool names to `category`, which drives animations. A
per-agent reducer produces states (working / idle / waiting / blocked) with
timeouts (for example, no events for 30s = idle).

## Pitfalls

- "Waiting for input" is the most valuable and hardest state to detect;
  strong on Claude Code, uncertain elsewhere.
- Privacy: events contain code and prompts. Keep local by default and send
  only redacted summaries to the UI.
- Stable agent IDs; subagents need `parent_id` to show delegation.
- Format drift: pin adapters to tool versions; treat logs as fallback.
- Install friction decides adoption: ship an `init` command that writes hook
  config or env vars.

## Suggested build order

1. Schema + daemon (WebSocket + reducer).
2. Claude Code adapter (HTTP hook, then OTel for correlation).
3. Gemini CLI and Codex hook adapters.
4. OTel receiver for frameworks.
5. LLM proxy for tools without hooks.

Before writing the Codex and Cursor mappers, run a script that dumps every
hook payload to a file, once per tool, and build from the real data.

## Sources

- Claude Code hooks: https://code.claude.com/docs/en/hooks
- Claude Code OpenTelemetry: https://code.claude.com/docs/en/monitoring-usage
- Gemini CLI hooks: https://geminicli.com/docs/hooks/reference/
- Gemini CLI telemetry: https://geminicli.com/docs/cli/telemetry/
- Codex hooks (search summary): https://developers.openai.com/codex/hooks
- Codex config sample (search summary): https://developers.openai.com/codex/config-sample
- Cursor hooks (search summary): https://cursor.com/docs/hooks
- Cursor third-party hooks (search summary): https://cursor.com/docs/agent/third-party-hooks
