import type { Direction } from "../theme";

/** A tile is `[column, row]` from the room's back corner (assets/README.md, "Scene assets and room layouts"). */
export type Tile = readonly [number, number];

export interface Placed {
  part: string;
  at: Tile;
  facing: Direction;
}

export interface Prop extends Placed {
  /** Draws over an Agent on the same tile, like a chair whose back faces the camera. */
  front?: boolean;
}

export interface Slot {
  at: Tile;
  facing: Direction;
}

/** The `layout.json` format of a scene asset. Parts are frames `<part>/<facing>/frame-000` in a Theme atlas. */
export interface RoomLayout {
  size: [number, number];
  floor: { legend: Record<string, string>; rows: string[] };
  walls?: Placed[];
  partitions?: Placed[];
  /** Parts that do not block their tile: an Agent may stand or sit there. */
  seats?: string[];
  props?: Prop[];
  /** One entry per action category plus `rest`, each with its slots. */
  stations: Record<string, { label: string; slots: Slot[] }>;
}

/** One Agent as the scene shows it at a moment. */
export interface SceneAgent {
  key: string;
  /** Position in tile units; fractional while walking. */
  column: number;
  row: number;
  /** Draw order among props and Agents: `column + row` of the tile it stands on (see `depthOf`). */
  depth: number;
  direction: Direction;
  moving: boolean;
  /** From `resolveAnimation`; null means the Renderer draws a placeholder. */
  animation: string | null;
  /** Milliseconds into the current animation, so each Agent starts its clip at its own phase. */
  animationTime: number;
  /** Seeded from the Agent's key: the same Agent keeps its colour across themes and reloads. */
  tint: number;
  /** The state style's colour from the Theme, as written there (any CSS colour). */
  stateColor: string;
  /** 1, except while fading in (new) or out (done, lost, removed). */
  alpha: number;
  /** Several Agents on one tile (a full room) are drawn apart by this many pixels at 1x. */
  offset: { x: number; y: number };
}

export interface SceneFrame {
  agents: SceneAgent[];
  /** True while anything moves or fades. Clips and markers animate on top of this; the Renderer adds those. */
  changing: boolean;
}
