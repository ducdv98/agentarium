# Agentarium

A live visualization where every observed AI agent is a character in a shared scene, and what the agent is doing is visible as behavior. Its primary job is triage: seeing at a glance which agent needs the user.

## Language

### Agents and structure

**Agent**:
One observed AI worker, either a root session or a sub-agent.
_Avoid_: Bot, worker, session (a session is a provider concept; an agent may be a sub-agent inside one)

**Root agent**:
An agent not spawned by another observed agent.

**Sub-agent**:
An agent spawned by another observed agent.
_Avoid_: Child agent, helper

**Lead**:
Derived role of an agent that currently has active sub-agents. Never stored.
_Avoid_: Manager, parent (those are theme or graph words)

**Member**:
Derived role of an agent that has a parent. Never stored.

**Relationship**:
A typed link between two agents (spawned by, hands off to, reviews, shares workspace), labelled observed, inferred or declared according to how it is known.
_Avoid_: Edge, link

**Room**:
The scene for one repository; worktrees of the same repository share a room.
_Avoid_: Office, workspace, project (those are theme or user-facing words)

**Followed room**:
The Room the view currently shows. It moves to the Room that needs the user most, unless the user has pinned a Room.
_Avoid_: Active room, current room

**Group**:
A user-declared team of agents, independent of Room and Relationship.
_Avoid_: Department, team

**Topology**:
The way agents are combined: orchestrator and workers, peers, pipeline, review loop, swarm, multi-level hierarchy.

### What an agent is doing

**State**:
An agent's overall status: working, idle, waiting, blocked, lost or done.
_Avoid_: Status, mode

**Action category**:
A theme-neutral label for the agent's current activity: read, write, exec, search, network, delegate, think, wait or error. A closed set; themes can only express these.
_Avoid_: Tool type, activity

**Needs-input flag**:
True for an agent that is waiting on the user, or has any descendant that is. The basis of triage.
_Avoid_: Alert, notification

**Lost**:
State of an agent whose end was never observed and which has gone silent past a timeout. It is removed from the scene rather than left as a ghost.

### Observation

**Event**:
A normalized, provider-independent record that something happened to an agent.

**Adapter**:
Code that turns one source of provider signals into Events.
_Avoid_: Plugin, connector

**Daemon**:
The single local process that receives Events and serves the visualization.
_Avoid_: Server, backend

### Scene

**Theme**:
A swappable scene (office, farm, construction site) that maps core vocabulary to places, characters and animations. The core never uses theme words.
_Avoid_: Skin

**Station**:
A named place in a Theme where an Action category happens, with a capacity.
_Avoid_: Desk, workstation (office words)
