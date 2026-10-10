#!/usr/bin/env node
// Spike, end to end: one real Codex turn (approval policy on-request) whose hooks are forwarded by the built
// `agentarium hook codex` to a daemon built from this checkout; prints the Codex events the daemon logged.
// Isolated CODEX_HOME and AGENTARIUM_HOME under <work-dir>; never touches ~/.codex or ~/.claude. Build first.
// Usage: node e2e-daemon.mjs <repo-root> <work-dir> <accept|decline|cancel> <sandbox> <prompt>
import { spawn } from "node:child_process";
import { appendFileSync, copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [root, workArg, answer, sandbox, prompt] = process.argv.slice(2);
const work = resolve(workArg);
const codexHome = join(work, "codex-home");
const agHome = join(work, "ag-home");
const repo = join(work, "repo");
const port = 47_991;
rmSync(work, { recursive: true, force: true });
for (const d of [codexHome, agHome, repo]) mkdirSync(d, { recursive: true });
copyFileSync(join(homedir(), ".codex", "auth.json"), join(codexHome, "auth.json"));
const toml = (s) => s.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
writeFileSync(join(codexHome, "config.toml"), `model_reasoning_effort = "low"\nwindows.sandbox = "elevated"\n[projects."${toml(repo)}"]\ntrust_level = "trusted"\n`);
const q = (s) => `'${s.replaceAll("'", "''")}'`;
const command = `& ${q(process.execPath)} ${q(join(root, "packages/cli/dist/bin.js"))} hook codex --port ${port} --home ${q(agHome)}`;
const EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse", "Stop", "Interrupt", "SessionEnd"];
writeFileSync(join(codexHome, "hooks.json"), JSON.stringify({ hooks: Object.fromEntries(EVENTS.map((e) => [e, [{ hooks: [{ type: "command", command, timeout: 10 }] }]])) }));
const { rpcSession } = await import(pathToFileURL(join(root, "spikes/codex/rpc.mjs")).href);
let rpc = await rpcSession({ CODEX_HOME: codexHome });
for (const entry of (await rpc.call("hooks/list", { cwds: [repo] })).result.data) {
  for (const h of entry.hooks) appendFileSync(join(codexHome, "config.toml"), `\n[hooks.state."${toml(h.key)}"]\ntrusted_hash = "${toml(h.currentHash)}"\n`);
}
rpc.close();

const daemon = spawn(process.execPath, [join(root, "packages/cli/dist/daemon.js")], {
  env: { ...process.env, AGENTARIUM_HOME: agHome, AGENTARIUM_PORT: String(port), AGENTARIUM_CODEX_LIVE: "0", CODEX_HOME: codexHome },
  stdio: ["ignore", "inherit", "inherit"],
});
await new Promise((r) => setTimeout(r, 2_000));

let done;
const finished = new Promise((r) => (done = r));
rpc = await rpcSession({ CODEX_HOME: codexHome }, {
  onNotify: (m) => { if (m.method === "turn/completed") done(); },
  onRequest: () => ({ decision: answer }),
});
const started = await rpc.call("thread/start", { cwd: repo, approvalPolicy: "on-request", sandbox });
await rpc.call("turn/start", { threadId: started.result.thread.id, input: [{ type: "text", text: prompt }] });
const timer = setTimeout(done, 180_000);
await finished;
clearTimeout(timer);
await new Promise((r) => setTimeout(r, 3_000));
rpc.close();
await new Promise((r) => setTimeout(r, 1_000));
daemon.kill();

const dataDir = join(agHome, "data");
const lines = readdirSync(dataDir).filter((f) => f.endsWith(".jsonl")).flatMap((f) => readFileSync(join(dataDir, f), "utf8").trim().split("\n"));
for (const l of lines) {
  const e = JSON.parse(l).event ?? JSON.parse(l);
  if (e.agent?.provider !== "codex") continue;
  console.log(e.kind, e.tool ?? "", e.ok ?? "", e.summary ?? "", e.permission_mode ?? "");
}
