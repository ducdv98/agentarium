# 06: Codex lifecycle hooks show in the room

**What to build:** A Codex CLI session appears as a character in the room, moving through the thinking, tool and idle states, driven only by trusted lifecycle and tool hooks. The Codex hook install goes through the safe install path from the first install-safety slice.

**Blocked by:** 04, 05

**Status:** ready-for-agent

- [ ] Starting a Codex session adds a character to the room
- [ ] A Codex tool call shows the tool's category, mapped under ADR 0004
- [ ] A completed Codex turn shows as idle, not as needs-input
- [ ] Codex hook install uses the same guarded write path as Claude Code install
- [ ] Fixtures from ticket 05 drive the tests
