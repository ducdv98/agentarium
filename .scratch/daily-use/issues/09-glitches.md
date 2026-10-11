# Record Glitches so the usage log is fed, not remembered

Status: ready-for-agent
Type: task
Blocked by: none

The usage log has stayed empty. Issues 06 and 08 were dismissed for lack of entries, and 07 was promoted by overriding the gate. The Daemon can see some wrong or late moments on its own, so it should record them as Glitches (`CONTEXT.md`). The user still decides which ones hurt triage by copying them into `usage-log.md`. This lands before the Phase 4 usage week starts (`.scratch/phase-4-act/spec.md`, Gate).

Decisions (from grilling, 2026-10-11):

- **The Daemon feeds the log; it doesn't replace it.** A detector can see the view was stale, but not whether the user was looking. The gate counts a Glitch only once the user copies it into `usage-log.md`.
- **Every install records Glitches**, locally, in their own file in the Agentarium home next to the event log. They are not Events: the event log holds facts about Agents that the reducer replays (ADR 0003), and a Glitch is a fact about the view.
- **No user text.** A Glitch holds Agent keys, State, Action category, tool name, Room and timings. It never holds summaries, prompt text or command lines.
- **Kept for 14 days or 1 MB**, whichever comes first.
- Daily-use 06 and 08 stay `wontfix`. Their reopen condition is a usage-log entry, which Glitches now make possible.

- [ ] **Stale client:** a client skipped for backpressure while some Agent has the Needs-input flag is recorded, with how long it stayed stale
- [ ] **Lost but alive:** an Event arriving for an Agent already marked lost is recorded, with how long it had been lost
- [ ] **Late session start:** an Agent whose first Event is not `session_start` is recorded
- [ ] **Codex live dropped:** the live connection going from connected to unavailable is recorded, with the reason
- [ ] Each Glitch is recorded once per occurrence, not once per message or tick, so a long stale period doesn't flood the file
- [ ] `agentarium glitches [--since <duration>]` (default 7 days) prints one usage-log bullet per Glitch: date, kind, Room, short Agent key and timings. It works with the Daemon stopped
- [ ] The file is trimmed to the last 14 days and at most 1 MB; a corrupt or partial line is skipped, not fatal
- [ ] A test feeds each of the four cases through a Daemon and finds exactly the expected Glitches, with no summary or prompt text in the file
- [ ] The README says what Glitches record, where they are kept, and that they never leave the machine

Later, not in this ticket: hook delivery failures (the hook would have to write them) and needs-input latency (once the Phase 4 cue exists).
