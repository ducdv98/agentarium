# Topologies and sub-agents

How the model handles an agent that spawns sub-agents, and the other ways
developers combine agents. Terms follow [glossary.md](glossary.md).

Research date: 2026-10-08. Claude Code details were read from its hooks and
OpenTelemetry docs. Codex details come from search summaries and need
confirmation on a real install.

## Principle

Model structure separately from layout. Keep three independent things:

1. **Agents**: identity, state, appearance. Nothing here says "lead" or
   "member".
2. **Relationships**: typed edges, each with a source of truth.
3. **Groups**: zones agents belong to (repo, project, declared team).

Roles such as lead and member are derived from the graph. The layout is derived
from the graph plus the theme. A new topology means a new layout mode, not a
schema change. Never encode structure in an agent's identity.

## Sub-agents

### Data model

- Every agent has `agent_id` and nullable `parent_id`.
- Key sub-agents as `<session_id>:<agent_id>`. Claude Code includes `agent_id`
  and `agent_type` in hook payloads fired inside a sub-agent.
- `spawn` and `stop` are first-class event kinds. `SubagentStart` and
  `SubagentStop` (Claude Code, Codex) map to them directly.
- The daemon stores the tree and runs one state machine per node. A parent's
  state is a function of its own events and its children's.
- Not verified: whether the hook payload names the parent tool call that
  spawned the child. Claude Code traces nest sub-agent spans under the
  parent's `claude_code.tool` span, so use tracing or `tool_use_id` for exact
  parentage. Otherwise infer it: a `SubagentStart` that arrives while the
  parent has a pending `delegate` tool call.

### Behaviors the visualization needs

- **Spawn**: a visible handoff from parent to a new member.
- **While children run**: the parent shows a supervising state, linked to its
  children.
- **Return**: the child reports back, then leaves. A failed child reports an
  error.
- **Parallel children**: cluster them near the parent rather than scattering.

### Edge cases

| Case | Handling |
|---|---|
| Nested spawns | Arbitrary depth in the model; collapse beyond depth 2 into a count badge in the UI |
| Missing stop event (crash, kill, closed terminal) | Timeout, mark `lost`, remove the character. No ghosts |
| Many parallel children | Cap visible characters, show "+N more", provide a roster panel |
| Providers without sub-agent events (Gemini CLI, Cursor as documented) | Infer from the parent's `delegate` tool calls, or show a generic helper only while that tool runs |
| Sub-agents sharing the parent's transcript | Ephemeral member with no own history; click opens the parent's transcript |
| Long-lived team agents (Claude Code `TeammateIdle`, `TaskCreated`) | Persistent member, not an ephemeral sub-agent |
| Sub-agent needs permission | Waiting state on the child, plus a needs-input flag bubbled up to every ancestor |

### Rollups

- A parent's needs-input flag is true if it or any descendant needs input.
- Cost and tokens aggregate up the tree. Show the root's total, with a
  per-child breakdown on click.

## Topology coverage

| Topology | Relationships | Layout idea | Observable? |
|---|---|---|---|
| **Orchestrator + workers** | `spawned_by` tree | Lead with a member pod | Yes, from spawn events |
| **Peers with different areas** | Few or none | Open floor, grouped by area (repo, directory, label) | Agents yes; areas only via `cwd` or user label |
| **Pipeline** (planner, coder, reviewer) | `hands_off_to` | Work visibly moves between stations in order | Rarely; only if the framework emits handoffs or the user declares it |
| **Review loop / debate** | Cyclic `reviews` | Two agents with a back-and-forth thread | Weakly, inferred from message patterns |
| **Swarm / shared blackboard** | `shares_workspace` | Everyone around a shared surface | Inferred from same `cwd` and file touches |
| **Multi-level hierarchy** | Deeper `spawned_by` tree | Groups inside groups, collapsed past depth 2 | Yes, with a depth cap |

## Three tiers of relationship knowledge

Only spawn relationships are cheap to observe. Hooks do not announce who
separate processes are coordinating with.

| Tier | Examples | Trust |
|---|---|---|
| **Observed** | Spawn edges from `SubagentStart/Stop`, trace nesting | High |
| **Inferred** | Same `cwd`, same files touched, temporal handoff (A stops, B starts on the same files) | Heuristic; mark "likely" in the UI |
| **Declared** | Optional `agentarium.yml` naming teams, roles, pipeline order | High; the only reliable way to show complex setups |

## Scope

- **MVP**: agents, `spawned_by` edges (depth 1, Claude Code only), repo-based
  groups, timeout cleanup, needs-input bubbling.
- **Next**: declared config (teams, labels, pipeline order); depth cap, pod
  layout, inferred sub-agents for other providers.
- **Later**: inferred relationships for peers and swarms, labeled as guesses.

## Open questions

- Does `SubagentStart` carry the spawning tool call id? Check with a payload
  dump on a real Claude Code session.
- Can Codex hooks distinguish sub-agent events from the parent's?
- How should two root sessions in the same repo be grouped when they are
  unrelated (shared group, separate leads)?
