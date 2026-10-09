// Full package build: the bundles plus the built UI copied to dist/ui for the daemon to serve,
// and the repo-root LICENSE and README copied in so npm publishes them with the package.
import { copyFileSync, cpSync, existsSync, rmSync } from "node:fs";
import { bundle, here } from "./bundle.mjs";

const ui = here("../ui-web/dist");
if (!existsSync(`${ui}/index.html`)) {
  console.error(`missing ${ui}/index.html; build @agentarium/ui-web first (pnpm build)`);
  process.exit(1);
}
rmSync(here("dist"), { recursive: true, force: true });
await bundle();
cpSync(ui, here("dist/ui"), { recursive: true });
for (const f of ["LICENSE", "README.md"]) copyFileSync(here(`../../${f}`), here(f));
