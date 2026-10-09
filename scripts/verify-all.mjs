// Local stand-in for the CI matrix: typecheck, test, build and the pack smoke test on Node 22
// and 24, on this host and on Linux (Docker). macOS is only covered by CI.
// Usage: node scripts/verify-all.mjs [--only host|linux]
// Host Node versions come from nvm (nvm-windows NVM_HOME, or NVM_DIR); a missing version is
// reported as skipped, not passed.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

const NODE_MAJORS = [22, 24];
const MIN = [22, 18];
const STEPS = "pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm build && pnpm smoke:pack";
const repo = resolve(import.meta.dirname, "..");
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
const isWindows = process.platform === "win32";

function nodeBinDir(major) {
  const root = process.env.NVM_HOME ?? (process.env.NVM_DIR && join(process.env.NVM_DIR, "versions", "node"));
  if (!root || !existsSync(root)) return null;
  const version = readdirSync(root)
    .map((name) => /^v(\d+)\.(\d+)\.(\d+)$/.exec(name))
    .filter((m) => m && Number(m[1]) === major && (major !== MIN[0] || Number(m[2]) >= MIN[1]))
    .sort((a, b) => Number(b[2]) - Number(a[2]) || Number(b[3]) - Number(a[3]))[0];
  if (!version) return null;
  const dir = join(root, version[0]);
  return isWindows ? dir : join(dir, "bin");
}

function run(command, env) {
  return spawnSync(command, { cwd: repo, env, shell: true, stdio: "inherit" }).status === 0;
}

function host(major) {
  const bin = nodeBinDir(major);
  if (!bin) return { skipped: `no Node ${major} (>= ${MIN.join(".")} for 22) found via nvm` };
  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === "path") ?? "PATH";
  const env = { ...process.env, [pathKey]: bin + delimiter + process.env[pathKey] };
  return { ok: run(`node --version && ${STEPS}`, env) };
}

function linux(major) {
  if (!run("docker info --format \"{{.ServerVersion}}\"", process.env)) return { skipped: "Docker is not running" };
  // Copy the working tree minus host node_modules/dist so the container installs its own.
  const script = [
    "set -e",
    "mkdir /work && cd /src",
    "tar --exclude=node_modules --exclude=dist -cf - . | tar -C /work -xf -",
    "cd /work && corepack enable && pnpm config set store-dir /pnpm-store",
    "node --version",
    STEPS,
  ].join(" && ");
  const mount = `${repo}:/src:ro`;
  return { ok: run(`docker run --rm -v "${mount}" -v agentarium-pnpm-store:/pnpm-store -e CI=true node:${major} bash -c "${script}"`, process.env) };
}

const targets = [
  ...(only === "linux" ? [] : NODE_MAJORS.map((m) => [`${process.platform} / node ${m}`, () => host(m)])),
  ...(only === "host" ? [] : NODE_MAJORS.map((m) => [`linux (docker) / node ${m}`, () => linux(m)])),
];

const results = [];
for (const [name, fn] of targets) {
  console.log(`\n=== ${name} ===`);
  results.push([name, fn()]);
}

console.log("\n=== summary ===");
for (const [name, r] of results) console.log(`${r.skipped ? "SKIP" : r.ok ? "PASS" : "FAIL"}  ${name}${r.skipped ? `  (${r.skipped})` : ""}`);
console.log("SKIP  macos  (CI only)");
process.exit(results.some(([, r]) => r.ok === false) ? 1 : 0);
