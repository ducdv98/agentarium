import { ACTION_CATEGORIES } from "@agentarium/core";
import { DIRECTIONS, type Theme } from "../theme";
import type { RoomLayout, Tile } from "./types";

/** The full floor diamond's width in 1x pixels. */
export const TILE_WIDTH = 128;

/** The full floor diamond's height in 1x pixels. */
export const TILE_HEIGHT = 64;

/** Projects a tile centre relative to tile [0, 0], in 1x pixels. */
export function tileToScreen(column: number, row: number): { x: number; y: number } {
  return { x: (column - row) * 64, y: (column + row) * 32 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSize(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2
    && value.every((n) => Number.isSafeInteger(n) && n > 0);
}

function isTile(value: unknown, size: [number, number] | null): value is Tile {
  if (!Array.isArray(value) || value.length !== 2) return false;
  return value.every((n, i) => Number.isSafeInteger(n) && n >= 0 && (!size || n < size[i]!));
}

function checkPlacement(
  value: unknown,
  where: string,
  size: [number, number] | null,
  needsPart: boolean,
  problems: string[],
): void {
  if (!isRecord(value)) {
    problems.push(`${where}: needs an object`);
    return;
  }
  if (!isTile(value.at, size)) problems.push(`${where}.at: needs an in-bounds tile`);
  if (!(DIRECTIONS as readonly unknown[]).includes(value.facing)) {
    problems.push(`${where}.facing: needs ne, nw, se or sw`);
  }
  if (needsPart && (typeof value.part !== "string" || !value.part)) {
    problems.push(`${where}.part: needs a part name`);
  }
}

function checkRoom(json: unknown, problems: string[]): void {
  if (!isRecord(json)) {
    problems.push("room: needs an object");
    return;
  }
  const size = isSize(json.size) ? json.size : null;
  if (!size) problems.push("size: needs two positive integer dimensions");
  const floor = isRecord(json.floor) ? json.floor : {};
  const legend = isRecord(floor.legend) ? floor.legend : null;
  if (!legend) problems.push("floor.legend: needs a character-to-part map");
  else {
    for (const [character, part] of Object.entries(legend)) {
      if (character.length !== 1 || typeof part !== "string" || !part) {
        problems.push(`floor.legend.${character}: needs one character and a part name`);
      }
    }
  }
  if (!Array.isArray(floor.rows)) problems.push("floor.rows: needs a list of strings");
  else {
    if (size && floor.rows.length !== size[1]) problems.push("floor.rows: wrong row count");
    floor.rows.forEach((row: unknown, i: number) => {
      if (typeof row !== "string" || (size && row.length !== size[0])) {
        problems.push(`floor.rows.${i}: needs a string of the room's width`);
      } else if (legend && [...row].some((c) => c !== " " && !Object.hasOwn(legend, c))) {
        problems.push(`floor.rows.${i}: has a character missing from the legend`);
      }
    });
  }
  for (const name of ["walls", "partitions", "props"] as const) {
    const items = json[name];
    if (items === undefined) continue;
    if (!Array.isArray(items)) {
      problems.push(`${name}: needs a list`);
      continue;
    }
    items.forEach((item: unknown, i: number) => {
      const where = `${name}.${i}`;
      checkPlacement(item, where, size, true, problems);
      if (!isRecord(item)) return;
      if (name === "partitions" && item.facing !== "sw" && item.facing !== "se") {
        problems.push(`${where}.facing: partitions face sw or se`);
      }
      if (name === "props" && item.front !== undefined && typeof item.front !== "boolean") {
        problems.push(`${where}.front: needs a boolean`);
      }
    });
  }
  if (json.seats !== undefined && (!Array.isArray(json.seats)
    || json.seats.some((part: unknown) => typeof part !== "string" || !part))) {
    problems.push("seats: needs a list of part names");
  }
  if (!isRecord(json.stations)) {
    problems.push("stations: needs a station map");
    return;
  }
  if (!Object.hasOwn(json.stations, "rest")) problems.push("stations.rest: missing");
  for (const [key, station] of Object.entries(json.stations)) {
    const where = `stations.${key}`;
    if (!isRecord(station)) {
      problems.push(`${where}: needs an object`);
      continue;
    }
    if (typeof station.label !== "string" || !station.label) problems.push(`${where}.label: needs a label`);
    if (!Array.isArray(station.slots) || !station.slots.length) {
      problems.push(`${where}.slots: needs a non-empty list`);
      continue;
    }
    station.slots.forEach((slot: unknown, i: number) => {
      checkPlacement(slot, `${where}.slots.${i}`, size, false, problems);
    });
  }
}

/** Checks fetched room JSON without throwing; invalid rooms include diagnostic problems. */
export function parseRoom(json: unknown): { room: RoomLayout | null; problems: string[] } {
  const problems: string[] = [];
  try {
    checkRoom(json, problems);
  } catch {
    problems.push("room: could not read layout data");
  }
  return { room: problems.length ? null : json as RoomLayout, problems };
}

/** Builds a deterministic, connected floor with capacity-sized station blocks for a theme. */
export function placeholderRoom(theme: Theme): RoomLayout {
  const blocks = ACTION_CATEGORIES.flatMap((key) => {
    const station = theme.stations[key];
    return station ? [{ key, station }] : [];
  });
  const entries = [...blocks, { key: "rest", station: theme.rest }];
  const stations: RoomLayout["stations"] = {};
  let row = 1;
  let width = 0;
  for (let band = 0; band < entries.length; band += 3) {
    let column = 1;
    let height = 0;
    for (const { key, station } of entries.slice(band, band + 3)) {
      const blockWidth = Math.min(4, station.capacity);
      const blockHeight = Math.ceil(station.capacity / 4);
      const slots = Array.from({ length: station.capacity }, (_, i) => ({
        at: [column + i % 4, row + Math.floor(i / 4)] as Tile,
        facing: "sw" as const,
      }));
      stations[key] = { label: station.label, slots };
      column += blockWidth + 1;
      height = Math.max(height, blockHeight);
    }
    width = Math.max(width, column);
    row += height + 1;
  }
  return {
    size: [width, row],
    floor: { legend: { ".": "floor" }, rows: Array.from({ length: row }, () => ".".repeat(width)) },
    stations,
  };
}

/** Walkability, partition-aware neighbours and shortest paths on a room's floor. */
export interface WalkGrid {
  walkable(tile: Tile): boolean;
  neighbours(tile: Tile): readonly Tile[];
  findPath(from: Tile, to: Tile): Tile[] | null;
}

const NO_NEIGHBOURS: readonly Tile[] = [];

/**
 * Creates a four-neighbour walk grid; props block tiles and partitions block edges. Neighbours are worked out once
 * per tile, and searches run on tile indices, because the scene searches on every patch.
 */
export function createWalkGrid(room: RoomLayout): WalkGrid {
  const [columns, rows] = room.size;
  const indexOf = (column: number, row: number): number => row * columns + column;
  const inside = (column: number, row: number): boolean =>
    Number.isInteger(column) && Number.isInteger(row) && column >= 0 && row >= 0 && column < columns && row < rows;

  const seats = new Set(room.seats ?? []);
  const open = new Uint8Array(columns * rows);
  room.floor.rows.forEach((line, row) => {
    for (let column = 0; column < Math.min(columns, line.length); column++) {
      if (line[column] !== " ") open[indexOf(column, row)] = 1;
    }
  });
  for (const prop of room.props ?? []) {
    if (!seats.has(prop.part) && inside(prop.at[0], prop.at[1])) open[indexOf(prop.at[0], prop.at[1])] = 0;
  }

  // A partition on the north-east edge of [c, r] separates it from [c, r - 1]; on the north-west edge, from [c - 1, r].
  const closed = new Set<number>();
  const edge = (a: number, b: number): number => Math.min(a, b) * columns * rows + Math.max(a, b);
  for (const partition of room.partitions ?? []) {
    const [column, row] = partition.at;
    const [otherColumn, otherRow] = partition.facing === "sw" ? [column, row - 1] : [column - 1, row];
    if (inside(column, row) && inside(otherColumn, otherRow)) closed.add(edge(indexOf(column, row), indexOf(otherColumn, otherRow)));
  }

  const tiles: Tile[] = [];
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) tiles.push([column, row]);
  const adjacency: number[][] = tiles.map(([column, row], index) => {
    if (!open[index]) return [];
    const near: number[] = [];
    for (const [c, r] of [[column + 1, row], [column - 1, row], [column, row + 1], [column, row - 1]] as const) {
      if (!inside(c, r)) continue;
      const next = indexOf(c, r);
      if (open[next] && !closed.has(edge(index, next))) near.push(next);
    }
    return near;
  });
  const neighbourTiles = adjacency.map((near) => near.map((index) => tiles[index]!));

  const indexOfTile = (tile: Tile): number => (inside(tile[0], tile[1]) ? indexOf(tile[0], tile[1]) : -1);

  function walkable(tile: Tile): boolean {
    const index = indexOfTile(tile);
    return index >= 0 && open[index] === 1;
  }

  function neighbours(tile: Tile): readonly Tile[] {
    const index = indexOfTile(tile);
    return index >= 0 ? neighbourTiles[index]! : NO_NEIGHBOURS;
  }

  function findPath(from: Tile, to: Tile): Tile[] | null {
    const start = indexOfTile(from);
    const goal = indexOfTile(to);
    if (start >= 0 && start === goal) return [];
    if (start < 0 || goal < 0 || !open[start] || !open[goal]) return null;
    const previous = new Int32Array(tiles.length).fill(-1);
    const queue = new Int32Array(tiles.length);
    previous[start] = start;
    queue[0] = start;
    for (let head = 0, tail = 1; head < tail; head++) {
      for (const next of adjacency[queue[head]!]!) {
        if (previous[next] !== -1) continue;
        previous[next] = queue[head]!;
        if (next === goal) {
          const path: Tile[] = [];
          for (let index = goal; index !== start; index = previous[index]!) path.push([tiles[index]![0], tiles[index]![1]]);
          return path.reverse();
        }
        queue[tail++] = next;
      }
    }
    return null;
  }

  return { walkable, neighbours, findPath };
}
