import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAsset } from "../pipeline/build.mjs";

describe.skipIf(process.env.AGENTARIUM_BLENDER_TESTS !== "1")("Blender scene parts", () => {
  it("renders each part alone as a one-frame clip per direction, in the asset's own frame", async () => {
    const root = mkdtempSync(join(tmpdir(), "agentarium-parts-"));
    const asset = join(root, "src", "scenes", "blocks");
    mkdirSync(asset, { recursive: true });
    const { execFileSync } = await import("node:child_process");
    execFileSync(process.env.AGENTARIUM_BLENDER ?? "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe", [
      "-b", "--factory-startup", "-P", join(import.meta.dirname, "fixtures", "make-parts.py"), "--", join(asset, "blocks.blend"),
    ]);
    writeFileSync(join(asset, "asset.json"), JSON.stringify({
      name: "Blocks",
      licence: "CC-BY-4.0",
      sources: [{ source: "Test", author: "Agentarium", url: "https://example.com", licence: "CC0-1.0", changes: "Original" }],
      render: {
        blend: "blocks.blend", collection: "asset", atlas: "blocks",
        frame: { size: [160, 272], anchor: [80, 232] }, parts: ["block", "slab"],
      },
    }));
    await buildAsset(asset, { buildDir: join(root, "build"), atlasDir: join(root, "atlases") });
    const atlas = JSON.parse(readFileSync(join(root, "atlases", "blocks.json"), "utf8"));
    for (const part of ["block", "slab"]) {
      for (const direction of ["sw", "se", "ne", "nw"]) {
        expect(atlas.animations[`${part}/${direction}`]).toEqual([`${part}/${direction}/frame-000`]);
        const frame = atlas.frames[`${part}/${direction}/frame-000`];
        expect(frame.sourceSize).toEqual({ w: 320, h: 544 });
        expect(frame.anchor).toEqual({ x: 0.5, y: 232 / 272 });
      }
    }
    // Only the part's own collection shows: the 1 m slab is a full tile wide, the 0.4 m block is not, and the
    // slab is flat while the block stands up from the anchor.
    const block = atlas.frames["block/sw/frame-000"].spriteSourceSize;
    const slab = atlas.frames["slab/sw/frame-000"].spriteSourceSize;
    expect(slab.w).toBeGreaterThanOrEqual(256);
    expect(block.w).toBeLessThan(160);
    expect(slab.h).toBeLessThan(150);
    expect(block.y).toBeLessThan(slab.y - 60);
  }, 120_000);
});
