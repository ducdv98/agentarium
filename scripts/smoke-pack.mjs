// Packs @agentarium/cli, installs the tarball globally into a temp prefix (no dev dependencies),
// and drives init, start, the UI, a hook, stop and uninstall through the installed command.
// Usage: pnpm build && node scripts/smoke-pack.mjs
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cli = resolve(import.meta.dirname, "../packages/cli");
const isWindows = process.platform === "win32";
const tmp = mkdtempSync(join(tmpdir(), "agentarium-smoke-"));

function sh(command, opts = {}) {
  const r = spawnSync(command, { shell: true, encoding: "utf8", ...opts });
  if (r.status !== 0) throw new Error(`"${command}" exited ${r.status}\n${r.stdout}${r.stderr}`);
  return r.stdout;
}

function check(cond, what) {
  if (!cond) throw new Error(`check failed: ${what}`);
  console.log(`ok  ${what}`);
}

const freePort = () =>
  new Promise((done) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => done(port));
    });
  });

let agentarium = null;
try {
  check(existsSync(join(cli, "dist/bin.js")), "packages/cli is built");

  const [packed] = JSON.parse(sh(`npm pack --json --pack-destination "${tmp}"`, { cwd: cli }));
  const files = packed.files.map((f) => f.path);
  for (const f of ["dist/bin.js", "dist/daemon.js", "dist/ui/index.html", "package.json", "LICENSE", "README.md"]) {
    check(files.includes(f), `tarball contains ${f}`);
  }
  check(!files.some((f) => f.startsWith("src/")), "tarball has no sources");

  const prefix = join(tmp, "prefix");
  sh(`npm install -g --prefix "${prefix}" "${join(tmp, packed.filename)}"`, { cwd: tmp });
  const root = isWindows ? join(prefix, "node_modules") : join(prefix, "lib", "node_modules");
  const installed = join(root, "@agentarium", "cli");
  check(existsSync(installed), "package installed");
  check(!existsSync(join(installed, "node_modules")), "no runtime dependencies installed");
  check(readdirSync(root).every((d) => d === "@agentarium" || d.startsWith(".")), "nothing else installed (no tsx)");

  const bin = isWindows ? join(prefix, "agentarium.cmd") : join(prefix, "bin", "agentarium");
  const home = join(tmp, "home");
  const claude = join(tmp, "claude");
  const port = await freePort();
  const env = { ...process.env, AGENTARIUM_HOME: home, CLAUDE_CONFIG_DIR: claude, AGENTARIUM_PORT: String(port) };
  const work = join(tmp, "work");
  mkdirSync(work);
  agentarium = (cmd) => sh(`"${bin}" ${cmd}`, { cwd: work, env });

  agentarium("init");
  const settings = join(claude, "settings.json");
  check(readFileSync(settings, "utf8").includes(`:${port}/hooks/claude-code`), "init writes the hooks");

  agentarium("start");
  const base = `http://127.0.0.1:${port}`;
  const health = await (await fetch(`${base}/health`)).json();
  check(health.app === "agentarium", "start runs the daemon");
  const page = await fetch(`${base}/`);
  check(page.status === 200 && page.headers.get("content-type")?.startsWith("text/html"), "daemon serves the UI");
  const script = /src="(\/assets\/[^"]+\.js)"/.exec(await page.text())?.[1];
  check(script && (await fetch(`${base}${script}`)).status === 200, "daemon serves the UI assets");

  const token = readFileSync(join(home, "token"), "utf8").trim();
  const hook = await fetch(`${base}/hooks/claude-code`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ session_id: "smoke", hook_event_name: "UserPromptSubmit", cwd: work }),
  });
  check(hook.status === 204, "daemon accepts a hook event");

  agentarium("stop");
  check(await fetch(`${base}/health`).then(() => false, () => true), "stop ends the daemon");

  agentarium("uninstall");
  check(!existsSync(settings), "uninstall removes the hooks");
  console.log("\nPASS  smoke-pack");
} catch (err) {
  console.error(`\nFAIL  smoke-pack: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
} finally {
  if (agentarium) {
    try {
      agentarium("stop");
    } catch {
      // already stopped
    }
  }
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
