import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { blenderPath, checkBlender, sha256 } from "./build.mjs";

// Builds a character's .blend from scratch with its make.py (see "Making a character" in assets/README.md):
//   pnpm assets:make <asset dir or name>
const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const settingsPath = join(root, "pipeline", "settings.json");
const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
const cache = join(root, ".cache");
const userResources = join(cache, "blender-user");

/** Download a pinned source once into the cache, and check its sha256 every time. */
async function sourceFile(source) {
  const downloads = join(cache, "downloads");
  mkdirSync(downloads, { recursive: true });
  const file = join(downloads, source.file);
  if (!existsSync(file)) {
    const response = await fetch(source.url);
    if (!response.ok) {
      throw new Error(`Could not download ${source.url}: ${response.status}`);
    }
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }
  const actual = await sha256(file);
  if (actual.toLowerCase() !== source.sha256.toLowerCase()) {
    throw new Error(`Refusing ${source.file}: expected sha256 ${source.sha256}, got ${actual}`);
  }
  return file;
}

/**
 * Run prepare() into dir unless dir holds a stamp for this exact source. The stamp is written last, so an
 * interrupted install or extraction is redone from a clean directory.
 */
async function prepared(dir, source, prepare) {
  const stamp = join(dir, ".agentarium-source");
  if (existsSync(stamp) && readFileSync(stamp, "utf8") === source.sha256) {
    return dir;
  }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  await prepare();
  writeFileSync(stamp, source.sha256);
  return dir;
}

/** Install MPFB into the pipeline's own Blender user dir and extract the MakeHuman pack, both verified. */
async function prepareSources(blender) {
  const { mpfb, makehuman } = settings.sources;
  const mpfbZip = await sourceFile(mpfb);
  const packZip = await sourceFile(makehuman);
  const env = { ...process.env, BLENDER_USER_RESOURCES: userResources };
  await prepared(join(userResources, "extensions", "user_default", "mpfb"), mpfb, () => exec(blender, [
    "-b", "--factory-startup", "--command", "extension", "install-file", "--repo", "user_default", mpfbZip,
  ], { env, windowsHide: true }));
  const pack = join(cache, "makehuman");
  await prepared(pack, makehuman, () => exec(blender, [
    "-b", "--factory-startup", "--python-expr",
    `import zipfile; zipfile.ZipFile(r"${packZip}").extractall(r"${pack}")`,
  ], { env, windowsHide: true }));
  return pack;
}

function assetPath(argument) {
  if (!argument) {
    throw new Error("assets:make needs an asset directory or name");
  }
  for (const candidate of [
    resolve(process.env.INIT_CWD ?? process.cwd(), argument),
    join(root, "src", "characters", argument),
  ]) {
    if (existsSync(join(candidate, "make.py"))) {
      return candidate;
    }
  }
  throw new Error(`No make.py found for ${argument}`);
}

async function make() {
  const asset = assetPath(process.argv[2]);
  const blender = await checkBlender(blenderPath(), settings);
  const pack = await prepareSources(blender);
  const manifest = JSON.parse(readFileSync(join(asset, "asset.json"), "utf8"));
  const out = join(asset, manifest.render.blend);
  const logDir = join(cache, "make", manifest.render.atlas);
  mkdirSync(logDir, { recursive: true });
  const child = spawn(blender, [
    "-b", "--factory-startup", "-P", join(asset, "make.py"), "--",
    "--out", out, "--makehuman", pack, "--settings", settingsPath,
  ], {
    env: { ...process.env, BLENDER_USER_RESOURCES: userResources },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const log = [];
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (data) => log.push(data));
  }
  const code = await new Promise((done) => child.on("close", done));
  writeFileSync(join(logDir, "blender.log"), Buffer.concat(log));
  if (code !== 0) {
    throw new Error(`Blender failed making ${asset}; see ${join(logDir, "blender.log")}`);
  }
  console.log(`Made ${out}`);
}

make().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
