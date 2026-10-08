#!/usr/bin/env node
// Spike: create a throwaway git repo whose project-level
// .claude/settings.local.json routes every hook event to payload-logger.mjs.
// Usage: node setup-scratch-repo.mjs <scratch-dir>
// Never touches user-level Claude config.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const target = process.argv[2];
if (!target) {
  console.error("usage: setup-scratch-repo.mjs <scratch-dir>");
  process.exit(1);
}
const dir = resolve(target);
const logger = join(dirname(fileURLToPath(import.meta.url)), "payload-logger.mjs");
const out = join(dir, "..", "payloads.jsonl");

const EVENTS = [
  "SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse",
  "PostToolUseFailure", "PermissionRequest", "PermissionDenied", "Notification",
  "SubagentStart", "SubagentStop", "TaskCreated", "TaskCompleted", "Stop",
  "StopFailure", "PreCompact", "PostCompact", "Elicitation", "ElicitationResult",
  "TeammateIdle", "InstructionsLoaded", "ConfigChange", "CwdChanged", "FileChanged",
  "WorktreeCreate", "WorktreeRemove",
];

mkdirSync(join(dir, ".claude"), { recursive: true });
const command = `node "${logger.replace(/\\/g, "/")}"`;
const hooks = {};
for (const e of EVENTS) {
  hooks[e] = [{ hooks: [{ type: "command", command, timeout: 5 }] }];
}
writeFileSync(
  join(dir, ".claude", "settings.local.json"),
  JSON.stringify({ hooks }, null, 2) + "\n",
);
writeFileSync(join(dir, "README.md"), "# scratch\n");
execFileSync("git", ["init", "-q"], { cwd: dir });
console.log(JSON.stringify({ dir, out }));
