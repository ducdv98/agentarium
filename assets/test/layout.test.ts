import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STATIONS, validateLayout } from "../pipeline/layout.mjs";

const PARTS = ["floor", "carpet", "wall", "desk", "chair", "plant"];

/** A 10x2 room: one desk per station along row 0, each used from row 1. */
function layout() {
  return {
    size: [10, 2],
    floor: { legend: { ".": "floor", c: "carpet" }, rows: ["..........", ".........c"] },
    walls: [{ part: "wall", at: [0, 0], facing: "sw" }],
    seats: ["chair"],
    props: [
      ...STATIONS.map((_: string, c: number) => ({ part: "desk", at: [c, 0], facing: "sw" })),
      { part: "chair", at: [0, 1], facing: "ne", front: true },
    ],
    stations: Object.fromEntries(STATIONS.map((s: string, c: number) => [
      s, { label: s, slots: [{ at: [c, 1], facing: "ne" }] },
    ])),
  };
}

describe("room layouts", () => {
  it("names the nine action categories and the rest area", () => {
    expect(STATIONS).toEqual(["read", "write", "exec", "search", "network", "delegate", "think", "wait", "error", "rest"]);
  });

  it("accepts a complete layout", () => {
    expect(validateLayout(layout(), PARTS)).toEqual([]);
  });

  it("checks the floor grid against the size and the parts", () => {
    const bad = layout();
    bad.floor.rows = ["..........", "....x.....x"];
    bad.floor.legend = { ".": "floor", x: "lava" } as never;
    expect(validateLayout(bad, PARTS)).toEqual([
      "floor.legend.x: lava is not a part",
      "floor.rows.1: needs 10 tiles",
    ]);
  });

  it("checks every placement's part, tile and facing", () => {
    const bad = layout();
    bad.walls.push({ part: "door", at: [0, 0], facing: "up" });
    bad.props.push({ part: "plant", at: [10, 0], facing: "sw" });
    expect(validateLayout(bad, PARTS)).toEqual([
      "walls.1: door is not a part",
      "walls.1: facing up is not a direction",
      "props.11: [10,0] is not a floor tile",
    ]);
  });

  it("keeps walls on the room's outer edge, so they never cut a walk", () => {
    const bad = layout();
    bad.walls.push({ part: "wall", at: [3, 1], facing: "sw" }, { part: "wall", at: [0, 1], facing: "se" },
      { part: "wall", at: [9, 1], facing: "ne" });
    expect(validateLayout(bad, PARTS)).toEqual([
      "walls.1: the ne edge of [3,1] is inside the room",
    ]);
  });

  it("reports lists of the wrong type instead of throwing", () => {
    const bad = { ...layout(), walls: {}, props: "desk", seats: 1 } as never;
    expect(validateLayout(bad, PARTS)).toEqual([
      "seats: not a list",
      "walls: not a list",
      "props: not a list",
    ]);
  });

  it("allows one blocking prop and one seat per tile", () => {
    const bad = layout();
    bad.props.push({ part: "plant", at: [3, 0], facing: "sw" }, { part: "chair", at: [0, 1], facing: "sw" });
    expect(validateLayout(bad, PARTS)).toEqual([
      "props.11: [3,0] already has a prop",
      "props.12: [0,1] already has a seat",
    ]);
  });

  it("lists missing and unknown stations", () => {
    const bad = layout();
    const stations = bad.stations as Record<string, unknown>;
    delete stations.think;
    stations.nap = { label: "Nap", slots: [{ at: [6, 1], facing: "ne" }] };
    expect(validateLayout(bad, PARTS)).toEqual([
      "stations.nap: not an action category or rest",
      "stations.think: missing",
    ]);
  });

  it("checks labels and slots: on a free floor tile, with a facing, used once", () => {
    const bad = layout();
    bad.stations.read = { label: "", slots: [] };
    bad.stations.write.slots.push({ at: [2, 0], facing: "ne" }, { at: [2, 1], facing: "north" });
    expect(validateLayout(bad, PARTS)).toEqual([
      "stations.read: needs a label",
      "stations.read: needs at least one slot",
      "stations.write.slots.1: [2,0] is blocked by desk",
      "stations.write.slots.2: facing north is not a direction",
      "stations.exec.slots.0: [2,1] is already a slot of write",
    ]);
  });

  it("requires every slot to be reachable from every other", () => {
    const bad = layout();
    bad.size = [12, 2];
    bad.floor.rows = ["............", "............"];
    // Plants down column 10 cut the rest area off.
    for (const r of [0, 1]) bad.props.push({ part: "plant", at: [10, r], facing: "sw" });
    bad.stations.rest.slots[0].at = [11, 1];
    expect(validateLayout(bad, PARTS)).toEqual([
      "stations.rest.slots.0: [11,1] cannot be reached from [0,1]",
    ]);
  });

  it("accepts the shipped office room", () => {
    const dir = join(import.meta.dirname, "..", "src", "scenes", "office-room");
    const manifest = JSON.parse(readFileSync(join(dir, "asset.json"), "utf8"));
    const office = JSON.parse(readFileSync(join(dir, "layout.json"), "utf8"));
    expect(validateLayout(office, manifest.render.parts)).toEqual([]);
  });
});

describe("room draw order", () => {
  it("draws floor, then walls, then props and characters by depth, front props over their tile's character", async () => {
    const { drawOrder } = await import("../pipeline/preview.mjs");
    const room = {
      floor: { legend: { ".": "floor" }, rows: ["..", ".."] },
      walls: [{ part: "wall", at: [1, 0], facing: "sw" }],
      props: [
        { part: "desk", at: [1, 1], facing: "sw" },
        { part: "chair", at: [0, 1], facing: "ne", front: true },
        { part: "plant", at: [0, 0], facing: "sw" },
      ],
    };
    const order = drawOrder(room, [{ at: [0, 1], facing: "ne" }]).map((i: { kind: string; part?: string; at: number[] }) =>
      `${i.kind}:${i.part ?? ""}@${i.at}`);
    expect(order).toEqual([
      "floor:floor@0,0", "floor:floor@0,1", "floor:floor@1,0", "floor:floor@1,1",
      "wall:wall@1,0",
      "prop:plant@0,0", "character:@0,1", "prop:chair@0,1", "prop:desk@1,1",
    ]);
  });
});
