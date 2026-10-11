import type { Theme } from "./theme";

function assetPath(path: string): string {
  if (!path || path.startsWith("/") || /[\\:]/.test(path)) throw new Error(`Invalid asset path: ${path}`);
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "..") {
      if (!parts.length) throw new Error(`Asset path escapes assets: ${path}`);
      parts.pop();
    } else if (part && part !== ".") parts.push(part);
  }
  if (!parts.length) throw new Error(`Invalid asset path: ${path}`);
  return parts.join("/");
}

/** Files needed by a theme, relative to the assets directory. */
export function themeAssetFiles(theme: Theme, readJson: (path: string) => unknown): string[] {
  const r2d = theme.renderers?.["2d"];
  if (!r2d) return [];
  const files = new Set<string>();
  for (const atlas of r2d.atlases) {
    const path = assetPath(atlas);
    files.add(path);
    const json = readJson(path) as { meta?: { image?: unknown } } | null;
    const image = json?.meta?.image;
    if (typeof image !== "string" || !image) throw new Error(`${path}: needs meta.image`);
    if (image.startsWith("/") || /[\\:]/.test(image)) throw new Error(`${path}: invalid meta.image`);
    const directory = path.slice(0, path.lastIndexOf("/") + 1);
    files.add(assetPath(`${directory}${image}`));
  }
  if (r2d.room) files.add(assetPath(r2d.room));
  return [...files];
}
