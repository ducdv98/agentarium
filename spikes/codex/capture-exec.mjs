#!/usr/bin/env node
// Spike: run one `codex exec --json` scenario against a CODEX_HOME made by setup-codex-home.mjs
// and save its hook payloads and exec JSON stream as <raw-dir>/<scenario>.{hooks,exec}.jsonl.
// Usage: node capture-exec.mjs <codex-home> <workdir> <payloads.jsonl> <raw-dir> <scenario> <prompt> [codex args...]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [home, work, payloads, rawDir, scenario, prompt, ...extra] = process.argv.slice(2);
if (!scenario || !prompt) {
  console.error("usage: capture-exec.mjs <codex-home> <workdir> <payloads.jsonl> <raw-dir> <scenario> <prompt> [codex args...]");
  process.exit(1);
}
mkdirSync(rawDir, { recursive: true });
rmSync(payloads, { force: true });
const run = spawnSync("codex", ["exec", "--json", "--skip-git-repo-check", ...extra, prompt], {
  cwd: resolve(work),
  env: { ...process.env, CODEX_HOME: resolve(home) },
  stdio: ["ignore", "pipe", "pipe"],
  encoding: "utf8",
  timeout: 300_000,
});
writeFileSync(join(rawDir, `${scenario}.exec.jsonl`), run.stdout ?? "");
if (existsSync(payloads)) renameSync(payloads, join(rawDir, `${scenario}.hooks.jsonl`));
console.log(`${scenario}: exit ${run.status}${run.error ? ` (${run.error.message})` : ""}`);
