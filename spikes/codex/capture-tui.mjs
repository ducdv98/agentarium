#!/usr/bin/env node
// Spike, human in the loop: captures the Codex TUI's /permissions presets, which no script can drive.
// Sets up an isolated CODEX_HOME, opens `codex` in a scratch repo for the person, then saves the hook
// payloads plus each session's rollout turn_context (approval policy, reviewer, sandbox) as one fixture.
// The home lives under ~/.agentarium-spike with short names: the TUI's app-server control socket must
// fit SUN_LEN, and Codex refuses to install helpers under the temp dir. The copied auth.json is deleted
// at the end; the user's own ~/.codex is never edited.
// Usage: node spikes/codex/capture-tui.mjs [scenario]   (run from the repo root)
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const scenario = process.argv[2] ?? "tui-permissions";
const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(homedir(), ".agentarium-spike"), { recursive: true });
const root = mkdtempSync(join(homedir(), ".agentarium-spike", "t-"));
const isolatedCodexHome = join(root, "h");
const scratchRepo = join(root, "repo");
const payloads = join(root, "payloads.jsonl");
const rawDir = join(root, "raw");
mkdirSync(rawDir);
const env = { ...process.env, CODEX_HOME: isolatedCodexHome };

execFileSync(process.execPath, [join(here, "setup-codex-home.mjs"), isolatedCodexHome, scratchRepo, payloads], { stdio: "inherit" });
writeFileSync(join(scratchRepo, "README.md"), "# scratch\n");
execFileSync("git", ["init", "-q"], { cwd: scratchRepo });

const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log(`
Codex will open in a scratch repo (${scratchRepo}) with an isolated home. In it:
  1. Type /permissions and note the preset it shows as current.
  2. Pick each preset in turn. After each pick, paste this prompt and answer as noted:
       Create the file probe.txt containing hi with one shell command, then reply DONE.
     - approve it under the first preset that asks,
     - decline it under the next one that asks,
     - press Esc on it once.
  3. If a custom profile is offered, choose it, note the policy and sandbox it shows, and run the prompt once more.
  4. Quit with /quit (or Ctrl+C twice).
Write down which preset each turn used: the fixture records hooks and turn_context, not the preset's name.`);
await rl.question("Enter to open Codex: ");
rl.close();
spawnSync("codex", [], { cwd: scratchRepo, env, stdio: "inherit" });

spawnSync("codex", ["app-server", "daemon", "stop"], { env, stdio: "ignore" });
// `daemon stop` can leave the managed app-server running from the isolated home on Windows.
if (process.platform === "win32") {
  spawnSync("powershell.exe", ["-NoProfile", "-Command",
    `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '${isolatedCodexHome.replaceAll("'", "''")}\\*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`], { stdio: "ignore" });
}
if (existsSync(payloads)) renameSync(payloads, join(rawDir, `${scenario}.hooks.jsonl`));
else console.log("No hook payloads were recorded.");
// Every session's rollout, oldest first, so each turn_context of the capture is kept.
const rollouts = [];
const walk = (dir) => {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    if (name.isDirectory()) walk(path);
    else if (/^rollout-.*\.jsonl$/.test(name.name)) rollouts.push(path);
  }
};
walk(join(isolatedCodexHome, "sessions"));
writeFileSync(join(rawDir, `${scenario}.rollout.jsonl`), rollouts.sort().map((p) => readFileSync(p, "utf8").trim()).join("\n"));
execFileSync(process.execPath, [join(here, "sanitize.mjs"), rawDir, resolve("spikes/fixtures/codex"), "0.162.1", scratchRepo, isolatedCodexHome, root], { stdio: "inherit" });
rmSync(join(isolatedCodexHome, "auth.json"), { force: true });
console.log(`Wrote spikes/fixtures/codex/${scenario}.json. The copied auth.json was deleted; raw files stay in ${root} (delete it when done).`);
