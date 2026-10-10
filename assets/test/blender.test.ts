import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAsset } from "../pipeline/build.mjs";

describe.skipIf(process.env.AGENTARIUM_BLENDER_TESTS !== "1")("Blender pipeline", () => {
  it("renders and packs every animation, direction, and shirt mask", async () => {
    const root = mkdtempSync(join(tmpdir(), "agentarium-blender-"));
    const asset = join(root, "src", "characters", "mannequin");
    mkdirSync(asset, { recursive: true });
    const blend = join(asset, "mannequin.blend");
    const script = join(import.meta.dirname, "fixtures", "make-mannequin.py");
    const { execFileSync } = await import("node:child_process");
    execFileSync(process.env.AGENTARIUM_BLENDER ?? "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe", [
      "-b", "--factory-startup", "-P", script, "--", blend,
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
        animations: { walk: { action: "walk", fps: 12 }, idle: { action: "idle", fps: 8 } },
        masks: { shirt: ["shirt"] },
      },
    }));
    const buildDir = join(root, "build");
    const atlasDir = join(root, "atlases");
    await buildAsset(asset, { buildDir, atlasDir });
    const atlas = JSON.parse(readFileSync(join(atlasDir, "mannequin.json"), "utf8"));
    for (const animation of ["walk", "idle"]) {
      for (const direction of ["sw", "se", "ne", "nw"]) {
        expect(atlas.animations[`${animation}/${direction}`]).toHaveLength(4);
        expect(atlas.animations[`${animation}/${direction}-shirt`]).toHaveLength(4);
      }
    }
    expect(atlas.meta.scale).toBe(2);
    // The character fits inside the frame, and the walk actually moves (distinct packed rects).
    for (const frame of Object.values<{ spriteSourceSize: { y: number; h: number }; sourceSize: { h: number } }>(atlas.frames)) {
      expect(frame.spriteSourceSize.y).toBeGreaterThan(0);
      expect(frame.spriteSourceSize.h).toBeLessThan(frame.sourceSize.h);
    }
    const walkRects = new Set(atlas.animations["walk/sw"].map((name: string) => JSON.stringify(atlas.frames[name].frame)));
    expect(walkRects.size).toBeGreaterThan(1);
    expect(existsSync(join(atlasDir, "mannequin.png"))).toBe(true);
  }, 120_000);
});
