import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { themeAssetFiles } from "../renderer/src/theme-assets";
import { shippedThemes } from "../renderer/src/themes";
import type { Theme } from "../renderer/src/theme";

const assetsRoot = fileURLToPath(new URL("../../assets/", import.meta.url));
const contentTypes: Record<string, string> = { ".json": "application/json", ".png": "image/png" };

/** Serve and ship only the art referenced by shipped themes, with its attribution. */
export function themeAssets(assetsDir = assetsRoot, themes: Theme[] = shippedThemes): Plugin {
  const readJson = (path: string): unknown => JSON.parse(readFileSync(join(assetsDir, path), "utf8"));
  const files = new Set(themes.flatMap((theme) => themeAssetFiles(theme, readJson)));
  if (files.size) {
    files.add("LICENSE");
    files.add("NOTICE");
  }
  return {
    name: "agentarium-theme-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        let path: string;
        try {
          path = decodeURIComponent((req.url ?? "").split("?")[0]!);
        } catch {
          return next();
        }
        if (!path.startsWith("/assets/") || (req.method !== "GET" && req.method !== "HEAD")) return next();
        const file = path.slice("/assets/".length);
        if (!files.has(file)) return next();
        const body = readFileSync(join(assetsDir, file));
        res.setHeader("Content-Type", contentTypes[extname(file)] ?? "text/plain; charset=utf-8");
        res.setHeader("Content-Length", body.length);
        res.end(req.method === "HEAD" ? undefined : body);
      });
    },
    generateBundle() {
      for (const file of files) {
        this.emitFile({ type: "asset", fileName: `assets/${file}`, source: readFileSync(join(assetsDir, file)) });
      }
    },
  };
}
