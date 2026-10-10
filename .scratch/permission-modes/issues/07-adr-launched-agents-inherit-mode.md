# 07: ADR: anything Agentarium launches inherits the user's permission mode

**What to build:** A recorded decision that any future Agentarium-owned agent or app-server connection runs with the user's effective approval and sandbox mode. Agentarium never forces bypass, never answers approvals on the user's behalf, and never copies the user's auth or config into a shared home. Agentarium launches nothing today; this fixes the rule before a feature needs it.

**Blocked by:** 01

**Status:** resolved

- [x] An ADR in `docs/adr/` records the decision, the alternatives considered, and the evidence from the research doc
- [x] It states how the inherited mode is made visible in Agentarium's own launch metadata
- [x] `CONTEXT.md` is updated if the decision introduces a new term

## Answer

[ADR 0006](../../../docs/adr/0006-launched-agents-inherit-the-users-permission-mode.md). Added the term **Permission mode** to `CONTEXT.md`.
