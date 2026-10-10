import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateManifest } from "../pipeline/licences.mjs";

const temps: string[] = [];
afterEach(() => {
  for (const path of temps.splice(0)) rmSync(path, { recursive: true, force: true });
});

function check(render: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), "agentarium-parts-"));
  temps.push(dir);
  writeFileSync(join(dir, "room.blend"), "blend");
  const manifest = {
    name: "Room",
    licence: "CC-BY-4.0",
    sources: [{ source: "Original", author: "Agentarium", url: "https://example.com", licence: "CC-BY-4.0", changes: "Original" }],
    render: { blend: "room.blend", atlas: "room", ...render },
  };
  return validateManifest(dir, manifest).map((p: string) => p.slice(p.indexOf(": ") + 2));
}

describe("scene parts and frame", () => {
  it("accepts parts and a frame override", () => {
    expect(check({ parts: ["floor", "desk-2"], frame: { size: [160, 272], anchor: [80, 232] } })).toEqual([]);
  });

  it("rejects bad, duplicate or empty parts, and parts with animations", () => {
    expect(check({ parts: [] })).toEqual(["render.parts must be a non-empty list"]);
    expect(check({ parts: ["desk", "desk", "a/b"] })).toEqual([
      "render.parts.1: desk is listed twice",
      "render.parts.2: a/b is not a safe name",
    ]);
    expect(check({ parts: ["desk"], animations: { idle: { action: "idle", fps: 8 } } })).toEqual([
      "render.parts and render.animations cannot be used together",
    ]);
  });

  it("rejects a frame without whole sizes or with the anchor outside it", () => {
    expect(check({ frame: { size: [160.5, 272], anchor: [80, 232] } })).toEqual([
      "render.frame needs only a whole-pixel size [w, h] and an anchor [x, y] inside it",
    ]);
    expect(check({ frame: { size: [160, 272, 0], anchor: [80, 232] } })).toEqual([
      "render.frame needs only a whole-pixel size [w, h] and an anchor [x, y] inside it",
    ]);
    expect(check({ frame: { size: [160, 272], anchor: [80, 232], scale: 1 } })).toEqual([
      "render.frame needs only a whole-pixel size [w, h] and an anchor [x, y] inside it",
    ]);
    expect(check({ frame: { size: [160, 272], anchor: [80, 300] } })).toEqual([
      "render.frame needs only a whole-pixel size [w, h] and an anchor [x, y] inside it",
    ]);
  });
});
