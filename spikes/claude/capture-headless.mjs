#!/usr/bin/env node
// Spike: run one headless Claude Code scenario in a throwaway repo and save every hook payload to
// <raw-dir>/<scenario>.hooks.jsonl and the stream-json transcript to <raw-dir>/<scenario>.stream.jsonl.
// Hooks and permission rules come from a --settings file; --setting-sources project,local keeps the
// user's own settings (and any Agentarium hooks in them) out of the run. Never edits ~/.claude.
// `answer` decides permission prompts over the stdio control protocol: allow | deny | none (no host:
// the CLI denies anything that would prompt).
// Usage: node capture-headless.mjs <raw-dir> <scenario> <permission-mode> <answer> <rules-json> <prompt>
import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [rawDir, scenario, mode, answer, rulesJson, prompt] = process.argv.slice(2);
if (!prompt) {
  console.error("usage: capture-headless.mjs <raw-dir> <scenario> <permission-mode> <answer> <rules-json> <prompt>");
  process.exit(1);
}
const EVENTS = [
  "SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure",
  "PermissionRequest", "PermissionDenied", "Notification", "SubagentStart", "SubagentStop", "Stop",
  "StopFailure", "Elicitation", "ElicitationResult",
];
const logger = join(dirname(fileURLToPath(import.meta.url)), "..", "payload-logger.mjs").replace(/\\/g, "/");
const work = mkdtempSync(join(tmpdir(), "agentarium-claude-"));
const payloads = join(work, "..", `${scenario}.payloads.jsonl`);
mkdirSync(join(work, "repo"));
const repo = join(work, "repo");
writeFileSync(join(repo, "README.md"), "# scratch\n");
execFileSync("git", ["init", "-q"], { cwd: repo });
const settings = join(work, "settings.json");
const hook = [{ hooks: [{ type: "command", command: `node "${logger}"`, timeout: 5 }] }];
writeFileSync(settings, JSON.stringify({
  hooks: Object.fromEntries(EVENTS.map((e) => [e, hook])),
  permissions: JSON.parse(rulesJson),
}, null, 2));

mkdirSync(rawDir, { recursive: true });
const stream = join(resolve(rawDir), `${scenario}.stream.jsonl`);
writeFileSync(stream, "");
const args = ["-p", "--verbose", "--output-format", "stream-json", "--input-format", "stream-json",
  "--setting-sources", "project,local", "--settings", settings, "--permission-mode", mode, "--max-turns", "8"];
if (answer === "none") args.push("--permission-prompts", "none");
else args.push("--permission-prompt-tool", "stdio");
const p = spawn("claude", args, { cwd: repo, env: { ...process.env, AGENTARIUM_SPIKE_OUT: payloads }, stdio: ["pipe", "pipe", "inherit"] });
const send = (m) => p.stdin.write(`${JSON.stringify(m)}\n`);
let buf = "";
p.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    appendFileSync(stream, `${line}\n`);
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.type === "control_request" && m.request?.subtype === "can_use_tool") {
      const response = answer === "allow"
        ? { behavior: "allow", updatedInput: m.request.input }
        : { behavior: "deny", message: "Denied by the capture script." };
      send({ type: "control_response", response: { subtype: "success", request_id: m.request_id, response } });
    }
    if (m.type === "result") p.stdin.end();
  }
});
send({ type: "control_request", request_id: "init", request: { subtype: "initialize" } });
send({ type: "user", message: { role: "user", content: prompt } });
const timer = setTimeout(() => p.kill(), 240_000);
p.on("exit", (code) => {
  clearTimeout(timer);
  setTimeout(() => {
    if (existsSync(payloads)) renameSync(payloads, join(resolve(rawDir), `${scenario}.hooks.jsonl`));
    console.log(`${scenario}: exit ${code}`);
  }, 1_000);
});
