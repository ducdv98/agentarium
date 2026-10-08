# Glossary

Neutral terms used in the core (event schema, daemon, adapters, reducer, docs
outside a theme section). Core code and docs must not use theme words such as
"manager", "department", "desk" or "office". Those belong to themes only (see
[themes.md](themes.md)).

| Term | Meaning |
|---|---|
| **Agent** | One observed AI worker: a root session or a sub-agent. Has a stable `agent_id`. |
| **Root agent** | An agent not spawned by another observed agent (`parent_id` is null). |
| **Sub-agent** | An agent spawned by another agent (`parent_id` set). |
| **Lead** | Derived role, not stored: an agent that currently has active children. |
| **Member** | Derived role, not stored: an agent that has a parent. |
| **Relationship** | A typed edge between agents: `spawned_by`, `hands_off_to`, `reviews`, `shares_workspace`. Has a `source` of `observed`, `inferred` or `declared`. |
| **Group** | A zone that agents belong to: a repo, a project, or a user-declared team. Independent of relationships. |
| **State** | The reducer's current status for an agent: `working`, `idle`, `waiting`, `blocked`, `lost`, `done`. |
| **Action category** | What the agent is doing, as a theme-neutral label: `read`, `write`, `exec`, `search`, `network`, `delegate`, `think`, `wait`, `error`. |
| **Event** | A normalized `AgentEvent` emitted by an adapter. |
| **Adapter** | Code that turns one source (hooks, OTel, log tail, proxy, process watcher) into events. |
| **Daemon** | Local process that receives events, runs the reducer, and serves the UI over WebSocket. |
| **Theme** | A data-and-assets package that maps the core vocabulary to a scene (office, farm, construction site). |
| **Station** | A named place in a theme scene where an action category happens, with a capacity. |
| **Topology** | How agents are combined: orchestrator-workers, peers, pipeline, review loop, swarm, multi-level hierarchy. |
