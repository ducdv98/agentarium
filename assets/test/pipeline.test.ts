import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";
import { checkBlender } from "../pipeline/build.mjs";
import { generateNotice, validateTree } from "../pipeline/licences.mjs";
import { packFrames } from "../pipeline/pack.mjs";

const temps: string[] = [];
afterEach(() => {
  for (const path of temps.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "agentarium-assets-"));
  temps.push(root);
  const asset = join(root, "src", "characters", "worker");
  mkdirSync(asset, { recursive: true });
  writeFileSync(join(asset, "worker.blend"), "blend");
  writeFileSync(join(asset, "asset.json"), JSON.stringify({
    name: "Worker",
    licence: "CC-BY-4.0",
    sources: [{
      source: "Original",
      author: "Agentarium",
      url: "https://example.com",
      licence: "CC0-1.0",
      changes: "Original",
    }],
    render: { blend: "worker.blend", atlas: "worker", animations: { idle: { action: "idle", fps: 8 } } },
  }));
  return root;
}

describe("Blender pin", () => {
  it("rejects a wrong hash and accepts the matching hash", async () => {
    const root = mkdtempSync(join(tmpdir(), "agentarium-blender-pin-"));
    temps.push(root);
    const file = join(root, "blender.exe");
    writeFileSync(file, "fake blender");
    const hash = createHash("sha256").update("fake blender").digest("hex");
    const runtime = { platform: "win32", arch: "x64" } as NodeJS.Process;
    await expect(checkBlender(file, { blender: { exeSha256: "0".repeat(64) } }, runtime)).rejects.toThrow(hash);
    await expect(checkBlender(file, { blender: { exeSha256: hash } }, runtime)).resolves.toBe(file);
  });
});

describe("licence manifests", () => {
  it("reports the exact complete problem list", () => {
    const root = fixture();
    writeFileSync(join(root, "src", "characters", "worker", "asset.json"), JSON.stringify({
      licence: "CC-BY-SA-4.0",
      sources: [{ source: "", author: "", url: "", licence: "Mixamo", changes: "" }],
    }));
    writeFileSync(join(root, "src", "stray.txt"), "stray");
    writeFileSync(join(root, "stray.blend"), "stray");
    mkdirSync(join(root, "src", "props", "missing"), { recursive: true });
    expect(validateTree(root).problems).toEqual([
      `${join(root, "src", "characters", "worker", "asset.json")}: missing name`,
      `${join(root, "src", "characters", "worker", "asset.json")}: licence must be CC0-1.0 or CC-BY-4.0`,
      `${join(root, "src", "characters", "worker", "asset.json")}: sources[0].source is required`,
      `${join(root, "src", "characters", "worker", "asset.json")}: sources[0].author is required`,
      `${join(root, "src", "characters", "worker", "asset.json")}: sources[0].url is required`,
      `${join(root, "src", "characters", "worker", "asset.json")}: sources[0].changes is required`,
      `${join(root, "src", "characters", "worker", "asset.json")}: sources[0].licence Mixamo is not allowed`,
      `${join(root, "src", "props", "missing")}: missing asset.json`,
      `${join(root, "src", "stray.txt")}: file is not inside an asset directory`,
      `${join(root, "stray.blend")}: blend file must be inside assets/src/<kind>/<name>/`,
    ]);
  });

  it("rejects atlas names shared by two assets or ending in a page number", () => {
    const root = fixture();
    const twin = join(root, "src", "characters", "twin");
    mkdirSync(twin, { recursive: true });
    writeFileSync(join(twin, "twin.blend"), "blend");
    const manifest = JSON.parse(readFileSync(join(root, "src", "characters", "worker", "asset.json"), "utf8"));
    writeFileSync(join(twin, "asset.json"), JSON.stringify({ ...manifest, render: { ...manifest.render, blend: "twin.blend" } }));
    expect(validateTree(root).problems).toEqual([
      `atlas worker: used by more than one asset (${join(root, "src", "characters", "twin")}, `
        + `${join(root, "src", "characters", "worker")})`,
    ]);
    writeFileSync(join(twin, "asset.json"), JSON.stringify({ ...manifest, render: { ...manifest.render, blend: "twin.blend", atlas: "worker-1" } }));
    expect(validateTree(root).problems).toEqual([
      `${join(twin, "asset.json")}: render.atlas must be a safe file stem not ending in -<number>`,
    ]);
  });

  it("rejects a render source outside the asset directory", () => {
    const root = fixture();
    writeFileSync(join(root, "outside.blend"), "blend");
    const path = join(root, "src", "characters", "worker", "asset.json");
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(path, JSON.stringify({ ...manifest, render: { ...manifest.render, blend: "../../../outside.blend" } }));
    expect(validateTree(root).problems).toEqual([
      `${path}: render.blend must name an existing .blend file in the asset directory`,
      `${join(root, "outside.blend")}: blend file must be inside assets/src/<kind>/<name>/`,
    ]);
  });

  it("generates a deterministic notice", () => expect(generateNotice(fixture())).toContain("Worker"));

  it("matches the committed notice", () => {
    const root = join(import.meta.dirname, "..");
    expect(readFileSync(join(root, "NOTICE"), "utf8")).toBe(generateNotice(root));
  });
});

function image(width: number, height: number, red: number, inset = false) {
  const png = new PNG({ width, height });
  const start = inset ? 1 : 0;
  for (let y = start; y < height - start; y += 1) {
    for (let x = start; x < width - start; x += 1) {
      const index = (y * width + x) * 4;
      png.data[index] = red;
      png.data[index + 3] = 255;
    }
  }
  return png;
}

function clips() {
  const beauty = image(8, 8, 120, true);
  const mask = image(8, 8, 255);
  return [
    {
      name: "idle/sw",
      frames: [
        { frame: 0, beauty, masks: { shirt: mask } },
        { frame: 1, beauty, masks: { shirt: mask } },
      ],
    },
    { name: "walk/sw", frames: [{ frame: 0, beauty: image(8, 8, 200), masks: { shirt: mask } }] },
  ];
}

describe("packing", () => {
  it("packs masks, trims, anchors, deduplicates, and is deterministic", () => {
    const root = mkdtempSync(join(tmpdir(), "agentarium-pack-"));
    temps.push(root);
    const options = {
      clips: clips(),
      atlas: "worker",
      frameSize: [8, 8],
      anchor: [4, 7],
      maxSize: 128,
      masks: ["shirt"],
    };
    packFrames({ ...options, outputDir: join(root, "a") });
    packFrames({ ...options, outputDir: join(root, "b") });
    expect(readFileSync(join(root, "a", "worker.json"))).toEqual(readFileSync(join(root, "b", "worker.json")));
    const atlas = JSON.parse(readFileSync(join(root, "a", "worker.json"), "utf8"));
    expect(atlas.animations["idle/sw"]).toHaveLength(2);
    expect(atlas.animations["idle/sw-shirt"]).toHaveLength(2);
    expect(atlas.frames["idle/sw/frame-000"].frame).toEqual(atlas.frames["idle/sw/frame-001"].frame);
    expect(atlas.frames["idle/sw/frame-000"].trimmed).toBe(true);
    expect(atlas.frames["idle/sw/frame-000"].spriteSourceSize).toEqual({ x: 1, y: 1, w: 6, h: 6 });
    expect(atlas.frames["idle/sw/frame-000"].sourceSize).toEqual({ w: 8, h: 8 });
    expect(atlas.frames["idle/sw/frame-000"].anchor).toEqual({ x: 0.5, y: 0.875 });
  });

  it("spills pages without splitting a clip", () => {
    const root = mkdtempSync(join(tmpdir(), "agentarium-spill-"));
    temps.push(root);
    packFrames({
      clips: clips(),
      outputDir: root,
      atlas: "spill",
      frameSize: [8, 8],
      anchor: [4, 7],
      maxSize: 18,
      masks: ["shirt"],
    });
    const pages = ["spill-0.json", "spill-1.json"].map((name) => JSON.parse(readFileSync(join(root, name), "utf8")));
    for (const name of ["idle/sw", "idle/sw-shirt", "walk/sw", "walk/sw-shirt"]) {
      expect(pages.filter((page) => page.animations[name])).toHaveLength(1);
    }
  });

  it("keeps unrelated output files", () => {
    const root = mkdtempSync(join(tmpdir(), "agentarium-output-"));
    temps.push(root);
    writeFileSync(join(root, "other-asset.json"), "keep");
    packFrames({ clips: clips().slice(0, 1), outputDir: root, atlas: "worker", masks: ["shirt"] });
    expect(readFileSync(join(root, "other-asset.json"), "utf8")).toBe("keep");
  });
});
