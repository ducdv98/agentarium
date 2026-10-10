import {
  DEFAULT_TIMEOUTS,
  type ActionCategory,
  type AgentEvent,
  type AgentRef,
  type AgentState,
  type Timeouts,
  type WorldState,
} from "./types";

export const agentKey = (r: AgentRef): string => `${r.machine}:${r.provider}:${r.session}:${r.agent}`;

export const emptyWorld = (): WorldState => ({ agents: {}, now: 0 });

/** Pure: returns a new state and never mutates `state` or `event`. */
export function reduce(
  state: WorldState,
  event: AgentEvent,
  timeouts: Timeouts = DEFAULT_TIMEOUTS,
): WorldState {
  const world: WorldState = {
    agents: { ...state.agents },
    now: Math.max(state.now, event.ts),
  };

  if (event.kind === "tick") {
    for (const [key, agent] of Object.entries(world.agents)) {
      const next = applyTimeouts(agent, world.now, timeouts);
      if (next !== agent) world.agents[key] = next;
    }
    return world;
  }

  const key = agentKey(event.agent);
  // Claude Code's internal helper agents send SubagentStop without SubagentStart.
  if (event.kind === "end" && !world.agents[key]) return world;
  const current = world.agents[key] ?? create(event.agent, key, event.ts);
  const agent: AgentState = { ...current, pending: { ...current.pending }, lastTs: event.ts };
  if (event.permission_mode) agent.permissionMode = event.permission_mode;
  world.agents[key] = agent;

  switch (event.kind) {
    case "session_start":
      setIdle(agent);
      break;
    case "prompt":
      agent.pending = {};
      setWorking(agent, "think", null, null);
      break;
    case "tool_start":
      agent.pending[event.tool_use_id] = { tool: event.tool, category: event.category };
      setWorking(agent, event.category, event.tool, event.summary ?? null);
      break;
    case "tool_end":
      delete agent.pending[event.tool_use_id];
      if (!event.ok) {
        agent.status = "blocked";
        agent.category = "error";
        agent.tool = null;
      } else {
        const remaining = Object.values(agent.pending).at(-1);
        if (remaining) setWorking(agent, remaining.category, remaining.tool, null);
        else setWorking(agent, "think", null, null);
      }
      break;
    case "needs_input":
      agent.status = "waiting";
      agent.category = "wait";
      agent.summary = event.summary ?? agent.summary;
      break;
    case "spawn":
      if (state.agents[key]) {
        // A repeat spawn only refines the link (e.g. inferred -> observed). It can
        // arrive after the sub-agent ended, so it must not revive it or reset its clock.
        world.agents[key] = current;
      } else {
        setWorking(agent, "think", null, null);
      }
      link(world, key, event.parent, event.provenance, event.ts);
      break;
    case "stop":
      agent.pending = {};
      setIdle(agent);
      break;
    case "end":
      agent.pending = {};
      agent.status = "done";
      agent.category = null;
      agent.tool = null;
      break;
  }
  return world;
}

export function replay(
  events: readonly AgentEvent[],
  timeouts: Timeouts = DEFAULT_TIMEOUTS,
  from: WorldState = emptyWorld(),
): WorldState {
  return events.reduce((w, ev) => reduce(w, ev, timeouts), from);
}

function create(ref: AgentRef, key: string, ts: number): AgentState {
  return {
    key,
    ref,
    parent: null,
    parentProvenance: null,
    status: "idle",
    category: null,
    tool: null,
    summary: null,
    permissionMode: null,
    pending: {},
    firstTs: ts,
    lastTs: ts,
  };
}

function setWorking(
  agent: AgentState,
  category: ActionCategory,
  tool: string | null,
  summary: string | null,
): void {
  agent.status = "working";
  agent.category = category;
  agent.tool = tool;
  agent.summary = summary;
}

function setIdle(agent: AgentState): void {
  agent.status = "idle";
  agent.category = null;
  agent.tool = null;
  agent.summary = null;
}

function applyTimeouts(agent: AgentState, now: number, t: Timeouts): AgentState {
  if (agent.status === "done" || agent.status === "lost") return agent;
  const silent = now - agent.lastTs;
  if (silent >= (agent.status === "waiting" ? t.waitingLostMs : t.lostMs)) {
    return { ...agent, status: "lost", category: null, tool: null, summary: null, pending: {} };
  }
  if (agent.status === "working" && silent >= t.idleMs && Object.keys(agent.pending).length === 0) {
    return { ...agent, status: "idle", category: null, tool: null, summary: null };
  }
  return agent;
}

/** Records `child` as spawned by `parentRef`, refusing links that would form a cycle. */
function link(
  world: WorldState,
  childKey: string,
  parentRef: AgentRef,
  provenance: AgentState["parentProvenance"],
  ts: number,
): void {
  const parentKey = agentKey(parentRef);
  if (parentKey === childKey || isAncestor(world, childKey, parentKey)) return;
  world.agents[parentKey] ??= create(parentRef, parentKey, ts);
  const child = world.agents[childKey];
  if (child) world.agents[childKey] = { ...child, parent: parentKey, parentProvenance: provenance };
}

/** True when `ancestor` is `key` or one of its ancestors. */
function isAncestor(world: WorldState, ancestor: string, key: string): boolean {
  const seen = new Set<string>();
  for (let k: string | null = key; k && !seen.has(k); k = world.agents[k]?.parent ?? null) {
    if (k === ancestor) return true;
    seen.add(k);
  }
  return false;
}
