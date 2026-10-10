# 09: Confirm event-model gaps against captures

**What to build:** A written decision for each Codex event gap in `docs/research/codex-event-mapping.md`, based on the captures from ticket 05 and the adapter's behavior from ticket 06. Phase 2 records the decisions; it does not change the schema.

**Blocked by:** 05, 06

**Status:** resolved

- [x] Each gap is marked confirmed, not reproduced, or not applicable, with the capture that settles it
- [x] A neutral resume/input-resolved event: decided yes or no, with the reason
- [x] A standalone error event: decided yes or no, with the reason
- [x] Sub-agent termination: decided between live shutdown outcomes and accepting lost-timeout cleanup
- [x] Any decision that changes the schema is recorded as a follow-up ticket, not implemented here

Decisions: `docs/research/codex-gap-decisions.md`.

## Comments

**Agent decisions (2026-10-10), please review:**
- **Neutral resume/input-resolved event: no.** On `serverRequest/resolved`, the live connection sends the open tool's `tool_start` again, which restores the working state and keeps pending calls. Hook-only sessions clear the wait with the next `PostToolUse`, tool, or `Stop`. Revisit if the usage log shows stale waits.
- **Standalone error event: no.** No capture showed a turn-level failure, and every tool failure maps to a failed `tool_end`.
- **Sub-agent termination: accept lost-timeout cleanup,** plus ending every tracked sub-agent at the root's `SessionEnd`. No live signal for a permanent shutdown was observed.
- Gap 3 (hosted tools have no hooks) and gap 6 (no ambient event bus) were **not reproduced** in 0.160.0: web search reaches hooks as `webrun`, and TUI sessions can be observed through the shared app-server daemon.
- None of these decisions changes the schema, so no follow-up ticket was created.
