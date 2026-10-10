# Anything Agentarium launches inherits the user's permission mode

Agentarium launches nothing today. It only observes. If it ever starts an agent or opens its own Codex app-server connection, that process runs with the user's effective **permission mode**: the approval policy and sandbox the user's own configuration resolves to, including project layers, profiles and managed requirements. Agentarium never adds `--dangerously-bypass-approvals-and-sandbox`, `--dangerously-skip-permissions`, `-a never`, `-s danger-full-access` or a `--permission-mode` of its own. It never answers an approval on the user's behalf: a request it receives is shown as needing the user and left for the user to answer. It never copies the user's `auth.json`, `config.toml` or Claude settings into a shared or Agentarium-owned home. To inherit the mode, it launches the CLI against the user's own `CODEX_HOME` or Claude config directory and passes no permission flags.

Each launch records the mode it inherited as metadata on the launched agent: the approval policy, the sandbox, and where each came from. For Codex this is the `thread/start` response or the session's `turn_context`. For Claude Code it is the `permission_mode` on the first hook payload. The metadata is never derived from Agentarium's own flags, because Agentarium passes none. The view then shows the same mode the user would see in the CLI, and "this agent cannot ask for approval" is visible before it surprises anyone.

## Considered options

- **Force bypass for launched agents.** This is how Agentarium was dogfooded. Rejected: it silently widens what an agent may do beyond what the user chose, and it hides exactly the approval waits that triage exists to show.
- **Launch with a fixed safe mode, for example `on-request` with `workspace-write`.** Rejected: it overrides a user who has chosen something stricter (`read-only`, managed requirements) or looser, and it diverges from what the same agent does when the user starts it by hand.
- **Auto-answer approvals from the daemon.** Rejected: an approval is the user's decision, and answering it would make the needs-input flag a lie.
- **Isolated Agentarium home with copied auth and config.** Rejected: copied credentials outlive the user's revocation, and a copied config drifts from the real one. The spikes needed isolated homes for capture and must stay spike-only.

## Evidence

[Permission modes research](../research/permission-modes.md). The effective Codex mode is resolved from CLI flags, project layers, profiles, user and system config, and managed requirements, so only the user's own home reproduces it. Hook payloads report the approval policy as `permission_mode` but not the sandbox. A nested `codex exec` inside a sandboxed Codex session cannot reach the network (`Reconnecting... waiting for network`), or with network access cannot find a home directory, so a launcher must not assume full access.
