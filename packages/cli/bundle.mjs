// Bundles the CLI and the daemon into dist/ with everything inlined, so the published package
// has no runtime dependencies.
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

export const here = (p) => fileURLToPath(new URL(p, import.meta.url));

/** Builds dist/bin.js and dist/daemon.js. Leaves dist/ui alone. */
export async function bundle() {
  await build({
    entryPoints: { bin: here("src/bin.ts"), daemon: here("src/daemon-main.ts") },
    outdir: here("dist"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    // ws loads these optional native addons inside try/catch; never bundle or require them.
    external: ["bufferutil", "utf-8-validate"],
    // Bundled CommonJS (ws) calls require() for Node built-ins, which ESM lacks.
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
    logLevel: "warning",
  });
}
