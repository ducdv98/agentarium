#!/usr/bin/env node
// Human-in-the-loop capture for TUI-only permission profiles.
// Run: node spikes/codex/capture-tui.mjs <scenario>
// The operator presses Enter between the numbered instructions; this script never
// selects a permission profile or answers a prompt on the operator's behalf.
import { createInterface } from "node:readline";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scenario = process.argv[2] ?? "tui-permissions";
const here = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(tmpdir(), "agentarium-tui-"));
const isolatedCodexHome = join(root, "codex-home");
const scratchRepo = join(root, "repo");
const payloads = join(root, "payloads.jsonl");
mkdirSync(isolatedCodexHome);
mkdirSync(scratchRepo);

const ask = (text) => new Promise((done) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.question(`${text}\nPress Enter when complete. `, () => { rl.close(); done(); });
});

await new Promise((resolveRun, reject) => {
  const p = spawn(process.execPath, [join(here, "setup-codex-home.mjs"), isolatedCodexHome, scratchRepo, payloads], { stdio: "inherit" });
  p.on("exit", (code) => code ? reject(new Error(`setup exited ${code}`)) : resolveRun());
});

console.log(`Isolated CODEX_HOME: ${isolatedCodexHome}`);
console.log(`Scratch repo: ${scratchRepo}`);
console.log("The following steps are deliberately interactive:");
await ask("1. Start `codex` in the scratch repo with this isolated home: $env:CODEX_HOME='...'; codex");
await ask("2. Type /permissions, record the displayed preset/profile, and select each preset once. Do not change files outside the scratch repo.");
await ask("3. For a custom profile, choose custom, record every displayed policy and sandbox, then run one command that would require approval.");
await ask("4. Approve one request, decline one request, and press Esc for one request. Leave the TUI after the final turn completes.");

const rawDir = join(root, "raw");
mkdirSync(rawDir);
console.log(`5. Copy the generated hook log to ${join(rawDir, `${scenario}.hooks.jsonl`)} and the captured app transcript to ${join(rawDir, `${scenario}.app.jsonl`)}.`);
await ask("6. After both files exist, continue to sanitize the capture");
await new Promise((resolveRun, reject) => {
  const p = spawn(process.execPath, [join(here, "sanitize.mjs"), rawDir, resolve("spikes/fixtures/codex"), "0.162.1", scratchRepo, isolatedCodexHome], { stdio: "inherit" });
  p.on("exit", (code) => code ? reject(new Error(`sanitize exited ${code}`)) : resolveRun());
});
console.log(`Wrote spikes/fixtures/codex/${scenario}.json`);
