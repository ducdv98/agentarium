import {
  ROOT_AGENT,
  isLead,
  isMember,
  needsInput,
  type ActionCategory,
  type AgentStatus,
  type WorldState,
} from "@agentarium/core";

export interface RosterRow {
  key: string;
  label: string;
  status: AgentStatus;
  category: ActionCategory | null;
  summary: string | null;
  needsInput: boolean;
  lead: boolean;
  member: boolean;
  depth: number;
}

const STATUS_ORDER: Record<AgentStatus, number> = {
  waiting: 0,
  blocked: 1,
  working: 2,
  idle: 3,
  done: 4,
  lost: 5,
};

/**
 * Triage order: agents that need the user come first, then by state. Lost agents are
 * removed from the scene, so they are not listed either.
 */
export function buildRoster(world: WorldState): RosterRow[] {
  const depthOf = (key: string): number => {
    let depth = 0;
    const seen = new Set<string>();
    for (let p = world.agents[key]?.parent; p && !seen.has(p); p = world.agents[p]?.parent) {
      seen.add(p);
      depth += 1;
    }
    return depth;
  };
  return Object.values(world.agents)
    .filter((a) => a.status !== "lost")
    .map((a): RosterRow & { firstTs: number } => ({
      key: a.key,
      label: a.ref.agent === ROOT_AGENT ? `session ${a.ref.session.slice(0, 8)}` : `sub-agent ${a.ref.agent.slice(0, 8)}`,
      status: a.status,
      category: a.category,
      summary: a.summary,
      needsInput: needsInput(world, a.key),
      lead: isLead(world, a.key),
      member: isMember(world, a.key),
      depth: depthOf(a.key),
      firstTs: a.firstTs,
    }))
    .sort(
      (x, y) =>
        Number(y.needsInput) - Number(x.needsInput) ||
        STATUS_ORDER[x.status] - STATUS_ORDER[y.status] ||
        x.firstTs - y.firstTs ||
        x.key.localeCompare(y.key),
    )
    .map(({ firstTs: _firstTs, ...row }) => row);
}

export const needsInputCount = (rows: readonly RosterRow[]): number => rows.filter((r) => r.needsInput).length;
