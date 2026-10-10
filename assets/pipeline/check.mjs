import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { generateNotice, validateTree } from "./licences.mjs";
import { checkAtlases } from "./atlas-check.mjs";

const root = resolve(import.meta.dirname, "..");
const settings = JSON.parse(readFileSync(join(root, "pipeline", "settings.json"), "utf8"));
const tree = validateTree(root);
const problems = [...tree.problems];
if (readFileSync(join(root, "NOTICE"), "utf8") !== generateNotice(root)) {
  problems.push("NOTICE is out of date");
}

function atlasPages(atlasName) {
  const atlasDir = join(root, "atlases");
  if (!existsSync(atlasDir)) {
    return [];
  }
  return readdirSync(atlasDir)
    .filter((name) => new RegExp(`^${atlasName}(?:-\\d+)?\\.json$`).test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => {
      const page = JSON.parse(readFileSync(join(atlasDir, name), "utf8"));
      const image = page?.meta?.image;
      if (typeof image !== "string" || !existsSync(join(atlasDir, image))) {
        problems.push(`${name}: meta.image ${image} is not a file in assets/atlases`);
      }
      return page;
    });
}

for (const assetPath of tree.assets) {
  const manifest = JSON.parse(readFileSync(join(assetPath, "asset.json"), "utf8"));
  if (!manifest.render) {
    continue;
  }
  const pages = atlasPages(manifest.render.atlas);
  if (pages.length === 0) {
    problems.push(`${manifest.render.atlas}.json: missing`);
    continue;
  }
  const animations = manifest.render.animations ?? { still: {} };
  const masks = Object.keys(manifest.render.masks ?? {});
  problems.push(...checkAtlases(pages, { animations, masks }, settings.directions, manifest.render.atlas));
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
}
