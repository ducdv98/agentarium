# 09: Confirm event-model gaps against captures

**What to build:** A written decision for each Codex event gap in `docs/research/codex-event-mapping.md`, based on the captures from ticket 05 and the adapter's behavior from ticket 06. Phase 2 records the decisions; it does not change the schema.

**Blocked by:** 05, 06

**Status:** ready-for-agent

- [ ] Each gap is marked confirmed, not reproduced, or not applicable, with the capture that settles it
- [ ] A neutral resume/input-resolved event: decided yes or no, with the reason
- [ ] A standalone error event: decided yes or no, with the reason
- [ ] Sub-agent termination: decided between live shutdown outcomes and accepting lost-timeout cleanup
- [ ] Any decision that changes the schema is recorded as a follow-up ticket, not implemented here
