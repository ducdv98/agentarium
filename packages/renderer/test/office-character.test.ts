import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkAtlases, office, parseRoom, validateTheme } from "../src";

const assets = join(__dirname, "../../../assets");
const ROOM = "src/scenes/office-room/layout.json";
const r2d = office.renderers!["2d"]!;

describe("office character animations", () => {
  it("pass the strict 2D theme check against the committed atlas", () => {
    expect(validateTheme(office, { strict: true })).toEqual([]);
    const atlases = Object.fromEntries(r2d.atlases.map((path) => [path, JSON.parse(readFileSync(join(assets, path), "utf8"))]));
    expect(checkAtlases(r2d, atlases)).toEqual([]);
    expect(parseRoom(JSON.parse(readFileSync(join(assets, ROOM), "utf8"))).problems).toEqual([]);
  });
});
