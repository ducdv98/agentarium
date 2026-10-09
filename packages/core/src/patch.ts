import type { AgentState, WorldState } from "./types";

export interface WorldPatch {
  upserts: AgentState[];
  removed: string[];
  now: number;
}

export type ServerMessage =
  | { type: "snapshot"; room: string; seq: number; world: WorldState }
  | { type: "patch"; room: string; seq: number; patch: WorldPatch };

/** Announced to every client so a UI can offer, or follow, other rooms. */
export interface RoomSummary {
  id: string;
  /** Agents still in the scene (not lost). */
  agents: number;
  /** Agents currently waiting on the user. */
  waiting: number;
  lastActive: number;
}

export type RoomsMessage = { type: "rooms"; rooms: RoomSummary[] };

export type ClientMessage = { type: "resync" } | { type: "join"; room: string };

const same = (a: AgentState, b: AgentState): boolean => JSON.stringify(a) === JSON.stringify(b);

export function diffWorld(prev: WorldState, next: WorldState): WorldPatch {
  const upserts = Object.values(next.agents).filter((a) => {
    const before = prev.agents[a.key];
    return !before || !same(before, a);
  });
  const removed = Object.keys(prev.agents).filter((k) => !(k in next.agents));
  return { upserts, removed, now: next.now };
}

export function applyPatch(world: WorldState, patch: WorldPatch): WorldState {
  const agents = { ...world.agents };
  for (const key of patch.removed) delete agents[key];
  for (const a of patch.upserts) agents[a.key] = a;
  return { agents, now: patch.now };
}

export interface PatchClient {
  readonly world: WorldState;
  readonly seq: number;
  /** "gap" means the caller must send a `resync` message; the message was not applied. */
  handle(msg: ServerMessage): "ok" | "gap";
}

export function createPatchClient(): PatchClient {
  let world: WorldState = { agents: {}, now: 0 };
  let seq = -1;
  return {
    get world() {
      return world;
    },
    get seq() {
      return seq;
    },
    handle(msg) {
      if (msg.type === "snapshot") {
        world = msg.world;
        seq = msg.seq;
        return "ok";
      }
      if (seq < 0 || msg.seq !== seq + 1) return "gap";
      world = applyPatch(world, msg.patch);
      seq = msg.seq;
      return "ok";
    },
  };
}
