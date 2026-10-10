#!/usr/bin/env node
// Spike, human in the loop: walks a person through the interactive Claude Code permission cases that a
// headless run cannot reach (Esc on a prompt, deny in the TUI, Notification types, elicitation), one
// scenario per Claude session, then writes sanitized sequence fixtures like capture-headless.mjs does.
// Hooks come from a --settings file and --setting-sources project,local keeps the user's own settings
// out; nothing under ~/.claude is edited.
// Usage: node capture-interactive.mjs <out-dir>   (e.g. spikes/fixtures/claude-code/modes)
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ask } from "../ask.mjs";

const outDir = process.argv[2];
if (!outDir) {
  console.error("usage: capture-interactive.mjs <out-dir>");
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
const logger = join(here, "..", "payload-logger.mjs").replace(/\\/g, "/");
const raw = mkdtempSync(join(tmpdir(), "agentarium-claude-raw-"));
const EVENTS = [
  "SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure",
  "PermissionRequest", "PermissionDenied", "Notification", "SubagentStart", "SubagentStop", "Stop",
  "StopFailure", "Elicitation", "ElicitationResult",
];
const BASH = `Run this exact shell command with the Bash tool: node -e "require('fs').writeFileSync('b.txt','x')" . If it is refused, do not retry. Then reply DONE.`;
const SCENARIOS = [
  { name: "tui-deny", mode: "manual", steps: [`Paste: ${BASH}`, "When the permission prompt appears, choose No.", "Wait for DONE, then type /exit."] },
  { name: "tui-esc", mode: "manual", steps: [`Paste: ${BASH}`, "When the permission prompt appears, press Esc.", "Type /exit."] },
  { name: "tui-idle-prompt", mode: "manual", steps: [`Paste: ${BASH}`, "Leave the permission prompt untouched for 70 seconds (a permission_prompt Notification should fire).", "Then choose Yes, wait for DONE, leave it idle another 70 seconds (idle_prompt), and type /exit."] },
  { name: "tui-ask-question", mode: "manual", steps: ["Paste: Use the AskUserQuestion tool to ask me whether to name a file a.txt or b.txt, then reply DONE.", "Answer the question.", "Type /exit."] },
  { name: "tui-subagent", mode: "manual", steps: [`Paste: Use the Agent tool to spawn one general-purpose sub-agent with this task: ${BASH} Do not run it yourself.`, "When the sub-agent's permission prompt appears, choose No.", "Wait for the reply, then type /exit."] },
  { name: "tui-auto", mode: "auto", steps: ["Paste: Run this exact shell command with the Bash tool: rm -rf /nonexistent-agentarium-probe-dir . If it is refused, do not retry. Then reply DONE.", "If a prompt appears, choose No. Type /exit."] },
];

console.log(`Raw captures go to ${raw}. Each scenario opens a fresh Claude Code session in a throwaway repo.`);
for (const [i, s] of SCENARIOS.entries()) {
  const answer = (ask(`\n[${i + 1}/${SCENARIOS.length}] ${s.name} (${s.mode}). Enter to start, s to skip, q to stop: `)).trim();
  if (answer === "q") break;
  if (answer === "s") continue;
  const work = mkdtempSync(join(tmpdir(), "agentarium-claude-"));
  const repo = join(work, "repo");
  mkdirSync(repo);
  writeFileSync(join(repo, "README.md"), "# scratch\n");
  execFileSync("git", ["init", "-q"], { cwd: repo });
  const settings = join(work, "settings.json");
  const hook = [{ hooks: [{ type: "command", command: `node "${logger}"`, timeout: 5 }] }];
  writeFileSync(settings, JSON.stringify({ hooks: Object.fromEntries(EVENTS.map((e) => [e, hook])) }, null, 2));
  const payloads = join(work, "payloads.jsonl");
  console.log("In the Claude session:");
  s.steps.forEach((step, n) => console.log(`  ${n + 1}. ${step}`));
  ask("Enter to open Claude Code: ");
  spawnSync("claude", ["--setting-sources", "project,local", "--settings", settings, "--permission-mode", s.mode], {
    cwd: repo, env: { ...process.env, AGENTARIUM_SPIKE_OUT: payloads }, stdio: "inherit",
  });
  if (existsSync(payloads)) renameSync(payloads, join(raw, `${s.name}.hooks.jsonl`));
  else console.log("No hook payloads were recorded for this scenario.");
}
execFileSync(process.execPath, [join(here, "sanitize-sequences.mjs"), raw, outDir, execFileSync("claude", ["--version"], { encoding: "utf8" }).split(" ")[0]], { stdio: "inherit" });
console.log("Done. Check the new fixtures with git diff, and that ~/.claude/settings.json is unchanged.");
