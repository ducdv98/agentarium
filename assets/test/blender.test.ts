import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAsset } from "../pipeline/build.mjs";

const blender = process.env.AGENTARIUM_BLENDER ?? "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe";

/** Saves the test mannequin and its manifest into a fresh asset directory. */
async function mannequin(...flags: string[]) {
  const root = mkdtempSync(join(tmpdir(), "agentarium-blender-"));
  const asset = join(root, "src", "characters", "mannequin");
  mkdirSync(asset, { recursive: true });
  const blend = join(asset, "mannequin.blend");
  const script = join(import.meta.dirname, "fixtures", "make-mannequin.py");
  const { execFileSync } = await import("node:child_process");
  execFileSync(blender, [
    "-b", "--factory-startup", "-P", script, "--", blend, ...flags,
  ]);
  writeFileSync(join(asset, "asset.json"), JSON.stringify({
    name: "Mannequin",
    licence: "CC-BY-4.0",
    sources: [{
      source: "Test",
      author: "Agentarium",
      url: "https://example.com",
      licence: "CC0-1.0",
      changes: "Original",
    }],
    render: {
      blend: "mannequin.blend",
      collection: "asset",
      atlas: "mannequin",
      animations: {
        walk: { action: "walk", fps: 12, frames: [1, 4], loop: "pingpong" },
        idle: { action: "idle", fps: 8, frames: [1, 4], loop: "cycle" },
      },
      masks: { shirt: ["shirt"] },
    },
  }));
  return { root, asset };
}

describe.skipIf(process.env.AGENTARIUM_BLENDER_TESTS !== "1")("Blender pipeline", () => {
  it("renders and packs every animation, direction, and shirt mask", async () => {
    const { root, asset } = await mannequin();
    const buildDir = join(root, "build");
    const atlasDir = join(root, "atlases");
    await buildAsset(asset, { buildDir, atlasDir });
    const atlas = JSON.parse(readFileSync(join(atlasDir, "mannequin.json"), "utf8"));
    for (const animation of ["walk", "idle"]) {
      for (const direction of ["sw", "se", "ne", "nw"]) {
        const length = animation === "walk" ? 6 : 4;
        const fps = animation === "walk" ? 12 : 8;
        expect(atlas.animations[`${animation}/${direction}`]).toHaveLength(length);
        expect(atlas.animations[`${animation}/${direction}-shirt`]).toHaveLength(length);
        expect(atlas.meta.fps[`${animation}/${direction}`]).toBe(fps);
        expect(atlas.meta.fps[`${animation}/${direction}-shirt`]).toBe(fps);
      }
    }
    expect(atlas.meta.scale).toBe(2);
    const log = JSON.parse(readFileSync(join(buildDir, "mannequin", "render-log.json"), "utf8"));
    expect(log.meta.animations).toEqual({
      walk: { frames: 4, fps: 12, loop: "pingpong" },
      idle: { frames: 4, fps: 8, loop: "cycle" },
    });
    // The character fits inside the frame, and the walk actually moves (distinct packed rects).
    for (const frame of Object.values<{ spriteSourceSize: { y: number; h: number }; sourceSize: { h: number } }>(atlas.frames)) {
      expect(frame.spriteSourceSize.y).toBeGreaterThan(0);
      expect(frame.spriteSourceSize.h).toBeLessThan(frame.sourceSize.h);
    }
    const walkRects = new Set(atlas.animations["walk/sw"].map((name: string) => JSON.stringify(atlas.frames[name].frame)));
    expect(walkRects.size).toBeGreaterThan(1);
    expect(existsSync(join(atlasDir, "mannequin.png"))).toBe(true);
  }, 120_000);

  it.each(["--constrained", "--object-constrained"])("refuses an armature that still has constraints (%s)", async (flag) => {
    const { root, asset } = await mannequin(flag);
    await expect(buildAsset(asset, { buildDir: join(root, "build"), atlasDir: join(root, "atlases") }))
      .rejects.toThrow(/Blender failed/);
    const log = readFileSync(join(root, "build", "mannequin", "blender.log"), "utf8");
    expect(log).toContain("bake controls before rendering");
    expect(existsSync(join(root, "atlases", "mannequin.json"))).toBe(false);
  }, 120_000);

  it("bakes Rigify-style controls into a skeleton that reproduces their pose", async () => {
    const { execFileSync } = await import("node:child_process");
    const output = execFileSync(blender, [
      "-b", "--factory-startup", "-P", join(import.meta.dirname, "fixtures", "bake-check.py"), "--",
      join(import.meta.dirname, "..", "pipeline"),
    ], { encoding: "utf8" });
    expect(output).toContain("BAKE-OK");
  }, 120_000);
});
