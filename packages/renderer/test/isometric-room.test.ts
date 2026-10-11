import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ACTION_CATEGORIES } from "@agentarium/core";
import { describe, expect, it } from "vitest";
import { createWalkGrid, parseRoom, placeholderRoom, TILE_HEIGHT, TILE_WIDTH, tileToScreen } from "../src/isometric/room";
import type { RoomLayout, Tile } from "../src/isometric/types";
import { dotGrid } from "../src/themes/dot-grid";

const officeJson: unknown = JSON.parse(readFileSync(join(__dirname, "../../../assets/src/scenes/office-room/layout.json"), "utf8"));

function smallRoom(): RoomLayout {
  return {
    size: [3, 3],
    floor: { legend: { ".": "floor" }, rows: ["...", "...", "..."] },
    stations: { rest: { label: "Rest", slots: [{ at: [0, 0], facing: "sw" }] } },
  };
}

describe("room JSON", () => {
  it("accepts the real office layout", () => {
    const parsed = parseRoom(officeJson);
    expect(parsed.problems).toEqual([]);
    expect(parsed.room?.size).toEqual([12, 10]);
    expect(parsed.room?.stations.delegate?.slots).toHaveLength(6);
  });

  it.each([
    null, [], "room", {},
    { ...smallRoom(), size: [0, 3] },
    { ...smallRoom(), size: [3.5, 3] },
    { ...smallRoom(), floor: { legend: {}, rows: ["...", "..."] } },
    { ...smallRoom(), floor: { legend: null, rows: [3] } },
    { ...smallRoom(), walls: null },
    { ...smallRoom(), partitions: [{ part: "glass", at: [1, 1], facing: "ne" }] },
    { ...smallRoom(), props: [{ part: "desk", at: [3, 0], facing: "sw", front: "yes" }] },
    { ...smallRoom(), seats: [null] },
    { ...smallRoom(), stations: { rest: { label: "Rest", slots: [{ at: [0], facing: "south" }] } } },
    { ...smallRoom(), stations: { rest: { label: "Rest", slots: [] } } },
  ])("reports broken input without throwing (%#)", (json) => {
    let parsed: ReturnType<typeof parseRoom> | undefined;
    expect(() => { parsed = parseRoom(json); }).not.toThrow();
    expect(parsed?.room).toBeNull();
    expect(parsed?.problems.length).toBeGreaterThan(0);
  });

  it("also contains errors from unreadable properties", () => {
    const json = Object.defineProperty({}, "size", { get() { throw new Error("unreadable"); } });
    expect(parseRoom(json)).toEqual({ room: null, problems: ["room: could not read layout data"] });
  });
});

describe("tile projection", () => {
  it("uses the full 1x diamond and centres relative to the back corner", () => {
    expect([TILE_WIDTH, TILE_HEIGHT]).toEqual([128, 64]);
    expect(tileToScreen(0, 0)).toEqual({ x: 0, y: 0 });
    expect(tileToScreen(2, 1)).toEqual({ x: 64, y: 96 });
    expect(tileToScreen(0, 1)).toEqual({ x: -64, y: 32 });
  });
});

describe("placeholder room", () => {
  it("puts every theme station and rest on connected floor, with capacity slots", () => {
    const room = placeholderRoom(dotGrid);
    const grid = createWalkGrid(room);
    expect(parseRoom(room).problems).toEqual([]);
    expect(Object.keys(room.stations)).toEqual([...ACTION_CATEGORIES, "rest"]);
    expect(room.floor.legend).toEqual({ ".": "floor" });
    expect(room.walls ?? []).toEqual([]);
    expect(room.partitions ?? []).toEqual([]);
    expect(room.props ?? []).toEqual([]);
    const all = Object.values(room.stations).flatMap((station) => station.slots);
    expect(new Set(all.map((slot) => slot.at.join(","))).size).toBe(all.length);
    for (const key of [...ACTION_CATEGORIES, "rest"] as const) {
      const station = key === "rest" ? dotGrid.rest : dotGrid.stations[key]!;
      expect(room.stations[key]?.label).toBe(station.label);
      expect(room.stations[key]?.slots).toHaveLength(station.capacity);
    }
    for (const slot of all) {
      expect(slot.facing).toBe("sw");
      expect(grid.walkable(slot.at)).toBe(true);
      expect(grid.findPath(all[0]!.at, slot.at)).not.toBeNull();
      expect(slot.at[0]).toBeGreaterThan(0);
      expect(slot.at[1]).toBeGreaterThan(0);
      expect(slot.at[0]).toBeLessThan(room.size[0] - 1);
      expect(slot.at[1]).toBeLessThan(room.size[1] - 1);
    }
    expect(room.stations.read?.slots.map((slot) => slot.at)).toEqual([
      [1, 1], [2, 1], [3, 1], [4, 1], [1, 2], [2, 2], [3, 2], [4, 2],
    ]);
    expect(room.stations.write?.slots[0]?.at).toEqual([6, 1]);
    expect(room.stations.search?.slots[0]?.at).toEqual([1, 4]);
    expect(placeholderRoom(dotGrid)).toEqual(room);
  });

  it("omits absent categories and packs unequal capacities into three-block bands", () => {
    const theme = {
      ...dotGrid,
      stations: {
        read: { id: "r", label: "Library", capacity: 1 },
        exec: { id: "e", label: "Servers", capacity: 9 },
        wait: { id: "w", label: "Waiting", capacity: 2 },
      },
      rest: { id: "rest", label: "Lounge", capacity: 5 },
    };
    const room = placeholderRoom(theme);
    expect(Object.keys(room.stations)).toEqual(["read", "exec", "wait", "rest"]);
    expect(room.stations.exec?.slots[8]?.at).toEqual([3, 3]);
    expect(room.stations.rest?.slots[0]?.at).toEqual([1, 5]);
    expect(room.size).toEqual([11, 8]);
  });
});

describe("walk grid", () => {
  it("goes around blocking props but can walk over a seat", () => {
    const room = smallRoom();
    room.props = [{ part: "desk", at: [1, 1], facing: "sw" }];
    const grid = createWalkGrid(room);
    const path = grid.findPath([0, 1], [2, 1]);
    expect(path).toHaveLength(4);
    expect(path).not.toContainEqual([1, 1]);
    expect(path?.at(-1)).toEqual([2, 1]);
    room.seats = ["desk"];
    expect(createWalkGrid(room).findPath([0, 1], [2, 1])).toEqual([[1, 1], [2, 1]]);
  });

  it("uses the meeting-room door rather than crossing its glass", () => {
    const room = parseRoom(officeJson).room!;
    const grid = createWalkGrid(room);
    for (const partition of room.partitions!) {
      const [column, row] = partition.at;
      const across: Tile = partition.facing === "sw" ? [column, row - 1] : [column - 1, row];
      expect(grid.neighbours(partition.at)).not.toContainEqual(across);
      expect(grid.neighbours(across)).not.toContainEqual(partition.at);
    }
    const path = grid.findPath([10, 5], [10, 6]);
    expect(path).toEqual([[11, 5], [11, 6], [10, 6]]);
    expect(grid.findPath([7, 7], [8, 7])).toContainEqual([11, 6]);
    const slots = Object.values(room.stations).flatMap((station) => station.slots);
    for (const slot of slots) expect(grid.findPath(slots[0]!.at, slot.at)).not.toBeNull();
  });

  it("returns null for an enclosed target and blocks edges in both directions", () => {
    const room = smallRoom();
    room.partitions = [
      { part: "wall", at: [1, 1], facing: "sw" },
      { part: "wall", at: [1, 1], facing: "se" },
      { part: "wall", at: [1, 2], facing: "sw" },
      { part: "wall", at: [2, 1], facing: "se" },
    ];
    const grid = createWalkGrid(room);
    expect(grid.walkable([1, 1])).toBe(true);
    expect(grid.findPath([0, 0], [1, 1])).toBeNull();
    expect(grid.findPath([1, 1], [0, 0])).toBeNull();
    expect(grid.findPath([1, 1], [1, 1])).toEqual([]);
  });

  it("rejects holes, blocked destinations and tiles outside the floor", () => {
    const room = smallRoom();
    room.floor.rows[1] = ". .";
    const grid = createWalkGrid(room);
    for (const tile of [[1, 1], [-1, 0], [3, 0], [0, 3], [0.5, 0]] as Tile[]) {
      expect(grid.walkable(tile)).toBe(false);
      expect(grid.findPath([0, 0], tile)).toBeNull();
    }
    expect(grid.findPath([1, 1], [0, 0])).toBeNull();
  });
});
