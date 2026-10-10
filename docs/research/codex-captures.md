# Codex CLI live captures

Capture date: 2026-10-10. Codex CLI **0.160.0** (`codex --version`, aarch64 Linux, ChatGPT login, model `gpt-6.1-sol`, reasoning effort low). This pins the version for the Phase 2 adapter. It answers the open questions in [codex-event-mapping.md](codex-event-mapping.md) that needed runtime evidence.

Fixtures: [`spikes/fixtures/codex/`](../../spikes/fixtures/codex/), one JSON file per scenario. Each file holds `codex_cli_version` and `hooks`, the hook payloads in arrival order with `at_ms` relative to the first hook. Some files also have `app`, the app-server messages from a client that owned the connection, or `exec`, the `codex exec --json` stream. Paths are replaced with `<CWD>`, `<DIR1>` (the isolated `CODEX_HOME`) and `<HOME>`. Strings are cut at 300 characters.

Tooling, in [`spikes/codex/`](../../spikes/codex/):

- `setup-codex-home.mjs` builds an isolated `CODEX_HOME`. It writes a user `hooks.json` that sends all twelve hook events to `spikes/payload-logger.mjs` and adds a fixture MCP server (`fx-mcp-server.mjs`, with `fx_ok` and `fx_fail` that returns `isError`). It then marks the hooks trusted (see "Hook trust").
- `capture-exec.mjs` runs one `codex exec --json` scenario.
- `capture-app.mjs` runs one turn through `codex app-server` and answers approvals with accept, decline or cancel, or interrupts the turn.
- `observe.mjs` joins the shared app-server daemon as a second client and prints what it receives (see Q5).
- `sanitize.mjs` turns the raw captures (gitignored `spikes/codex/raw/`) into fixtures.

`codex exec` waits for stdin when stdin is not a TTY. Run it with stdin closed (`</dev/null`).

## Scenarios

| Fixture | What ran |
|---|---|
| `exec-fail` | `ls /definitely/not/here .`, which exits 2 |
| `long-exec` | `sleep 25; echo finished` |
| `sandbox-deny` | `touch /etc/...` under `-s read-only`, approval `never` |
| `patch-ok` / `patch-fail` | `apply_patch` adding a file, and updating a missing file |
| `mcp` | MCP `fx_ok`, then `fx_fail` (`isError: true`) |
| `web` | hosted web search and open page |
| `subagents` | root, child, and grandchild via `spawn_agent` |
| `approve-accept` / `approve-decline` / `approve-cancel` | app-server, approval `untrusted`, sandbox `read-only`, one `touch` |
| `interrupt` | app-server `turn/interrupt` during `sleep 30` |
| `otel` | `ls /nope`, `echo ok`, MCP `fx_fail`, with OTel logs exported |
| `tui` | interactive TUI (tmux) on the shared app-server daemon, approval `on-request`: one approved command, then one approval cancelled with Esc |

## Findings

### Hook trust

Hooks from a user `~/.codex/hooks.json` are discovered but do not run until trusted. Codex records trust per handler in `config.toml`:

```toml
[hooks.state."<hooks.json path>:<event_snake_case>:<group index>:<handler index>"]
trusted_hash = "sha256:…"
```

The key and current hash come from app-server `hooks/list` (`key`, `currentHash`, `trustStatus`). The TUI shows "Hooks need review" and offers "Trust all and continue". Any change to a handler changes its hash, so the user has to review it again. `hooks.json` handler types are `command`, `prompt`, `agent`, and MCP tool. There is no HTTP handler like Claude Code's, so a forwarder process is needed.

### Q1: version

Pinned: **0.160.0**. All twelve hook events in the research enum exist in 0.160.0 (`hooks/list` reports them), and the rollout `session_meta` carries `cli_version`. **Unresolved:** the minimum released version with these hooks. Only the installed 0.160.0 was tested (0.162.1 was available).

### Q2: `session_id` across nesting

In every hook from a child or grandchild, `session_id` is the **root** session id. `agent_id` is the sub-agent's own thread id, and `agent_type` is present. Neither `SubagentStart` nor any other hook names the immediate parent. Parent and child are linked in two ways:

- Order: the parent's `PreToolUse`/`PostToolUse` for the spawn tool comes before the child's `SubagentStart`. The grandchild's spawn call carries the child's `agent_id`. A per-session queue of spawn callers (as in the Claude Code adapter) recovers the right parent in the capture, but the link is still inferred.
- Rollout metadata: the child's rollout `session_meta` has `session_id` = root and `parent_thread_id` = the immediate parent, plus `source.subagent.thread_spawn.{parent_thread_id, depth, agent_path}`. The rollout is named by `agent_transcript_path` on `SubagentStop`. This link is observed.

The spawn tool's hook name is **`collaborationspawn_agent`**: namespace and tool name joined with no separator. The same applies to `collaborationwait_agent` and `collaborationinterrupt_agent`. `SubagentStop` fires when a sub-agent finishes its turn, and no hook marks a sub-agent's permanent end.

### Q3: which paths emit `PostToolUse`, and what establishes success

| Path | `PreToolUse` | `PostToolUse` | Success signal in hook |
|---|---|---|---|
| Bash, exit 0 | yes | yes | none. `tool_response` is the raw output string |
| Bash, non-zero exit | yes | **yes** | none. Output only, no exit code |
| Bash, sandbox failure | yes | yes | none. Error text only |
| Long exec (25 s) | yes | yes, once, at completion | as Bash. No extra pre hook |
| `apply_patch` success | yes | yes | `tool_response` starts `Exit code: 0` |
| `apply_patch` failure | yes | **no** | the missing post hook |
| MCP success | yes | yes | `tool_response.isError === false` |
| MCP `isError` | yes | **no** | the missing post hook |
| Approval declined | yes | **no** | the missing post hook |
| Approval cancelled (Esc / cancel) | yes | **no** | `Interrupt` hook, and no `Stop` |
| Turn interrupted mid-exec | yes | **no** | `Interrupt` hook, and no `Stop` |
| Hosted web search (`webrun`) | yes | yes | array of results |

Hooks alone cannot tell a failed shell command from a successful one. A failed patch, an MCP error and a declined approval are visible only as a missing `PostToolUse`. The live app-server connection has the outcome (`item/completed` with `status` `completed`/`failed`/`declined` and `exitCode`), and its item `id` **equals** the hook `tool_use_id` (`exec-…`), so the two surfaces join directly.

Contrary to gap 3 in the mapping research, hosted web search **does** reach hooks in 0.160.0, as tool `webrun`.

### Q4: does every user-permission path emit a usable hook?

For command approvals, yes. Every human approval in `approve-*` and `tui` emitted `PermissionRequest` between `PreToolUse` and the prompt. The payload has `tool_name` and `tool_input.description` (the reason), but no `tool_use_id`. It matches the open call by order. **Not covered:** file-change approvals, `request_permissions`, `request_user_input` and MCP elicitation, and whether auto-review or a hook decision emits `PermissionRequest` with no user pause.

No hook marks the end of the wait. After an accept, the next sign is `PostToolUse`. After a decline, the next sign is the model's next tool or `Stop`. After a cancel, it is `Interrupt`.

### Q5: live approvals without owning the client connection

**Yes, when the session runs on the shared app-server daemon.** In 0.160.0 the TUI runs its threads on the local daemon (`daemon_auto_start` is a stable feature, and the daemon process hosts the MCP servers). It listens on `$CODEX_HOME/app-server-control/app-server-control.sock`, which speaks JSON-RPC over WebSocket. A second client connected there with `ws` (`ws+unix://…`; mind the 108-byte socket path limit). It called `thread/loaded/list` and then `thread/resume` for each thread, and then received:

- the **already pending** `item/commandExecution/requestApproval`, replayed to the new subscriber,
- `serverRequest/resolved` when the user answered in the TUI,
- `thread/status/changed` with `activeFlags: ["waitingOnApproval"]` and its clearing,
- `item/started` and `item/completed` with outcomes, plus `turn/started`, `turn/completed` (`status: interrupted` on cancel) and `hook/started` and `hook/completed`.

The observer never answered the request, and the TUI still resolved it normally. `codex exec` sessions do not use the daemon, so they stay hook-only.

### OTel

Fixture `otel` (`otel-sink.mjs` received it as OTLP/HTTP JSON logs, configured with `[otel] exporter = { otlp-http = { endpoint = "…/v1/logs", protocol = "json" } }` and `log_user_prompt = false`). Only identifiers and outcomes are kept, because the raw logs hold the account id, e-mail address, and tool arguments and output.

- `conversation.id` is the thread id, the same value as the hook `session_id` for a root thread and `agent_id` for a sub-agent. `agent_name` is the agent path (`/root`).
- `codex.tool_decision` and `codex.tool_result` carry `call_id`, which **equals** the hook `tool_use_id`.
- `codex.tool_result.success` reports the tool call, not the command. `ls /nope` (exit 2) reported `success: "true"`. An MCP `isError` reported `success: "false"`, and that call has no `PostToolUse`.
- Code-mode wrapper calls (`tool_name: "exec"`, `call_id: "call_…"`) appear only in OTel and have no hook.
- Values are strings (`"true"`, `"62"`). Records are batched, so they arrive after the hooks.

## What this means for the adapter

- Install: Codex hooks go in `~/.codex/hooks.json` as `command` handlers that forward stdin to the daemon. The user then has to trust them in Codex. Agentarium should not write `trusted_hash` itself, because that would skip Codex's own review.
- Identity: `AgentRef.session` = hook `session_id` (the root), `agent` = `agent_id` or `root`.
- Outcomes: a hook-only adapter treats `PostToolUse` as completion. For `apply_patch` it reads the exit code, and for MCP it reads `isError`. For Bash the outcome is unknown. A missing post hook is cleared by the next `Stop` or `Interrupt`.
- `Interrupt` ends the turn when `Stop` never comes.
