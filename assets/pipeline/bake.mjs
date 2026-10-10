import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blenderPath, checkBlender } from "./build.mjs";

// Bakes a character's controls into its deformation skeleton and saves (see "Making a character" in
// assets/README.md):
//   pnpm assets:bake <asset dir>          bake every <name>.controls action
//   pnpm assets:bake <asset dir> --link   link the skeleton to the controls, for posing in Blender
const root = resolve(import.meta.dirname, "..");
const settings = JSON.parse(readFileSync(join(root, "pipeline", "settings.json"), "utf8"));

async function bake() {
  const [argument, ...flags] = process.argv.slice(2);
  if (!argument || flags.some((flag) => flag !== "--link") || flags.length > 1) {
    throw new Error("Usage: pnpm assets:bake <asset dir> [--link]");
  }
  const asset = resolve(process.env.INIT_CWD ?? process.cwd(), argument);
  const manifest = JSON.parse(readFileSync(join(asset, "asset.json"), "utf8"));
  const blend = join(asset, manifest.render.blend);
  if (!existsSync(blend)) {
    throw new Error(`Missing ${blend}`);
  }
  const blender = await checkBlender(blenderPath(), settings);
  const child = spawn(blender, [
    "-b", blend, "--factory-startup", "-P", join(root, "pipeline", "bake.py"), "--",
    flags.includes("--link") ? "--link" : "--bake", "--save",
  ], { stdio: "inherit", windowsHide: true });
  const code = await new Promise((done) => child.on("close", done));
  if (code !== 0) {
    throw new Error(`Blender failed baking ${blend}`);
  }
}

bake().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
