import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { generateNotice, validateTree } from "./licences.mjs";
import { packRender } from "./pack.mjs";

const root = resolve(import.meta.dirname, "..");
const settingsPath = join(root, "pipeline", "settings.json");
const settings = JSON.parse(readFileSync(settingsPath, "utf8"));

/** Calculate a file's SHA-256 digest. */
export async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

/** Validate the pinned Windows Blender executable before starting Blender. */
export async function checkBlender(filePath, pin = settings, runtime = process) {
  if (runtime.platform !== "win32" || runtime.arch !== "x64") {
    throw new Error("Pinned Blender is supported only on Windows x64; see assets/README.md.");
  }
  if (!existsSync(filePath)) {
    throw new Error(`Pinned Blender executable is missing at ${filePath}; see assets/README.md.`);
  }
  const actual = await sha256(filePath);
  const expected = pin.blender.exeSha256;
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(
      `Refusing Blender checksum: expected ${expected}, got ${actual}; see assets/README.md.`,
    );
  }
  return filePath;
}

function blenderPath() {
  return process.env.AGENTARIUM_BLENDER || settings.blender.defaultExe;
}

async function runBlender(blender, assetPath, outputDir) {
  mkdirSync(outputDir, { recursive: true });
  const args = [
    "-b", "--factory-startup", "-P", join(root, "pipeline", "render.py"), "--",
    "--asset", assetPath, "--settings", settingsPath, "--out", outputDir,
  ];
  const log = [];
  const child = spawn(blender, args, {
    env: { ...process.env, BLENDER_USER_RESOURCES: join(root, ".cache", "blender-user") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (data) => {
      const text = data.toString();
      log.push(text);
      for (const line of text.split(/\r?\n/)) {
        if (/^(FRAME|DONE|Refusing|Error)/.test(line)) {
          console.log(line);
        }
      }
    });
  }
  const code = await new Promise((done) => child.on("close", done));
  writeFileSync(join(outputDir, "blender.log"), log.join(""));
  if (code !== 0) {
    throw new Error(`Blender failed for ${assetPath}; see ${join(outputDir, "blender.log")}`);
  }
}

function removeAtlasFiles(atlasDir, atlas) {
  if (!existsSync(atlasDir)) {
    return;
  }
  for (const file of readdirSync(atlasDir)) {
    if (new RegExp(`^${atlas}(?:-\\d+)?\\.(?:json|png)$`).test(file)) {
      rmSync(join(atlasDir, file), { force: true });
    }
  }
}

/** Render and pack one asset into caller-owned directories. */
export async function buildAsset(assetPath, options = {}) {
  const manifest = JSON.parse(readFileSync(join(assetPath, "asset.json"), "utf8"));
  const buildDir = options.buildDir ?? join(root, ".cache", "build");
  const atlasDir = options.atlasDir ?? join(root, "atlases");
  const outputDir = join(buildDir, manifest.render.atlas);
  const blender = await checkBlender(blenderPath(), settings);
  rmSync(outputDir, { recursive: true, force: true });
  await runBlender(blender, assetPath, outputDir);
  // Only after a good render, so a failed build keeps the committed atlas.
  mkdirSync(atlasDir, { recursive: true });
  removeAtlasFiles(atlasDir, manifest.render.atlas);
  return packRender(outputDir, atlasDir, manifest, settings);
}

export async function build() {
  const tree = validateTree(root);
  if (tree.problems.length) {
    throw new Error(tree.problems.join("\n"));
  }
  writeFileSync(join(root, "NOTICE"), generateNotice(root));
  const onlyIndex = process.argv.indexOf("--only");
  const only = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : undefined;
  if (onlyIndex >= 0 && !only) {
    throw new Error("--only needs an asset path or atlas name.");
  }
  const renderAssets = tree.assets.filter((assetPath) => {
    const manifest = JSON.parse(readFileSync(join(assetPath, "asset.json"), "utf8"));
    // pnpm runs this from assets/; INIT_CWD is where the user typed the command.
    const onlyPath = only && resolve(process.env.INIT_CWD ?? process.cwd(), only);
    return manifest.render && (!only || assetPath === onlyPath || manifest.render.atlas === only);
  });
  if (only && renderAssets.length === 0) {
    throw new Error(`--only matched no renderable asset: ${only}`);
  }
  for (const assetPath of renderAssets) {
    await buildAsset(assetPath);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  build().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
