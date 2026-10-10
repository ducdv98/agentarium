import { describe, expect, it } from "vitest";
import { checkAtlases } from "../src";
import { completeAtlas, completeTheme } from "./fixtures/theme";

const r2d = completeTheme.renderers!["2d"]!;
const only = (atlas: unknown) => checkAtlases(r2d, { "test/atlas.json": atlas });

describe("checkAtlases", () => {
  it("accepts a complete atlas", () => {
    expect(only(completeAtlas)).toEqual([]);
  });

  it("reports a missing or malformed atlas", () => {
    expect(checkAtlases(r2d, {})).toContain("test/atlas.json: missing");
    expect(only({ frames: {}, animations: {} })).toContain(
      "test/atlas.json: not a Pixi v8 spritesheet (needs frames, animations and meta)",
    );
    expect(only({ ...completeAtlas, meta: { scale: 1 } })).toEqual(["test/atlas.json: meta.scale must be 2"]);
  });

  it("reports unplayable animations and broken frames", () => {
    const atlas = {
      ...completeAtlas,
      frames: { ...completeAtlas.frames, "walk/sw/frame-000": null },
      animations: { ...completeAtlas.animations, "walk/ne": ["nope"], "walk/nw": [] },
    };
    expect(only(atlas)).toEqual([
      "test/atlas.json: frame walk/sw/frame-000 has no frame rectangle",
      "test/atlas.json: animation walk/ne names missing frame nope",
      "test/atlas.json: animation walk/nw needs a list of frames",
      "walk/nw: in no atlas",
    ]);
  });

  it("reports names in no atlas and names in two atlases", () => {
    const two = { ...r2d, atlases: ["a.json", "b.json"], categories: { ...r2d.categories, read: { ne: "not-there" } } };
    const problems = checkAtlases(two, { "a.json": completeAtlas, "b.json": completeAtlas });
    expect(problems).toContain("not-there: in no atlas");
    expect(problems).toContain("walk/ne: in more than one atlas (a.json, b.json)");
  });

  it("ignores duplicate animations the theme does not use", () => {
    const extra = { ...completeAtlas, animations: { ...completeAtlas.animations, "walk/ne-shirt": ["walk/ne/frame-000"] } };
    const other = { frames: extra.frames, animations: { "walk/ne-shirt": ["walk/ne/frame-000"] }, meta: { scale: 2 } };
    expect(checkAtlases({ ...r2d, atlases: ["a.json", "b.json"] }, { "a.json": extra, "b.json": other })).toEqual([]);
  });
});
