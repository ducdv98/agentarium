# core: Event schema, reducer, fixtures

Status: ready-for-agent
Type: task
Blocked by: 01

Pure TypeScript package, no I/O. Versioned AgentEvent with full identity, reducer producing State, Action category, Relationship (spawned by), Needs-input flag rollup to ancestors, idle and lost timeouts (pending tool call blocks idle).

Acceptance: deterministic tests replaying ticket 01 fixtures; sub-agent and lost cases covered.

## Comments
