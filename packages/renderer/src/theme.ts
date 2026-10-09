import {
  ACTION_CATEGORIES,
  AGENT_STATES,
  type ActionCategory,
  type AgentState,
  type AgentStatus,
} from "@agentarium/core";

/** Animation names a renderer may understand; unknown names render as "none". */
export type Animation = "none" | "pulse" | "blink" | "fade";

export interface StateStyle {
  color: string;
  animation: Animation;
}

export interface Station {
  id: string;
  label: string;
  /** Agents per column before the station grows another column. */
  capacity: number;
}

/**
 * A theme is data only: it maps the core vocabulary (states, action categories) to
 * places and looks. Entries may be omitted; `fallback` and `rest` cover the gaps.
 */
export interface Theme {
  id: string;
  name: string;
  /** UI words for derived roles. */
  vocabulary: { lead: string; member: string; room: string };
  palette: { background: string; ink: string; alert: string };
  states: Partial<Record<AgentStatus, StateStyle>>;
  stations: Partial<Record<ActionCategory, Station>>;
  /** Where agents without an action category (idle, done) are shown. */
  rest: Station;
  fallback: { state: StateStyle; station: Station };
}

export interface Resolved {
  station: Station;
  style: StateStyle;
  needsInput: boolean;
}

/** Resolves `agent + state + category` to a station and look. Never fails: gaps use the fallback. */
export function resolveAgent(theme: Theme, agent: AgentState, needsInput: boolean): Resolved {
  const station = agent.category
    ? (theme.stations[agent.category] ?? theme.fallback.station)
    : theme.rest;
  const style = theme.states[agent.status] ?? theme.fallback.state;
  return { station, style, needsInput };
}

/** Returns a list of problems; empty means the theme is well formed. */
export function validateTheme(theme: Theme): string[] {
  const problems: string[] = [];
  const checkStation = (where: string, s: Station | undefined): void => {
    if (!s) problems.push(`${where}: missing`);
    else if (!s.id || !s.label || !(s.capacity >= 1)) problems.push(`${where}: needs id, label and capacity >= 1`);
  };
  checkStation("rest", theme.rest);
  checkStation("fallback.station", theme.fallback?.station);
  if (!theme.fallback?.state?.color) problems.push("fallback.state: needs a color");
  for (const c of Object.keys(theme.stations)) {
    if (!(ACTION_CATEGORIES as readonly string[]).includes(c)) problems.push(`stations.${c}: not an action category`);
  }
  for (const s of Object.keys(theme.states)) {
    if (!(AGENT_STATES as readonly string[]).includes(s)) problems.push(`states.${s}: not an agent state`);
  }
  for (const [c, s] of Object.entries(theme.stations)) checkStation(`stations.${c}`, s);
  return problems;
}
