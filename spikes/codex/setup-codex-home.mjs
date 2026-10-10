#!/usr/bin/env node
// Spike: build an isolated CODEX_HOME whose user hooks.json routes every Codex hook
// event to payload-logger.mjs, plus a fixture MCP server, then trust those hooks.
// Usage: node setup-codex-home.mjs <codex-home> <workdir> <payloads.jsonl>
// Copies auth.json from ~/.codex; never edits the user's own Codex config.
import { copyFileSync, chmodSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rpcSession } from "./rpc.mjs";

const [homeArg, workArg, outArg] = process.argv.slice(2);
if (!homeArg || !workArg || !outArg) {
  console.error("usage: setup-codex-home.mjs <codex-home> <workdir> <payloads.jsonl>");
  process.exit(1);
}
const home = resolve(homeArg);
const work = resolve(workArg);
const here = dirname(fileURLToPath(import.meta.url));
const logger = join(here, "..", "payload-logger.mjs");

const EVENTS = [
  "SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse",
  "SubagentStart", "SubagentStop", "Stop", "Interrupt", "PreCompact", "PostCompact",
];

mkdirSync(home, { recursive: true });
mkdirSync(work, { recursive: true });
copyFileSync(join(homedir(), ".codex", "auth.json"), join(home, "auth.json"));
chmodSync(join(home, "auth.json"), 0o600);
const command = `AGENTARIUM_SPIKE_OUT='${resolve(outArg)}' node '${logger}'`;
writeFileSync(
  join(home, "hooks.json"),
  JSON.stringify({ hooks: Object.fromEntries(EVENTS.map((e) => [e, [{ hooks: [{ type: "command", command }] }]])) }, null, 2),
);
writeFileSync(
  join(home, "config.toml"),
  [
    `model_reasoning_effort = "low"`,
    `[projects."${work}"]`,
    `trust_level = "trusted"`,
    `[mcp_servers.fx]`,
    `command = "node"`,
    `args = ["${join(here, "fx-mcp-server.mjs")}"]`,
    "",
  ].join("\n"),
);

// Hooks from a user hooks.json only run once trusted; record the current hashes as trusted.
const rpc = await rpcSession({ CODEX_HOME: home });
const listed = await rpc.call("hooks/list", { cwds: [work] });
rpc.close();
for (const entry of listed.result.data) {
  for (const h of entry.hooks) {
    appendFileSync(join(home, "config.toml"), `\n[hooks.state."${h.key}"]\ntrusted_hash = "${h.currentHash}"\n`);
  }
}
console.log(`CODEX_HOME=${home} ready; hooks log to ${resolve(outArg)}`);
