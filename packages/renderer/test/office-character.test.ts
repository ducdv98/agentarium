import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTION_CATEGORIES } from "@agentarium/core";
import { ANIMATED_STATES, DIRECTIONS, checkAtlases, dotGrid, parseRoom, validateTheme, type Clip, type Renderer2d } from "../src";

const assets = join(__dirname, "../../../assets");
const ATLAS = "atlases/office-worker.json";
const ROOM = "src/scenes/office-room/layout.json";
const clip = (name: string): Clip => Object.fromEntries(DIRECTIONS.map((d) => [d, `${name}/${d}`]));

/** The office character's animations (phase-3-scene 08) as the 2D section the office Theme (11) will ship. */
const r2d: Renderer2d = {
  atlases: [ATLAS],
  room: ROOM,
  walk: clip("walk"),
  states: Object.fromEntries(ANIMATED_STATES.map((s) => [s, clip(s)])),
  categories: Object.fromEntries(ACTION_CATEGORIES.map((c) => [c, clip(c)])),
};

describe("office character animations", () => {
  it("pass the strict 2D theme check against the committed atlas", () => {
    const problems = validateTheme({ ...dotGrid, renderers: { "2d": r2d } }, { strict: true });
    expect(problems.filter((p) => p.startsWith("renderers.2d"))).toEqual([]);
    const atlas: unknown = JSON.parse(readFileSync(join(assets, ATLAS), "utf8"));
    expect(checkAtlases(r2d, { [ATLAS]: atlas })).toEqual([]);
    expect(parseRoom(JSON.parse(readFileSync(join(assets, ROOM), "utf8"))).problems).toEqual([]);
  });
});
