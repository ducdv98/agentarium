import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export const ALLOWED_LICENCES = new Set(["CC0-1.0", "CC-BY-4.0"]);

function problem(path, message) {
  return `${path}: ${message}`;
}

function filesUnder(directory) {
  if (!existsSync(directory)) {
    return [];
  }
  const files = [];
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      if (name === "node_modules" || name === ".cache") {
        continue; // pnpm's symlinked store, and render output
      }
      files.push(...filesUnder(path));
    } else {
      files.push(path);
    }
  }
  return files;
}

function readManifest(assetPath) {
  try {
    return JSON.parse(readFileSync(join(assetPath, "asset.json"), "utf8"));
  } catch {
    return undefined;
  }
}

export function findAssets(src) {
  if (!existsSync(src)) {
    return [];
  }
  const assets = [];
  for (const kind of readdirSync(src).sort()) {
    const kindPath = join(src, kind);
    if (!statSync(kindPath).isDirectory()) {
      continue;
    }
    for (const name of readdirSync(kindPath).sort()) {
      const assetPath = join(kindPath, name);
      if (statSync(assetPath).isDirectory()) {
        assets.push(assetPath);
      }
    }
  }
  return assets;
}

export function validateManifest(assetPath, manifest) {
  const manifestPath = join(assetPath, "asset.json");
  const problems = [];
  for (const field of ["name", "licence", "sources"]) {
    if (!manifest?.[field]) {
      problems.push(problem(manifestPath, `missing ${field}`));
    }
  }
  if (!ALLOWED_LICENCES.has(manifest?.licence)) {
    problems.push(problem(manifestPath, "licence must be CC0-1.0 or CC-BY-4.0"));
  }
  if (!Array.isArray(manifest?.sources) || manifest.sources.length === 0) {
    problems.push(problem(manifestPath, "sources must be a non-empty array"));
  } else {
    manifest.sources.forEach((source, index) => {
      for (const field of ["source", "author", "url", "licence", "changes"]) {
        if (!source?.[field]) {
          problems.push(problem(manifestPath, `sources[${index}].${field} is required`));
        }
      }
      if (source?.licence && !ALLOWED_LICENCES.has(source.licence)) {
        problems.push(problem(manifestPath, `sources[${index}].licence ${source.licence} is not allowed`));
      }
    });
  }
  const render = manifest?.render;
  if (render) {
    const blend = render.blend ? resolve(assetPath, render.blend) : "";
    // Inside the asset directory, so the licence manifest covers the file that is rendered.
    const inside = blend && dirname(blend) === resolve(assetPath);
    if (!inside || !blend.toLowerCase().endsWith(".blend") || !existsSync(blend)) {
      problems.push(problem(manifestPath, "render.blend must name an existing .blend file in the asset directory"));
    }
    // A trailing -<n> would clash with another atlas's page files (<atlas>-0.json, <atlas>-1.json, ...).
    if (!render.atlas || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(render.atlas) || /-\d+$/.test(render.atlas)) {
      problems.push(problem(manifestPath, "render.atlas must be a safe file stem not ending in -<number>"));
    }
    for (const [name, animation] of Object.entries(render.animations ?? {})) {
      if (!animation?.action || !Number.isInteger(animation.fps) || animation.fps <= 0) {
        problems.push(problem(manifestPath, `render.animations.${name} needs action and positive integer fps`));
      }
    }
  }
  return problems;
}

export function validateTree(root) {
  const src = join(root, "src");
  const problems = [];
  const assets = findAssets(src);
  for (const assetPath of assets) {
    const manifestPath = join(assetPath, "asset.json");
    if (!existsSync(manifestPath)) {
      problems.push(problem(assetPath, "missing asset.json"));
      continue;
    }
    try {
      problems.push(...validateManifest(assetPath, JSON.parse(readFileSync(manifestPath, "utf8"))));
    } catch (error) {
      problems.push(problem(manifestPath, `invalid JSON: ${error.message}`));
    }
  }
  for (const file of filesUnder(src)) {
    const parts = relative(src, file).split(/[\\/]/);
    if (parts.length < 3) {
      problems.push(problem(file, "file is not inside an asset directory"));
    }
  }
  for (const file of filesUnder(root)) {
    const parts = relative(root, file).split(/[\\/]/);
    const inAsset = parts[0] === "src" && parts.length >= 4;
    if (file.toLowerCase().endsWith(".blend") && !inAsset) {
      problems.push(problem(file, "blend file must be inside assets/src/<kind>/<name>/"));
    }
  }
  const atlasOwners = new Map();
  for (const assetPath of assets) {
    const atlas = readManifest(assetPath)?.render?.atlas;
    if (typeof atlas === "string") {
      atlasOwners.set(atlas, [...(atlasOwners.get(atlas) ?? []), assetPath]);
    }
  }
  for (const [atlas, owners] of atlasOwners) {
    if (owners.length > 1) {
      problems.push(problem(`atlas ${atlas}`, `used by more than one asset (${owners.join(", ")})`));
    }
  }
  return { assets, problems };
}

export function generateNotice(root) {
  const { assets } = validateTree(root);
  const lines = [
    "The art in assets/ is licensed CC BY 4.0 unless an asset below says otherwise. See assets/LICENSE.",
    "The pipeline code is separate software licensed under the repository MIT licence.",
    "",
  ];
  if (assets.length === 0) {
    return `${lines.join("\n")}\nThere are no assets yet.\n`;
  }
  for (const assetPath of assets.sort()) {
    const manifest = JSON.parse(readFileSync(join(assetPath, "asset.json"), "utf8"));
    lines.push(
      manifest.name,
      `Path: ${relative(root, assetPath).replaceAll("\\", "/")}`,
      `Licence: ${manifest.licence}`,
    );
    for (const source of manifest.sources) {
      lines.push(
        `Source: ${source.what ?? "Source"}; ${source.source}; ${source.author}; `
          + `${source.url}; ${source.licence}; ${source.changes}`,
      );
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function writeNotice(root) {
  const resolvedRoot = resolve(root);
  const notice = generateNotice(resolvedRoot);
  writeFileSync(join(resolvedRoot, "NOTICE"), notice);
  return notice;
}
