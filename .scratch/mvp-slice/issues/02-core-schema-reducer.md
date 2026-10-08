# core: Event schema, reducer, fixtures

Status: resolved
Type: task
Blocked by: 01

Pure TypeScript package, no I/O. Versioned AgentEvent with full identity, reducer producing State, Action category, Relationship (spawned by), Needs-input flag rollup to ancestors, idle and lost timeouts (pending tool call blocks idle).

Acceptance: deterministic tests replaying ticket 01 fixtures; sub-agent and lost cases covered.

## Comments

## Answer

Implemented in `packages/core` (`types.ts`, `reducer.ts`, `selectors.ts`); 29 tests in `packages/core/test`, including replays of the ticket 01 fixtures. Notes:

- `tick` is an Event so idle and lost timeouts replay deterministically.
- A repeat `spawn` only refines the link; in real payloads `PostToolUse(Agent)` arrives after `SubagentStop`, so it must not revive the sub-agent.
- `blocked` means the last tool failed; it clears on the next event from that agent.
- Needs-input and Lead/Member are selectors, never stored. Lost agents stay in state but `visibleAgents` hides them.
- A minimal pnpm workspace root was added to host the package; ticket 06 owns CI.
