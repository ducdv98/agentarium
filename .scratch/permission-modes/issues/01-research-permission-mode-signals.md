# 01: Research: which signals each permission mode produces

**What to build:** A comparison, for Codex CLI and Claude Code, of every permission mode: how Agentarium can tell which mode is in effect, which signals fire when the agent needs the user, on approve, and on deny or abort, and where no signal fires at all.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] Codex approval policies, sandbox modes (including the Windows sandbox variants), auto-review, and how the effective mode is resolved
- [x] Claude Code permission modes, allow/ask/deny rules, sandbox, and how the effective mode is resolved
- [x] A matrix per CLI plus implications for Agentarium and a list of cases that need a human capture

## Answer

[docs/research/permission-modes.md](../../../docs/research/permission-modes.md). It is desk research plus the earlier spikes (Codex 0.160.0, Claude Code 2.1.294). No new live captures: the run discarded its captures after a setup script was pointed at the real `CODEX_HOME` (PowerShell `$home` collides with the built-in `$HOME`). The real config was verified unchanged. Tickets 02 and 04 do the captures.
