import { visibleAgents, type AgentState, type WorldState } from "@agentarium/core";
import { resolveAnimation, type Direction, type Theme } from "../theme";
import { createWalkGrid, type WalkGrid } from "./room";
import type { RoomLayout, SceneAgent, SceneFrame, Slot, Tile } from "./types";

/** Walking speed in tile edges per second. */
export const WALK_TILES_PER_SECOND = 2;

/** Duration of an appearance or disappearance, in milliseconds. */
export const FADE_MS = 1000;

/** Stable shirt palette, in 0xRRGGBB. */
export const SHIRT_COLOURS: readonly number[] = [
  0xe45756, 0x4c78a8, 0x59a14f, 0xf2cf5b, 0xb279a2, 0xff9d4d,
  0x76b7b2, 0xed83b5, 0x8c6d31, 0x9d9de0, 0x6bc5ef, 0xc7d879,
];

/** A pure scene driven by supplied world snapshots and renderer times. */
export interface IsoScene {
  /** Re-places every Agent at once on the new room (no walking). */
  setRoom(room: RoomLayout): void;
  /** Animations and state colours follow the theme from the next frame. */
  setTheme(theme: Theme): void;
  /** A snapshot or patched world at renderer time `now` (ms). */
  apply(world: WorldState, now: number): void;
  frame(now: number): SceneFrame;
}

interface Walk {
  tiles: Tile[];
  started: number;
  lookStep: number;
}

interface Resident {
  agent: AgentState;
  station: string;
  place: Slot;
  offset: { x: number; y: number };
  walk: Walk | null;
  appeared: number | null;
  fading: { started: number; frozen: SceneAgent } | null;
  animation: string | null;
  animationStarted: number;
  tint: number;
  stateColor: string;
  phase: number;
  themeChanged: boolean;
  /** What the look was last resolved for; it is resolved again only when one of these changes. */
  lookFor: { agent: AgentState; theme: Theme; direction: Direction; moving: boolean } | null;
}

interface Motion {
  column: number;
  row: number;
  depth: number;
  direction: Direction;
  moving: boolean;
}

const STEP_MS = 1000 / WALK_TILES_PER_SECOND;

function hash(key: string): number {
  let value = 2166136261;
  for (let i = 0; i < key.length; i++) {
    value = Math.imul(value ^ key.charCodeAt(i), 16777619);
  }
  return value >>> 0;
}

function tileKey(tile: Tile): string {
  return `${tile[0]},${tile[1]}`;
}

function compareAgents(a: AgentState, b: AgentState): number {
  return a.firstTs - b.firstTs || a.key.localeCompare(b.key);
}

function stationKey(room: RoomLayout, agent: AgentState): string {
  return agent.category && Object.hasOwn(room.stations, agent.category) ? agent.category : "rest";
}

function stepDirection(from: Tile, to: Tile): Direction {
  if (to[0] > from[0]) return "se";
  if (to[0] < from[0]) return "nw";
  return to[1] > from[1] ? "sw" : "ne";
}

function walkStep(walk: Walk, now: number): number {
  return Math.min(walk.tiles.length - 1, Math.floor(Math.max(0, now - walk.started) / STEP_MS));
}

function motionAt(resident: Resident, now: number): Motion {
  const walk = resident.walk;
  const step = walk ? walkStep(walk, now) : 0;
  if (!walk || step === walk.tiles.length - 1) {
    const [column, row] = resident.place.at;
    return { column, row, depth: column + row, direction: resident.place.facing, moving: false };
  }
  const from = walk.tiles[step]!;
  const to = walk.tiles[step + 1]!;
  const progress = Math.max(0, now - walk.started) / STEP_MS - step;
  return {
    column: from[0] + (to[0] - from[0]) * progress,
    row: from[1] + (to[1] - from[1]) * progress,
    depth: Math.max(from[0] + from[1], to[0] + to[1]),
    direction: stepDirection(from, to),
    moving: true,
  };
}

function sharedOffset(index: number): { x: number; y: number } {
  if (!index) return { x: 0, y: 0 };
  return { x: Math.cos(index * 2.4) * 12, y: Math.sin(index * 2.4) * 6 };
}

/** Agents per tile, and how many free tiles outside the Stations are left for overflow. */
class Occupancy {
  private readonly counts = new Map<string, number>();
  private overflowLeft: number;

  constructor(
    private readonly stationTiles: Set<string>,
    overflowTiles: number,
  ) {
    this.overflowLeft = overflowTiles;
  }

  has(key: string): boolean {
    return this.counts.has(key);
  }

  get(key: string): number | undefined {
    return this.counts.get(key);
  }

  /** No free tile is left outside the Stations, so overflow can skip its search. */
  get full(): boolean {
    return this.overflowLeft <= 0;
  }

  reserve(place: Slot): void {
    const key = tileKey(place.at);
    const count = this.counts.get(key) ?? 0;
    if (!count && !this.stationTiles.has(key)) this.overflowLeft--;
    this.counts.set(key, count + 1);
  }
}

function nearestPlace(
  slots: Slot[],
  grid: WalkGrid,
  occupied: Occupancy,
  stationTiles: Set<string>,
): Slot | null {
  if (occupied.full) return null;
  const queue = slots.map((slot) => ({ at: slot.at, facing: slot.facing }));
  const visited = new Set(queue.map((slot) => tileKey(slot.at)));
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]!;
    const key = tileKey(current.at);
    if (grid.walkable(current.at) && !stationTiles.has(key) && !occupied.has(key)) return current;
    for (const at of grid.neighbours(current.at)) {
      const nextKey = tileKey(at);
      if (visited.has(nextKey)) continue;
      visited.add(nextKey);
      queue.push({ at, facing: current.facing });
    }
  }
  return null;
}

function choosePlace(
  room: RoomLayout,
  grid: WalkGrid,
  station: string,
  occupied: Occupancy,
  stationTiles: Set<string>,
): Slot {
  const slots = room.stations[station]!.slots;
  const free = slots.find((slot) => !occupied.has(tileKey(slot.at)));
  if (free) return free;
  const overflow = nearestPlace(slots, grid, occupied, stationTiles);
  if (overflow) return overflow;
  let least = slots[0]!;
  for (const slot of slots) {
    if ((occupied.get(tileKey(slot.at)) ?? 0) < (occupied.get(tileKey(least.at)) ?? 0)) least = slot;
  }
  return least;
}

function reserve(occupied: Occupancy, place: Slot): void {
  occupied.reserve(place);
}

/** Walkable tiles that are no Station's slot: the most overflow places a room has. */
function countOverflowTiles(room: RoomLayout, grid: WalkGrid, stationTiles: Set<string>): number {
  let count = 0;
  for (let row = 0; row < room.size[1]; row++) {
    for (let column = 0; column < room.size[0]; column++) {
      if (grid.walkable([column, row]) && !stationTiles.has(tileKey([column, row]))) count++;
    }
  }
  return count;
}

function allStationTiles(room: RoomLayout): Set<string> {
  return new Set(Object.values(room.stations).flatMap((station) => station.slots.map((slot) => tileKey(slot.at))));
}

/** Creates the isometric scene model without graphics, timers or global randomness. */
export function createIsoScene(initialTheme: Theme, initialRoom: RoomLayout): IsoScene {
  let theme = initialTheme;
  let room = initialRoom;
  let grid = createWalkGrid(room);
  let stationTiles = allStationTiles(room);
  let overflowTiles = countOverflowTiles(room, grid, stationTiles);
  const residents = new Map<string, Resident>();
  let ordered: Resident[] = [];
  let firstSnapshot = true;

  function updateLook(resident: Resident, motion: Motion, now: number): void {
    const last = resident.lookFor;
    if (last && last.agent === resident.agent && last.theme === theme && last.direction === motion.direction && last.moving === motion.moving) {
      return;
    }
    resident.lookFor = { agent: resident.agent, theme, direction: motion.direction, moving: motion.moving };
    const animation = resolveAnimation(theme, resident.agent, motion.direction, motion.moving);
    if (animation !== resident.animation) {
      resident.animation = animation;
      resident.animationStarted = now;
    }
    resident.stateColor = (theme.states[resident.agent.status] ?? theme.fallback.state).color;
  }

  function advance(resident: Resident, now: number): Motion {
    const walk = resident.walk;
    if (walk) {
      const step = walkStep(walk, now);
      if (!resident.themeChanged) {
        // Use actual step boundaries even when the renderer skips frames.
        while (walk.lookStep < step) {
          walk.lookStep++;
          const boundary = walk.started + walk.lookStep * STEP_MS;
          updateLook(resident, motionAt(resident, boundary), boundary);
        }
      }
      walk.lookStep = step;
    }
    const motion = motionAt(resident, now);
    updateLook(resident, motion, now);
    resident.themeChanged = false;
    if (!motion.moving) resident.walk = null;
    return motion;
  }

  function renderAgent(resident: Resident, now: number): SceneAgent {
    if (resident.fading) {
      return {
        ...resident.fading.frozen,
        offset: { ...resident.fading.frozen.offset },
        animationTime: now - resident.animationStarted + resident.phase,
        alpha: Math.max(0, 1 - (now - resident.fading.started) / FADE_MS),
      };
    }
    const motion = advance(resident, now);
    return {
      key: resident.agent.key,
      ...motion,
      animation: resident.animation,
      animationTime: now - resident.animationStarted + resident.phase,
      tint: resident.tint,
      stateColor: resident.stateColor,
      alpha: resident.appeared === null ? 1 : Math.min(1, Math.max(0, (now - resident.appeared) / FADE_MS)),
      offset: { ...resident.offset },
    };
  }

  function setOffsets(): void {
    const counts = new Map<string, number>();
    for (const resident of ordered) {
      if (resident.fading) continue;
      const key = tileKey(resident.place.at);
      const index = counts.get(key) ?? 0;
      resident.offset = sharedOffset(index);
      counts.set(key, index + 1);
    }
  }

  function moveTo(resident: Resident, place: Slot, now: number): void {
    if (tileKey(resident.place.at) === tileKey(place.at)) {
      resident.place = place;
      return;
    }
    const walk = resident.walk;
    const standing = resident.place.at;
    resident.place = place;
    if (walk && walkStep(walk, now) < walk.tiles.length - 1) {
      // Mid-step: finish the step it is on, so it never jumps, then walk on from there.
      const step = walkStep(walk, now);
      const [from, to] = [walk.tiles[step]!, walk.tiles[step + 1]!];
      const path = grid.findPath(to, place.at);
      const progress = (now - walk.started) / STEP_MS - step;
      resident.walk = path ? { tiles: [from, to, ...path], started: now - progress * STEP_MS, lookStep: 0 } : null;
    } else {
      const from = walk ? walk.tiles[walk.tiles.length - 1]! : standing;
      const path = grid.findPath(from, place.at);
      resident.walk = path?.length ? { tiles: [from, ...path], started: now, lookStep: 0 } : null;
    }
    updateLook(resident, motionAt(resident, now), now);
  }

  function apply(world: WorldState, now: number): void {
    const agents = visibleAgents(world).filter((a) => a.status !== "done").sort(compareAgents);
    const live = new Map(agents.map((a) => [a.key, a]));
    const occupied = new Occupancy(stationTiles, overflowTiles);
    const needsPlace = new Set<string>();
    const returning = new Set<string>();
    for (const [key, resident] of residents) {
      if (resident.fading && now - resident.fading.started >= FADE_MS) {
        residents.delete(key);
        continue;
      }
      const agent = live.get(key);
      if (!agent) {
        if (!resident.fading) {
          const frozen = renderAgent(resident, now);
          frozen.moving = false;
          frozen.alpha = 1;
          resident.fading = { started: now, frozen };
          resident.walk = null;
        }
        continue;
      }
      const station = stationKey(room, agent);
      if (resident.fading) {
        resident.fading = null;
        resident.appeared = null;
        resident.walk = null;
        needsPlace.add(key);
        returning.add(key);
      } else {
        advance(resident, now);
        if (station !== resident.station) needsPlace.add(key);
      }
      resident.agent = agent;
      resident.station = station;
      if (!needsPlace.has(key)) reserve(occupied, resident.place);
    }
    for (const agent of agents) {
      const station = stationKey(room, agent);
      let resident = residents.get(agent.key);
      if (!resident) {
        const place = choosePlace(room, grid, station, occupied, stationTiles);
        const seed = hash(agent.key);
        resident = {
          agent, station, place, offset: { x: 0, y: 0 }, walk: null,
          appeared: firstSnapshot ? null : now, fading: null,
          animation: null, animationStarted: now, tint: SHIRT_COLOURS[seed % SHIRT_COLOURS.length]!,
          stateColor: "", phase: seed % 1000, themeChanged: false, lookFor: null,
        };
        residents.set(agent.key, resident);
        reserve(occupied, place);
      } else if (needsPlace.has(agent.key)) {
        const place = choosePlace(room, grid, station, occupied, stationTiles);
        if (returning.has(agent.key)) resident.place = place;
        else moveTo(resident, place, now);
        reserve(occupied, place);
      }
      updateLook(resident, motionAt(resident, now), now);
    }
    ordered = [...residents.values()].sort((a, b) => compareAgents(a.agent, b.agent));
    setOffsets();
    firstSnapshot = false;
  }

  function setRoom(next: RoomLayout): void {
    room = next;
    grid = createWalkGrid(room);
    stationTiles = allStationTiles(room);
    overflowTiles = countOverflowTiles(room, grid, stationTiles);
    const occupied = new Occupancy(stationTiles, overflowTiles);
    for (const resident of ordered) {
      if (resident.fading) continue;
      resident.station = stationKey(room, resident.agent);
      resident.place = choosePlace(room, grid, resident.station, occupied, stationTiles);
      resident.walk = null;
      reserve(occupied, resident.place);
    }
    for (const resident of ordered) {
      if (!resident.fading) continue;
      resident.station = stationKey(room, resident.agent);
      resident.place = choosePlace(room, grid, resident.station, occupied, stationTiles);
      const [column, row] = resident.place.at;
      resident.fading.frozen = {
        ...resident.fading.frozen, column, row, depth: column + row,
      };
    }
    setOffsets();
  }

  function setTheme(next: Theme): void {
    theme = next;
    for (const resident of ordered) resident.themeChanged = true;
  }

  function frame(now: number): SceneFrame {
    const agents: SceneAgent[] = [];
    let changing = false;
    let expired = false;
    for (const resident of ordered) {
      if (resident.fading && now - resident.fading.started >= FADE_MS) {
        residents.delete(resident.agent.key);
        expired = true;
        continue;
      }
      const shown = renderAgent(resident, now);
      agents.push(shown);
      if (shown.moving || resident.fading || shown.alpha < 1) changing = true;
    }
    if (expired) ordered = ordered.filter((resident) => residents.has(resident.agent.key));
    return { agents, changing };
  }

  return { setRoom, setTheme, apply, frame };
}
