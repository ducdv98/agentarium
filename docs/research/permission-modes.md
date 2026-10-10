# Permission modes and needs-input signals

Capture date: 2026-10-10. Platform: Windows 11, PowerShell. Installed CLIs: Codex CLI **0.162.1** (`codex --version`) and Claude Code **2.1.296** (`claude --version`). The runtime captures cited below were made in this repository's earlier spikes: Codex 0.160.0 on 2026-10-10 and Claude Code 2.1.294 on 2026-10-08/09. Claims based only on help or documentation are marked as such. No product code was changed.

The key distinction is between a permission mode (whether a tool call may run), a sandbox (what the command can reach), and the observer surface. A hook is not an approval ledger: some approval waits have no hook, and a successful/failed hook process does not mean that the requested tool ran.

### Codex 0.162.1 approval fixtures

Captured 2026-10-10 on Windows 11 with isolated `CODEX_HOME` directories (Windows `elevated` sandbox) and scratch Git repositories. Each fixture in `spikes/fixtures/codex/` holds the hook payloads and the live app-server messages of one turn. Fixtures that also carry `turn_context` record the rollout's approval policy, reviewer and sandbox.

| Approval policy | Sandbox | Hook `permission_mode` |
|---|---|---|
| `never` | `read-only` | `bypassPermissions` |
| `on-request` | `read-only` | `default` |
| `on-request` | `workspace-write` | `default` |
| `on-request` + `approvals_reviewer = "auto_review"` | `read-only`, `workspace-write` | `default` |
| granular object | `read-only` | `default` |

| Fixture | Hooks | Live |
|---|---|---|
| `onreq-ro-accept`, `onreq-ww-accept` | `PreToolUse`, `PermissionRequest`, `PostToolUse` | `waitingOnApproval`, `item/commandExecution/requestApproval`, `serverRequest/resolved`, item `completed` |
| `onreq-ro-decline`, `onreq-ww-decline` | `PreToolUse`, `PermissionRequest`, then `Stop` with no `PostToolUse` | request, `serverRequest/resolved`, item `declined` |
| `onreq-ro-cancel` | `PreToolUse`, `PermissionRequest`, `Interrupt` | request, `serverRequest/resolved`, item `declined`, turn interrupted |
| `file-ro-accept`, `file-decline` | `PreToolUse(apply_patch)`, `PermissionRequest(apply_patch)`, then `PostToolUse` or `Stop` | `item/fileChange/requestApproval`, resolved, item `completed` or `declined` |
| `mcp-elicit` | `PermissionRequest(mcp__fx__fx_elicit)` before the call | two `mcpServer/elicitation/request`s: the tool-call approval (`_meta.codex_approval_kind = "mcp_tool_call"`) and the server's own form |
| `auto-approve`, `auto-approve-failed` | `PreToolUse`, **`PermissionRequest`**, `PostToolUse` | no client request; `item/autoApprovalReview/started` about 25 ms after the hook, then `.../completed` with `review.status` (`approved`) and `targetItemId`; a `guardianWarning` carries the rationale |
| `never-sandbox-deny` | `PreToolUse`, `PostToolUse` with the access-denied text | item `failed`; no request |
| `onreq-ww-cancel` | `PreToolUse`, `PermissionRequest`, `Interrupt` | request, resolved, item `declined` |
| `auto-reject` | `PreToolUse`, **`PermissionRequest`**, `Stop` (no `PostToolUse`) | `autoApprovalReview/started`, then `completed` with `review.status = denied`; item `declined` |
| `reqperm-accept`, `reqperm-decline` | `PreToolUse(request_permissions)`, then `PostToolUse` when answered; **no `PermissionRequest`** | `item/permissions/requestApproval`, resolved; a decline's `tool_response` grants all-`null` permissions |
| `user-input` | `PreToolUse(request_user_input)`, then `PostToolUse` with the answers; **no `PermissionRequest`** | `item/tool/requestUserInput`, resolved |
| `granular-deny` | `PreToolUse`, `Stop`; no request and no `PostToolUse` | nothing: `granular.sandbox_approval = false` rejects the escalation automatically |

An in-workspace patch under `workspace-write` needs no approval. The `request_permissions` and `request_user_input` tools are behind the feature flags `request_permissions_tool` and `default_mode_request_user_input` (both "under development", off by default in 0.162.1); the `reqperm-*` and `user-input` fixtures enable them in the isolated config. A granular approval policy needs the client to declare the `experimentalApi` capability at `initialize`. The reviewer approved a `git push --force origin main` in a repo without a remote (`auto-approve-failed`). It denied a request to POST a fake `.env` to `https://exfil.invalid` (`auto-reject`).

**Auto-review fires the `PermissionRequest` hook** with the same payload shape and `permission_mode` (`default`) as a person-routed request. Hooks alone cannot tell them apart. Two sources can: the live `item/autoApprovalReview/started` notification, and the rollout's `turn_context.approvals_reviewer = "auto_review"` (the rollout path is the hook's `transcript_path`). Under `never` + `read-only` a write is a tool failure with no request. Under `on-request` the same write, or a write outside `workspace-write`, becomes an escalation request.

Sources: the installed `codex --help`, `codex exec --help`, `claude --help` and `claude -p --help` outputs (versions above); [Codex configuration basics](https://developers.openai.com/codex/config-file/config-basic), [Codex configuration reference](https://developers.openai.com/codex/config-file/config-reference), [Codex sandboxing](https://developers.openai.com/codex/sandboxing), [Claude permissions](https://code.claude.com/docs/en/permissions), [Claude hooks](https://code.claude.com/docs/en/hooks), and [Claude sandboxing](https://code.claude.com/docs/en/sandboxing). Repository evidence is in [codex-captures.md](codex-captures.md), [hook-payloads.md](hook-payloads.md), [codex-gap-decisions.md](codex-gap-decisions.md), and the fixtures under `spikes/fixtures/`.

## Codex CLI

### Values and resolution

In 0.162.1, the public CLI accepts `approval_policy` values `on-request` and `never` (`-a/--ask-for-approval`). The help output does not list `on-failure`, `untrusted`, or a named `full-auto` flag. Current configuration reference documents `on-request`, `never`, and a granular object; it says explicit `untrusted` is no longer supported and `on-failure` is deprecated. Granular keys currently documented are `sandbox_approval`, `rules`, `mcp_elicitations`, `request_permissions`, and `skill_approval`. `approvals_reviewer = "user" | "auto_review"` selects a human or automatic reviewer. The CLI's `--approve-for-me` is the convenience form for automatic review with workspace-write.

`sandbox_mode` is `read-only`, `workspace-write`, or `danger-full-access`. On Windows, `windows.sandbox = "unelevated" | "elevated"` selects the native implementation; `windows.allowed_sandbox_implementations` can constrain that choice. `--dangerously-bypass-approvals-and-sandbox` is the explicit combined full-access/never mode. The installed help has no `--full-auto`; `/permissions` is the interactive selector for the configured permission profiles (documented by the sandbox page). Auto-review is distinct from a user wait: it can produce an approval decision without the user needing Agentarium's flag.

Effective configuration, highest precedence first:

1. CLI flags and `-c/--config` overrides.
2. Trusted project `.codex/config.toml` layers, nearest directory winning.
3. Selected `--profile`, which layers `$CODEX_HOME/<name>.config.toml`.
4. User `$CODEX_HOME/config.toml`.
5. Cloud-managed config defaults.
6. System config (for example `/etc/codex/config.toml` on Unix).
7. Built-in defaults.

Managed requirements are constraints, not an ordinary lower-precedence default: they can reject or restrict values such as `never` and `danger-full-access`. An untrusted project skips project `.codex/` config, hooks, and rules, while user/system layers still apply. A running session does not expose one stable, documented “effective permission mode” field to an outside hook consumer. Agentarium can infer parts of it from startup configuration only if it launched the process; it should use live app-server request/status messages for actual waits. Hook payloads do carry a Claude-style `permission_mode` field, but it reflects only the approval policy, not the sandbox: in the 0.160.0 fixtures every `never` run reports `bypassPermissions` (including `sandbox-deny`, which ran under `-s read-only`), and the `untrusted` app-server and TUI runs report `default`. How `on-request`, granular policies and auto-review map onto it is not yet captured (ticket 02). It is not the complete resolved policy. Rollout `session_meta`/`turn_context` are useful for identity and context, not a durable approval record. OTel carries tool decisions/results and `conversation.id`, but not a complete policy snapshot.

### Detection and signals matrix

`PermissionRequest` below means the Codex hook. “Live” means a client connected to the shared app-server daemon. `PostToolUse` is not emitted for every failed/denied operation.

| Mode / combination | How Agentarium can detect the mode | Signals when user is needed | Signals on approve | Signals on deny / abort | Gaps (no signal) |
|---|---|---|---|---|---|
| `never` + `read-only` | Launch args/config if known; otherwise infer only from sandbox error text. | No human approval prompt. | `PostToolUse` for shell/sandbox failure; no approval event. | Hook `PostToolUse` contains error text but no exit code; live `item/completed`/OTel can provide outcome when available. | Hook-only cannot distinguish a successful shell command from a non-zero exit. A blocked command is not a user wait. |
| `never` + `workspace-write` | Same. | No approval wait for sandbox escalation; failures return to the model. | Normal `PostToolUse` on completion. | Sandbox denial commonly appears as tool output/error text and returns to the model; no `PermissionRequest`. | No user-facing denial hook; rollout has no approval record. |
| `never` + `danger-full-access` | `-s danger-full-access`, config, or bypass flag if observed. | None for command execution. | `PostToolUse`; OTel result may arrive later. | Tool/turn error only. | No approval signal and shell exit status is absent from the hook payload. |
| `on-request` + any sandbox | Hook `permission_mode = default` in 0.162.1 captures, CLI/config, plus live `thread/status/changed.activeFlags`. | For a command approval: `PreToolUse`, then `PermissionRequest`; live `item/commandExecution/requestApproval` and `waitingOnApproval`. File changes use `item/fileChange/requestApproval`; MCP elicitation uses `mcpServer/elicitation/request`. | Hook `PostToolUse` after execution; live `serverRequest/resolved`, `item/started`, then `item/completed`; OTel decision/result. | Decline: live item completes `declined`, generally no `PostToolUse`. Cancel/Esc: interrupted turn, no `PostToolUse`. | `request_permissions` and `request_user_input` were not reachable in the 0.162.1 model/tool surface. |
| Granular approval object | Config inspection only; no equivalent complete mode field in normal hook payload. | Only enabled categories can pause: sandbox escalation, rules, MCP elicitation, `request_permissions`, or skill approval. | Same live request/resolution signals as above for enabled categories. | Same decline/cancel signals as above. | Auto-rejected categories have no user wait and may look like ordinary tool failure. |
| `on-request` + `approvals_reviewer = auto_review` / `--approve-for-me` | Rollout `turn_context.approvals_reviewer`; live `item/autoApprovalReview/*`. Hook `permission_mode` stays `default`. | None: the reviewer decides. The `PermissionRequest` hook still fires, so it must not raise needs-input on its own. | Live `autoApprovalReview/completed` with `review.status = approved`, then the item completes and `PostToolUse` fires. | Reviewer denial (`auto-reject`): `review.status = denied`, the item is `declined`, no `PostToolUse`, then `Stop`. | Hook-only cannot see the reviewer without reading the rollout. |
| `/permissions` preset / custom profile | Read selected profile and config only when Agentarium launched Codex; TUI selection itself is not a hook field. | Depends on resolved sandbox/policy; use the underlying signals above. | Underlying tool completion. | Underlying decline/interrupt/failure. | Outside observer cannot reliably reconstruct a TUI-selected custom profile from hooks alone. |
| `--dangerously-bypass-approvals-and-sandbox` | CLI arg if Agentarium launched it. | None. | Normal completion hooks/OTel. | Tool/turn failure only. | Never infer this from “no PermissionRequest”: `never` and auto-approved cases look the same. |

Sandbox semantics: `read-only` permits inspection but blocks writes; `workspace-write` permits routine workspace work and restricts outside access; `danger-full-access` removes sandbox restrictions. On Windows, native hooks run outside the sandbox: existing captures verified Agentarium hooks from all three sandbox modes. A nested `codex exec` inside a sandbox is a separate process and is not a reliable observer path: without network it looped on `invalid peer certificate: UnknownIssuer`; with `sandbox_workspace_write.network_access=true` it failed with `Could not find home directory` under the elevated sandbox user.

With `never`, a sandbox denial is returned to the model as a tool failure and does not become an approval prompt. With `on-request`, an operation that is outside the active sandbox can produce an escalation/approval request; if it is declined, the live app-server reports `declined`, while hook-only observation sees the request and then a missing `PostToolUse`.

## Claude Code

### Values and resolution

Installed help accepts `--permission-mode` values `acceptEdits`, `auto`, `bypassPermissions`, `manual` (the docs call this `default`), `dontAsk`, and `plan`. `--dangerously-skip-permissions` selects bypass; `--allowedTools` pre-allows matching tools and `--disallowedTools` denies matching tools. Rules use `permissions.allow`, `permissions.ask`, and `permissions.deny`; the documented evaluation order is deny, ask, allow, after hooks. `bypassPermissions` skips ordinary prompts but hooks and deny rules can still block. `dontAsk` turns otherwise-prompting calls into denials. `auto` uses a classifier where available. Subagents inherit restrictive/automatic modes in documented cases and may not override them.

Settings are layered across managed, user, project, and local scopes; the CLI `--settings` adds the supplied settings, and `--permission-mode` is a per-session override. `--allowedTools`/`--disallowedTools` are per invocation. `/permissions` edits the active rules and can write a local rule. The exact precedence of a managed restriction is intentionally stronger than user/project settings. `sandbox` is a separate Bash-tool restriction: it can restrict filesystem and network access, but it does not turn a permission prompt into a hook event. See the [sandbox reference](https://code.claude.com/docs/en/sandboxing) for the platform-specific filesystem/network behavior.

The `permission_mode` field in hook payloads is the best outside-process mode signal for Claude. It is not a complete snapshot of allow/ask/deny rules or sandbox state. The transcript records tool calls and answers, but not a stable resolved-settings object. OTel is not a reliable documented permission-mode API; Agentarium should treat hooks as authoritative for identity and prompt-adjacent events and use transcript/output only as supplementary evidence.

### Detection and signals matrix

| Mode / combination | How Agentarium can detect the mode | Signals when user is needed | Signals on approve | Signals on deny / abort | Gaps (no signal) |
|---|---|---|---|---|---|
| `default` / `manual` | `permission_mode` on most hook payloads; CLI/settings if launched by Agentarium. | Interactive tool: `PreToolUse`, then `PermissionRequest`; interactive `Notification` with `permission_prompt`. `AskUserQuestion` also produced `PreToolUse` + `PermissionRequest`. | `PostToolUse` after execution. | In existing headless capture, denied Bash produced no `PostToolUse`, `PostToolUseFailure`, or `PermissionDenied`; later event/`Stop` clears the pending wait. Interactive denial payloads remain unverified. | No hook for the user's answer itself; no dependable denial event in headless mode. |
| `acceptEdits` | `permission_mode`; settings/flag. | Prompts remain for non-edit tools and operations outside accepted edit scope. | `PostToolUse` for auto-accepted edits; prompt-required tools follow manual signals. | Tool-specific failure or later `Stop`; exact interactive denial not captured. | Do not equate this mode with bypass: Bash/network can still prompt. |
| `plan` | `permission_mode`; TUI/CLI selection. | Read-only exploration usually does not prompt; `AskUserQuestion` can ask for clarification. Exiting plan mode and approving edits is interactive but no dedicated hook shape was captured. | Read hooks / question answer; later edit signals depend on mode after exit. | No captured plan-exit approval/denial event. | Plan-mode exit approval needs a human capture. |
| `auto` | `permission_mode`; classifier state is not a public hook payload. | Classifier decisions are not user waits. If a hard/manual prompt remains, use `PermissionRequest`/`Notification`. | `PostToolUse` after classifier-approved execution. | Classifier denial may be a tool failure with no permission event; not captured. | Never set needs-input merely because mode is auto or a `PermissionRequest` hook ran. |
| `dontAsk` | `permission_mode`, CLI/settings. | None for calls that would prompt; pre-approved rules still run. | `PostToolUse` for allowed calls. | Auto-denial commonly has no `PermissionDenied`/failure hook in headless mode. | This is a denial mode, not an idle user wait. |
| `bypassPermissions` / `--dangerously-skip-permissions` | `permission_mode`; CLI arg if launched by Agentarium. | None for ordinary permissions. | Normal `PostToolUse`. | Hook deny rules, sandbox/tool failures, or abort/`Stop`; no ordinary permission prompt. | No prompt does not prove bypass; it is indistinguishable from a pre-allowed call without mode metadata. |
| Any mode + allow/ask/deny rules, `--allowedTools`, `--disallowedTools` | `permission_mode` plus settings only if available; hook payload does not include the matched rule. | `ask` rule: `PreToolUse` + `PermissionRequest`, and interactive `permission_prompt` notification. | `PostToolUse`. | `deny`/`dontAsk`: often no post/failure hook in headless mode; hooks can return deny before execution. | Rule provenance and the user's selected “allow for session” are not exposed as a normalized hook event. |
| Any mode + Claude sandbox | `permission_mode` does not identify sandbox settings; inspect the launch/settings only when possible. | Sandbox denial itself is not necessarily a permission prompt. | Normal tool result. | Bash/tool error or model-visible denial; no guaranteed permission hook. | Network/filesystem denials and permission denials must not be conflated. |
| Subagent | Hook payload adds `agent_id`/`agent_type`; mode is present on most payloads. | A subagent prompt can produce its own `PermissionRequest`; parent sees the Agent tool lifecycle. | Subagent tool `PostToolUse`; parent Agent `PostToolUse` includes the child id after completion. | `SubagentStop`, `Stop`, or missing post; interactive prompt propagation was not captured. | `SubagentStart` has no spawning tool id; parent linkage is initially inferred by order. |

Interactive-only findings: `Notification(permission_prompt)` was captured beside a permission request, and `Notification(idle_prompt)` appeared about 60 seconds after `Stop`. Headless `-p` does not fire `Notification`; `--permission-prompts none` denies anything that would prompt. `Elicitation`, `ElicitationResult`, `PermissionDenied`, `PostToolUseFailure`, and plan-exit approval were not captured, so their exact payloads remain open. A user answering `AskUserQuestion` eventually caused `PostToolUse`, but there was no answer-start event.

### Claude Code 2.1.296 headless fixtures

Captured 2026-10-10 with `spikes/claude/capture-headless.mjs`: one `claude -p` session per scenario in a throwaway repo, with hooks and rules from `--settings` and `--setting-sources project,local`, so the user's own settings stay out. Prompts are answered over the stream-json control protocol (`--permission-prompt-tool stdio`), which lets a script approve or deny. Sequences are in `spikes/fixtures/claude-code/modes/`.

| Fixture | Mode / rule | Hooks after the prompt |
|---|---|---|
| `manual-allow` | `default` | `PreToolUse`, `PermissionRequest`, `PostToolUse` |
| `manual-deny` | `default`, host denies | `PreToolUse`, `PermissionRequest`, `Stop` |
| `manual-noprompt` | `default`, `--permission-prompts none` | `PreToolUse`, **`PermissionRequest`**, `Stop` (auto-denied: nobody was asked) |
| `acceptedits` | `acceptEdits` | `Write` runs without a prompt; `Bash` prompts |
| `plan` | `plan` | the plan file is written without a prompt; `PermissionRequest(ExitPlanMode)` is the plan-exit approval; after it, payloads report `default` and later tools prompt |
| `auto` | `auto` | no prompts; the classifier allowed everything |
| `auto-risky` | `auto` | `PreToolUse`, `Stop`: a built-in safety check denied `rm -rf /…` with no `PermissionRequest` |
| `dontask` | `dontAsk` | `PreToolUse` then nothing for each call; tool result says "denied because Claude Code is running in don't ask mode" |
| `bypass` | `bypassPermissions` | no prompts |
| `ask-rule` | `bypassPermissions` + `ask: Bash(node:*)`, host denies | `PreToolUse`, `PermissionRequest`, `Stop` |
| `deny-rule` | `default` + `deny: Bash(node:*)` | `PreToolUse`, `Stop`; no `PermissionRequest` |
| `exec-fail` | `bypassPermissions` | `PreToolUse`, `PostToolUseFailure` |
| `subagent`, `subagent-deny` | `default` | the sub-agent's own `PreToolUse` and `PermissionRequest` carry its `agent_id`; a denial ends at `SubagentStop` with no `PostToolUse` |

No mode fired `PermissionDenied`, and no denial (by the user, a rule, `dontAsk` or the `auto` safety check) fired `PostToolUseFailure`. A denied call simply never gets a `PostToolUse`, and the turn's `Stop` (or the sub-agent's `SubagentStop`) is the first closing signal. `permission_mode` is on every payload except `SessionStart` and `SessionEnd`, and changes mid-session when plan mode is exited. `--permission-prompts none` is the one case where `PermissionRequest` fires without a person being asked. It reports `default` and closes at `Stop` within milliseconds.

### Claude Code 2.1.296 interactive fixtures

Captured 2026-10-10 by a person with `spikes/claude/capture-interactive.mjs` (`tui-*` in `spikes/fixtures/claude-code/modes/`).

- **Denying with No or Esc in the TUI fires no hook at all.** There is no `Stop`, `PostToolUse`, `PostToolUseFailure` or `PermissionDenied` (`tui-deny`, `tui-esc`). The turn ends silently and the next hook is the user's next `UserPromptSubmit`, which can be minutes later or never. Headless denial does fire `Stop`, so this differs from headless.
- The transcript does record it: a user entry with a `tool_result` for the same `tool_use_id`, `toolUseResult: "User rejected tool use"`, then `[Request interrupted by user for tool use]`. The transcript path is on every hook payload. The daemon polls this while a root agent has an open prompt, and ends the wait as a failed outcome (ticket 08). Excerpts are in `spikes/fixtures/claude-code/transcripts/`.
- `Notification(permission_prompt)` fires once, about 6 s after an unanswered `PermissionRequest`. `idle_prompt` fires about 60 s after `Stop`, never after a TUI denial.
- `AskUserQuestion`: `PermissionRequest`, then `PostToolUse` when answered.
- In `auto` mode the `rm -rf` safety check is routed to the person as a `PermissionRequest` (`tui-auto`), whereas headless denied it silently.
- A sub-agent's denied prompt ends at `SubagentStop`, so it closes there (`tui-subagent`). The sub-agent ran in the background: the parent's `PostToolUse(Agent)` and `Stop` came before the sub-agent's tool calls.

### Codex TUI fixture

`tui-permissions` (captured with `spikes/codex/capture-tui.mjs`) has five turns, one per preset picked in `/permissions`. Each new preset shows up as a new rollout `turn_context`; the hook `permission_mode` follows the approval policy only:

| Rollout `turn_context` | Hook `permission_mode` | Hooks for an in-repo write |
|---|---|---|
| `on-request`, reviewer `auto_review`, `workspace-write` (two turns) | `default` | no prompt |
| `never`, reviewer `user`, `danger-full-access` | `bypassPermissions` | no prompt |
| `on-request`, reviewer `user`, `read-only`, answered with Esc | `default` | `PermissionRequest`, then `Interrupt` |
| `on-request`, reviewer `user`, `read-only`, approved | `default` | `PermissionRequest`, then `PostToolUse` |

So a TUI preset change is visible from outside only in the rollout, not in hooks: `default` covers both the auto-review and the user-reviewed presets.

## Implications for Agentarium

* Codex adapters must combine hook `PermissionRequest` with app-server approval requests/status when a daemon connection exists. Raise needs-input only for a human-routed request, not for `auto_review`, `never`, `dontAsk`, sandbox failure, or a hook decision that merely ran.
* Codex live `item/completed.status = declined` and the corresponding request resolution are the reliable denial outcome. Hook-only adapters should retain a pending call until `PostToolUse`, the next agent event, `Stop`, or `Interrupt`, and must label shell exit success as unknown when only hook output exists.
* Claude adapters should use `PermissionRequest` plus interactive `Notification(permission_prompt)` as prompt evidence, but keep a timeout/next-event cleanup path because headless denial has no reliable closing hook. `PostToolUseFailure` and `PermissionDenied` should be supported when their payloads are confirmed.
* Preserve mode metadata and distinguish “waiting for user”, “automatically denied”, “sandbox denied”, and “tool failed” in normalized outcomes. Do not infer permission mode from the absence of a prompt.
* If Agentarium ever launches an agent, it must inherit the user's effective mode and sandbox/configuration, never force bypass, never copy real auth/config into a shared home, and make the inherited mode observable in its own launch metadata.

## Open / needs human capture

1. Codex TUI: a custom permission profile; use [`spikes/codex/capture-tui.mjs`](../../spikes/codex/capture-tui.mjs).
2. Codex: repeat the sandbox escalation/failure comparison for Windows `unelevated`; current fixtures are `elevated`.
3. Codex: capture managed `requirements.toml` rejection/constraint behavior without changing the user's managed configuration.
4. Claude: `Elicitation`/`Notification(elicitation_dialog)` still needs an MCP server that elicits.
5. OTel: verify whether either CLI emits a stable resolved permission-mode attribute in the installed versions; current evidence does not establish one.
