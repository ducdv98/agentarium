import { needsInput, type AgentState, type WorldState } from "@agentarium/core";
import { resolveAgent, type Resolved, type Theme } from "./theme";

export interface Dot {
  key: string;
  col: number;
  row: number;
  resolved: Resolved;
  agent: AgentState;
}

export interface Lane {
  id: string;
  label: string;
  col: number;
  cols: number;
}

export interface Layout {
  lanes: Lane[];
  dots: Dot[];
  cols: number;
  rows: number;
}

/** Pure grid layout: one lane per station in use, agents stacked by first-seen time. */
export function layoutWorld(theme: Theme, world: WorldState, agents: AgentState[]): Layout {
  const byStation = new Map<string, { label: string; capacity: number; members: Dot[] }>();
  const dots: Dot[] = [];
  for (const agent of agents.slice().sort((a, b) => a.firstTs - b.firstTs || a.key.localeCompare(b.key))) {
    const resolved = resolveAgent(theme, agent, needsInput(world, agent.key));
    const { station } = resolved;
    let lane = byStation.get(station.id);
    if (!lane) {
      lane = { label: station.label, capacity: station.capacity, members: [] };
      byStation.set(station.id, lane);
    }
    const index = lane.members.length;
    const dot: Dot = {
      key: agent.key,
      col: Math.floor(index / lane.capacity), // relative for now
      row: index % lane.capacity,
      resolved,
      agent,
    };
    lane.members.push(dot);
    dots.push(dot);
  }

  const lanes: Lane[] = [];
  let col = 0;
  let rows = 0;
  for (const [id, lane] of byStation) {
    const cols = Math.max(1, Math.ceil(lane.members.length / lane.capacity));
    for (const d of lane.members) {
      d.col += col;
      rows = Math.max(rows, d.row + 1);
    }
    lanes.push({ id, label: lane.label, col, cols });
    col += cols + 1; // one empty column between lanes
  }
  return { lanes, dots, cols: Math.max(0, col - 1), rows };
}
