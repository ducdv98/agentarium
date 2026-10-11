import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";
import { checkBlender } from "../pipeline/build.mjs";
import { checkAtlases } from "../pipeline/atlas-check.mjs";
import { generateNotice, validateManifest, validateTree } from "../pipeline/licences.mjs";
import { encodePage, packFrames, packRender } from "../pipeline/pack.mjs";

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
    render: {
      blend: "worker.blend",
      atlas: "worker",
      animations: { idle: { action: "idle", fps: 8, frames: [1, 4], loop: "cycle" } },
    },
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
  it.each([
    undefined, null, "1,4", [], [1], [1, 4, 5], [1.5, 4], [1, 4.5], ["1", 4], [4, 1],
  ])("rejects missing or invalid animation frames %j", (frames) => {
    const root = fixture();
    const asset = join(root, "src", "characters", "worker");
    const path = join(asset, "asset.json");
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    manifest.render.animations.idle.frames = frames;
    expect(validateManifest(asset, manifest)).toEqual([
      `${path}: render.animations.idle.frames must be [start, end] with whole numbers and start <= end`,
    ]);
  });

  it.each([undefined, null, "", "repeat", 1, true])("rejects missing or invalid animation loop %j", (loop) => {
    const root = fixture();
    const asset = join(root, "src", "characters", "worker");
    const path = join(asset, "asset.json");
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    manifest.render.animations.idle.loop = loop;
    expect(validateManifest(asset, manifest)).toEqual([
      `${path}: render.animations.idle.loop must be cycle or pingpong`,
    ]);
  });

  it.each(["cycle", "pingpong"])("accepts animation policy %s and a one-frame range", (loop) => {
    const root = fixture();
    const asset = join(root, "src", "characters", "worker");
    const manifest = JSON.parse(readFileSync(join(asset, "asset.json"), "utf8"));
    manifest.render.animations.idle = { action: "idle", fps: 8, frames: [3, 3], loop };
    expect(validateManifest(asset, manifest)).toEqual([]);
  });

  it("accepts a complete CC0 licence audit", () => {
    const root = fixture();
    writeFileSync(join(root, "src", "characters", "worker", "licence-audit.json"), JSON.stringify({
      files: [{ path: "base.obj", licence: "CC0-1.0", evidence: "stated in the file" }],
    }));
    expect(validateTree(root).problems).toEqual([]);
  });

  it("rejects a licence audit entry that is not CC0", () => {
    const root = fixture();
    writeFileSync(join(root, "src", "characters", "worker", "licence-audit.json"), JSON.stringify({
      files: [{ path: "base.obj", licence: "CC-BY-4.0", evidence: "stated in the file" }],
    }));
    expect(validateTree(root).problems).toEqual([
      `${join(root, "src", "characters", "worker", "licence-audit.json")}: files[0] must state CC0-1.0`,
    ]);
  });

  it("rejects a licence audit entry without known evidence", () => {
    const root = fixture();
    writeFileSync(join(root, "src", "characters", "worker", "licence-audit.json"), JSON.stringify({
      files: [
        { path: "base.obj", licence: "CC0-1.0" },
        { path: "rig.json", licence: "CC0-1.0", evidence: "probably fine" },
      ],
    }));
    const audit = join(root, "src", "characters", "worker", "licence-audit.json");
    expect(validateTree(root).problems).toEqual([
      `${audit}: files[0] needs a path and known CC0 evidence`,
      `${audit}: files[1] needs a path and known CC0 evidence`,
    ]);
  });

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

function animationAtlas(loop = "pingpong") {
  const animations: Record<string, string[]> = {};
  const frames: Record<string, object> = {};
  const fps: Record<string, number> = {};
  const sequence = loop === "pingpong" ? [0, 1, 2, 3, 2, 1] : [0, 1, 2, 3];
  for (const direction of ["ne", "sw"]) {
    for (const suffix of ["", "-shirt", "-hair"]) {
      const name = `walk/${direction}${suffix}`;
      animations[name] = sequence.map((index) => `walk/${direction}/frame-${String(index).padStart(3, "0")}${suffix}`);
      for (const frame of animations[name]) {
        frames[frame] = {};
      }
      fps[name] = 12;
    }
  }
  return { frames, animations, meta: { scale: 2, fps } };
}

describe("atlas animation contracts", () => {
  const directions = { ne: 180, sw: 0 };
  const render = {
    animations: { walk: { action: "walk", frames: [5, 8], loop: "pingpong", fps: 12 } },
    masks: ["shirt", "hair"],
  };

  it.each(["cycle", "pingpong"])("accepts the exact %s sequence and fps for every direction and mask", (loop) => {
    expect(checkAtlases(animationAtlas(loop), {
      ...render,
      animations: { walk: { ...render.animations.walk, loop } },
    }, directions)).toEqual([]);
  });

  it.each(["walk/ne", "walk/ne-shirt"])("reports a wrong sequence length for %s", (name) => {
    const atlas = animationAtlas();
    atlas.animations[name].pop();
    expect(checkAtlases(atlas, render, directions)).toEqual([
      `atlas: animation ${name} frame sequence must be ${JSON.stringify(animationAtlas().animations[name])}; got ${JSON.stringify(atlas.animations[name])}`,
    ]);
  });

  it("reports a wrong order even when the sequence length matches", () => {
    const atlas = animationAtlas();
    atlas.animations["walk/ne"][4] = "walk/ne/frame-001";
    expect(checkAtlases(atlas, render, directions)).toEqual([
      `atlas: animation walk/ne frame sequence must be ${JSON.stringify(animationAtlas().animations["walk/ne"])}; got ${JSON.stringify(atlas.animations["walk/ne"])}`,
    ]);
  });

  it("reports each wrong or missing fps alongside sequence mismatches", () => {
    const atlas = animationAtlas();
    atlas.animations["walk/sw"].pop();
    atlas.meta.fps["walk/ne"] = 8;
    delete atlas.meta.fps["walk/ne-shirt"];
    expect(checkAtlases(atlas, render, directions)).toEqual([
      "atlas: animation walk/ne meta.fps must be 12; got 8",
      "atlas: animation walk/ne-shirt meta.fps must be 12; got undefined",
      `atlas: animation walk/sw frame sequence must be ${JSON.stringify(animationAtlas().animations["walk/sw"])}; got ${JSON.stringify(atlas.animations["walk/sw"])}`,
    ]);
  });

  it("checks every page and accepts manifest mask objects", () => {
    const atlas = animationAtlas();
    const maskPage = { frames: atlas.frames, animations: { "walk/ne-shirt": atlas.animations["walk/ne-shirt"] }, meta: atlas.meta };
    delete atlas.animations["walk/ne-shirt"];
    expect(checkAtlases([atlas, maskPage], { ...render, masks: { shirt: ["shirt"], hair: ["hair"] } }, directions)).toEqual([]);
    maskPage.meta.fps["walk/ne-shirt"] = 1;
    expect(checkAtlases([atlas, maskPage], render, directions, "worker")).toEqual([
      "worker-1: animation walk/ne-shirt meta.fps must be 12; got 1",
    ]);
  });

  it("keeps checking still clips without manifest animation ranges", () => {
    const atlas = {
      frames: { "still/ne/frame-000": {} },
      animations: { "still/ne": ["still/ne/frame-000"] },
      meta: { scale: 2 },
    };
    expect(checkAtlases(atlas, { animations: { still: {} } }, { ne: 180 })).toEqual([]);
  });
});

describe("packing", () => {
  it("falls back to a lossless page when the palette PNG would not decode", () => {
    // UPNG 2.1.0 truncates 1x1 pages, which a fully transparent frame trims to.
    for (const size of [1, 2]) {
      const decoded = PNG.sync.read(encodePage(new PNG({ width: size, height: size }), 256));
      expect([decoded.width, decoded.height]).toEqual([size, size]);
    }
  });

  it("writes a smaller palette PNG when colors are requested", () => {
    const root = mkdtempSync(join(tmpdir(), "agentarium-palette-"));
    temps.push(root);
    const beauty = image(128, 128, 120);
    for (let i = 0; i < beauty.data.length; i += 4) {
      beauty.data[i] = (i * 37 + Math.floor(i / 512) * 19) % 256;
      beauty.data[i + 1] = (i * 13) % 256;
    }
    const input = { clips: [{ name: "still/sw", frames: [{ frame: 0, beauty }] }], outputDir: root };
    packFrames({ ...input, atlas: "lossless" });
    packFrames({ ...input, atlas: "zero", colors: 0 });
    packFrames({ ...input, atlas: "palette", colors: 256 });
    const lossless = readFileSync(join(root, "lossless.png"));
    const palette = readFileSync(join(root, "palette.png"));
    expect(readFileSync(join(root, "zero.png"))).toEqual(lossless);
    expect(palette[25]).toBe(3);
    const decoded = PNG.sync.read(palette);
    expect([decoded.width, decoded.height]).toEqual([128, 128]);
    expect(palette.length).toBeLessThan(lossless.length);
  });

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
    expect(atlas.meta.fps).toEqual({ "idle/sw": 1, "idle/sw-shirt": 1, "walk/sw": 1, "walk/sw-shirt": 1 });
    expect(atlas.frames["idle/sw/frame-000"].frame).toEqual(atlas.frames["idle/sw/frame-001"].frame);
    expect(atlas.frames["idle/sw/frame-000"].trimmed).toBe(true);
    expect(atlas.frames["idle/sw/frame-000"].spriteSourceSize).toEqual({ x: 1, y: 1, w: 6, h: 6 });
    expect(atlas.frames["idle/sw/frame-000"].sourceSize).toEqual({ w: 8, h: 8 });
    expect(atlas.frames["idle/sw/frame-000"].anchor).toEqual({ x: 0.5, y: 0.875 });
  });

  it.each([
    { count: 1, loop: "pingpong", sequence: [0] },
    { count: 2, loop: "pingpong", sequence: [0, 1] },
    { count: 4, loop: "pingpong", sequence: [0, 1, 2, 3, 2, 1] },
    { count: 4, loop: "cycle", sequence: [0, 1, 2, 3] },
  ])("packs $loop playback for $count frames, including masks", ({ count, loop, sequence }) => {
    const root = mkdtempSync(join(tmpdir(), "agentarium-loop-"));
    temps.push(root);
    const frames = Array.from({ length: count }, (_, frame) => ({
      frame,
      beauty: image(8, 8, 120 + frame),
      masks: { shirt: image(8, 8, 255), hair: image(8, 8, 255) },
    }));
    packFrames({
      clips: [{ name: "walk/ne", frames, fps: 12, loop }],
      outputDir: root,
      atlas: "worker",
      masks: ["shirt", "hair"],
    });
    const atlas = JSON.parse(readFileSync(join(root, "worker.json"), "utf8"));
    for (const suffix of ["", "-shirt", "-hair"]) {
      expect(atlas.animations[`walk/ne${suffix}`]).toEqual(
        sequence.map((frame) => `walk/ne/frame-${String(frame).padStart(3, "0")}${suffix}`),
      );
      expect(atlas.meta.fps[`walk/ne${suffix}`]).toBe(12);
    }
    expect(Object.keys(atlas.frames)).toHaveLength(count * 3);
  });

  it("carries fps and loop from the render log into the atlas", () => {
    const root = mkdtempSync(join(tmpdir(), "agentarium-render-pack-"));
    temps.push(root);
    writeFileSync(join(root, "render-log.json"), JSON.stringify({
      meta: {
        frame_1x: [8, 8], anchor_1x: [4, 7], scale: 2,
        animations: { walk: { frames: 3, fps: 12, loop: "pingpong" }, still: { frames: 1, fps: 1, loop: "cycle" } },
        dirs: ["ne"],
      },
    }));
    for (const [animation, count] of [["walk", 3], ["still", 1]] as const) {
      const dir = join(root, "frames", "beauty", animation, "ne");
      mkdirSync(dir, { recursive: true });
      for (let frame = 0; frame < count; frame += 1) {
        writeFileSync(join(dir, `frame-${String(frame).padStart(3, "0")}.png`), PNG.sync.write(image(8, 8, 120 + frame)));
      }
    }
    packRender(root, join(root, "atlas"), { render: { atlas: "worker" } }, { packing: { maxSize: 128, padding: 2, colors: 256 } });
    expect(readFileSync(join(root, "atlas", "worker.png"))[25]).toBe(3);
    const atlas = JSON.parse(readFileSync(join(root, "atlas", "worker.json"), "utf8"));
    expect(atlas.animations["walk/ne"]).toEqual([
      "walk/ne/frame-000", "walk/ne/frame-001", "walk/ne/frame-002", "walk/ne/frame-001",
    ]);
    expect(atlas.animations["still/ne"]).toEqual(["still/ne/frame-000"]);
    expect(atlas.meta.fps).toEqual({ "walk/ne": 12, "still/ne": 1 });
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
    for (const page of pages) {
      expect(page.meta.fps).toEqual(Object.fromEntries(Object.keys(page.animations).map((name) => [name, 1])));
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
