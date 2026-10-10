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

export const DIRECTIONS = ["ne", "nw", "se", "sw"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const ANIMATED_STATES = ["idle", "waiting", "blocked"] as const;
export type AnimatedState = (typeof ANIMATED_STATES)[number];

export type Clip = Partial<Record<Direction, string>>;

/** Atlas paths are Pixi v8 spritesheet JSON files relative to the repository's assets directory. */
export interface Renderer2d {
  atlases: string[];
  walk?: Clip;
  states: Partial<Record<AnimatedState, Clip>>;
  categories: Partial<Record<ActionCategory, Clip>>;
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
  renderers?: { "2d"?: Renderer2d };
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

const isDirection = (key: string): key is Direction => (DIRECTIONS as readonly string[]).includes(key);

/** The clip's name for `direction`, else for the first direction it has. */
function clipAnimation(clip: Clip | undefined, direction: Direction): string | null {
  if (!clip || typeof clip !== "object") return null;
  for (const d of [direction, ...DIRECTIONS]) {
    const name: unknown = clip[d];
    if (typeof name === "string" && name) return name;
  }
  return null;
}

/**
 * Resolves the animation for an agent facing `direction`. Never fails: a missing clip falls back to idle,
 * then to null (the renderer draws a placeholder). Lost and done agents have no animation.
 */
export function resolveAnimation(
  theme: Theme,
  agent: Pick<AgentState, "status" | "category">,
  direction: Direction,
  moving: boolean,
): string | null {
  const r2d = theme?.renderers?.["2d"];
  if (!r2d || agent.status === "lost" || agent.status === "done") return null;
  const states = r2d.states ?? {};
  const categories = r2d.categories ?? {};
  const wanted: (Clip | undefined)[] = moving
    ? [r2d.walk]
    : agent.status === "working"
      ? [agent.category ? categories[agent.category] : undefined]
      : agent.status === "waiting"
        ? [states.waiting, categories.wait]
        : agent.status === "blocked"
          ? [states.blocked]
          : [];
  for (const clip of [...wanted, states.idle]) {
    const name = clipAnimation(clip, direction);
    if (name) return name;
  }
  return null;
}

/**
 * Returns a list of problems; empty means the theme is well formed. `strict` is for themes we ship:
 * it also fails on any missing station, atlas list, clip or direction in `renderers.2d`.
 */
export function validateTheme(theme: Theme, options: { strict?: boolean } = {}): string[] {
  const problems: string[] = [];
  const checkStation = (where: string, s: Station | undefined): void => {
    if (!s) problems.push(`${where}: missing`);
    else if (!s.id || !s.label || !(s.capacity >= 1)) problems.push(`${where}: needs id, label and capacity >= 1`);
  };
  checkStation("rest", theme.rest);
  checkStation("fallback.station", theme.fallback?.station);
  if (!theme.fallback?.state?.color) problems.push("fallback.state: needs a color");
  for (const c of Object.keys(theme.stations ?? {})) {
    if (!(ACTION_CATEGORIES as readonly string[]).includes(c)) problems.push(`stations.${c}: not an action category`);
  }
  for (const s of Object.keys(theme.states ?? {})) {
    if (!(AGENT_STATES as readonly string[]).includes(s)) problems.push(`states.${s}: not an agent state`);
  }
  for (const [c, s] of Object.entries(theme.stations ?? {})) checkStation(`stations.${c}`, s);
  const r2d = theme.renderers?.["2d"];
  if (!r2d) {
    if (options.strict) problems.push("renderers.2d: missing");
    return problems;
  }
  const checkClip = (where: string, clip: unknown): void => {
    if (clip === undefined) return;
    if (!clip || typeof clip !== "object") return void problems.push(`${where}: not a clip`);
    for (const [d, name] of Object.entries(clip)) {
      if (!isDirection(d)) problems.push(`${where}.${d}: not a direction`);
      if (typeof name !== "string" || !name) problems.push(`${where}.${d}: needs an animation name`);
    }
  };
  const atlases: unknown[] = Array.isArray(r2d.atlases) ? r2d.atlases : [];
  if (!Array.isArray(r2d.atlases)) problems.push("renderers.2d.atlases: not a list");
  atlases.forEach((a, i) => {
    if (typeof a !== "string" || !a) problems.push(`renderers.2d.atlases.${i}: needs a path`);
  });
  checkClip("renderers.2d.walk", r2d.walk);
  for (const [s, clip] of Object.entries(r2d.states ?? {})) {
    if (!(ANIMATED_STATES as readonly string[]).includes(s)) problems.push(`renderers.2d.states.${s}: not an animated state`);
    checkClip(`renderers.2d.states.${s}`, clip);
  }
  for (const [c, clip] of Object.entries(r2d.categories ?? {})) {
    if (!(ACTION_CATEGORIES as readonly string[]).includes(c)) problems.push(`renderers.2d.categories.${c}: not an action category`);
    checkClip(`renderers.2d.categories.${c}`, clip);
  }
  if (options.strict) {
    if (!atlases.length) problems.push("renderers.2d.atlases: empty");
    const requireClip = (where: string, clip: Clip | undefined): void => {
      if (!clip || typeof clip !== "object") return void problems.push(`${where}: missing`);
      for (const d of DIRECTIONS) if (!clip[d]) problems.push(`${where}.${d}: missing`);
    };
    requireClip("renderers.2d.walk", r2d.walk);
    for (const s of ANIMATED_STATES) requireClip(`renderers.2d.states.${s}`, r2d.states?.[s]);
    for (const c of ACTION_CATEGORIES) {
      requireClip(`renderers.2d.categories.${c}`, r2d.categories?.[c]);
      if (!(c in (theme.stations ?? {}))) problems.push(`stations.${c}: missing`);
    }
  }
  return problems;
}
