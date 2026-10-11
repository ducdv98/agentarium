import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { build, createServer, type ViteDevServer } from "vite";
import { dotGrid, type Theme } from "@agentarium/renderer";
import { themeAssets } from "../vite-plugin-theme-assets";

const temps: string[] = [];
let server: ViteDevServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
  for (const path of temps.splice(0)) rmSync(path, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "agentarium-theme-assets-"));
  temps.push(root);
  const assets = join(root, "art");
  const files = {
    "atlases/worker.json": JSON.stringify({ meta: { image: "worker.png" } }),
    "atlases/worker.png": "png fixture",
    "src/room/layout.json": "{}",
    LICENSE: "licence fixture",
    NOTICE: "attribution fixture",
  };
  for (const [path, body] of Object.entries({ ...files, "src/private.blend": "private" })) {
    const file = join(assets, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
  }
  writeFileSync(join(root, "index.html"), "<html><body>Office</body></html>");
  const theme: Theme = {
    ...dotGrid,
    renderers: { "2d": { atlases: ["atlases/worker.json"], room: "src/room/layout.json", states: {}, categories: {} } },
  };
  return { root, assets, files, theme };
}

describe("theme assets plugin", () => {
  it("serves only theme files and attribution in dev with their content types", async () => {
    const { root, assets, files, theme } = fixture();
    server = await createServer({
      configFile: false, root, appType: "custom", plugins: [themeAssets(assets, [theme])],
      optimizeDeps: { noDiscovery: true, entries: [] }, server: { host: "127.0.0.1", port: 0 },
    });
    await server.listen();
    const address = server.httpServer!.address() as { port: number };
    const base = `http://127.0.0.1:${address.port}`;
    for (const [path, body] of Object.entries(files)) {
      const response = await fetch(`${base}/assets/${path}?v=1`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(path.endsWith(".png") ? "image/png" : path.endsWith(".json") ? "application/json" : "text/plain");
      expect(await response.text()).toBe(body);
    }
    expect((await fetch(`${base}/assets/src/private.blend`)).status).toBe(404);
  });

  it("emits the art and attribution under assets with subdirectories intact", async () => {
    const { root, assets, files, theme } = fixture();
    const result = await build({ configFile: false, root, plugins: [themeAssets(assets, [theme])], logLevel: "silent", build: { write: false } });
    if (Array.isArray(result) || !("output" in result)) throw new Error("Expected one build output");
    const output = result.output.filter((file) => file.type === "asset").filter((file) => file.fileName.startsWith("assets/"));
    expect(output.map((file) => file.fileName).sort()).toEqual(Object.keys(files).map((path) => `assets/${path}`).sort());
    for (const file of output) expect(Buffer.from(file.source).toString()).toBe(files[file.fileName.slice(7) as keyof typeof files]);
  });
});
