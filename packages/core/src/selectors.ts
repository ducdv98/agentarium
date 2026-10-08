import type { AgentState, Relationship, WorldState } from "./types";

const live = (a: AgentState): boolean => a.status !== "done" && a.status !== "lost";

export function children(world: WorldState, key: string): AgentState[] {
  return Object.values(world.agents).filter((a) => a.parent === key);
}

/** Agents shown in the scene: lost agents are removed, not left as ghosts. */
export function visibleAgents(world: WorldState): AgentState[] {
  return Object.values(world.agents).filter((a) => a.status !== "lost");
}

/** Needs-input flag: the agent is waiting, or any live descendant is. Derived, never stored. */
export function needsInput(world: WorldState, key: string): boolean {
  const agent = world.agents[key];
  if (!agent || !live(agent)) return false;
  return agent.status === "waiting" || children(world, key).some((c) => needsInput(world, c.key));
}

/** Lead: currently has live sub-agents. Derived, never stored. */
export function isLead(world: WorldState, key: string): boolean {
  return children(world, key).some(live);
}

/** Member: has a parent. Derived, never stored. */
export function isMember(world: WorldState, key: string): boolean {
  return world.agents[key]?.parent != null;
}

export function relationships(world: WorldState): Relationship[] {
  return Object.values(world.agents).flatMap((a) =>
    a.parent && a.parentProvenance
      ? [{ type: "spawned_by" as const, from: a.key, to: a.parent, provenance: a.parentProvenance }]
      : [],
  );
}
