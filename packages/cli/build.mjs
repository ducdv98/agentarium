// Full package build: the bundles plus the built UI copied to dist/ui for the daemon to serve.
import { cpSync, existsSync, rmSync } from "node:fs";
import { bundle, here } from "./bundle.mjs";

const ui = here("../ui-web/dist");
if (!existsSync(`${ui}/index.html`)) {
  console.error(`missing ${ui}/index.html; build @agentarium/ui-web first (pnpm build)`);
  process.exit(1);
}
rmSync(here("dist"), { recursive: true, force: true });
await bundle();
cpSync(ui, here("dist/ui"), { recursive: true });
