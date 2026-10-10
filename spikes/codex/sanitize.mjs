#!/usr/bin/env node
// Spike: turn raw captures in <raw-dir> into one sanitized fixture per scenario:
// <out-dir>/<scenario>.json = { codex_cli_version, scenario, hooks: [...], app?, exec?, otel?, turn_context? }.
// A <scenario>.rollout.jsonl (the session's rollout file) contributes only its turn_context permission fields.
// Replaces local paths and the user name, truncates long strings, drops streaming deltas.
// Usage: node sanitize.mjs <raw-dir> <out-dir> <cli-version> <path-to-redact>...
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

const [rawDir, outDir, version, ...redact] = process.argv.slice(2);
if (!rawDir || !outDir || !version) {
  console.error("usage: sanitize.mjs <raw-dir> <out-dir> <cli-version> <path-to-redact>...");
  process.exit(1);
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const rules = [
  ...redact.map((p, i) => [new RegExp(esc(p), "g"), i === 0 ? "<CWD>" : `<DIR${i}>`]),
  [new RegExp(esc(homedir()), "g"), "<HOME>"],
  [new RegExp(esc(userInfo().username), "g"), "user"],
];
const MAX = 300;
const clean = (v) => {
  if (typeof v === "string") {
    let s = v;
    for (const [re, to] of rules) s = s.replace(re, to);
    return s.length > MAX ? `${s.slice(0, MAX)}…[truncated]` : s;
  }
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)]));
  return v;
};
const lines = (f) => readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
// Streaming and account noise; everything an adapter could key on stays.
const NOISE = /delta|Delta|tokenUsage|rateLimits|account\/|remoteControl|configWarning|mcpServer\/startupStatus/;

// OTel logs carry account ids, e-mail and tool arguments/output: keep only identifiers and outcomes.
const OTEL_KEYS = new Set([
  "event.name", "event.timestamp", "conversation.id", "call_id", "tool_name", "tool_namespace", "success",
  "decision", "source", "duration_ms", "agent_name", "mcp_server", "tool_result_seq", "service.name", "service.version",
]);
const keep = (attrs = []) => attrs.filter((a) => OTEL_KEYS.has(a.key));
const otlpAllowlisted = (body) => ({
  resourceLogs: (body.resourceLogs ?? []).map((rl) => ({
    resource: { attributes: keep(rl.resource?.attributes) },
    scopeLogs: rl.scopeLogs.map((sl) => ({
      logRecords: sl.logRecords
        .map((r) => ({ timeUnixNano: r.timeUnixNano, attributes: keep(r.attributes) }))
        .filter((r) => r.attributes.some((a) => a.key === "event.name" && /^codex\.(tool_|conversation_starts|user_prompt)/.test(a.value.stringValue))),
    })),
  })),
});

mkdirSync(outDir, { recursive: true });
const scenarios = new Set(readdirSync(rawDir).map((f) => f.split(".")[0]));
for (const s of [...scenarios].sort()) {
  const hooksFile = join(rawDir, `${s}.hooks.jsonl`);
  if (!existsSync(hooksFile)) continue;
  const t0 = lines(hooksFile)[0].received_at;
  const fixture = {
    codex_cli_version: version,
    scenario: s,
    hooks: lines(hooksFile).map((l) => clean({ at_ms: l.received_at - t0, ...l.payload })),
  };
  const appFile = join(rawDir, `${s}.app.jsonl`);
  if (existsSync(appFile)) {
    fixture.app = lines(appFile)
      .filter((m) => !NOISE.test(m.method ?? ""))
      .map(({ at, dir, jsonrpc: _j, ...m }) => clean({ at_ms: at - t0, dir, ...m }));
  }
  const sinkFile = join(rawDir, `${s}.sink.jsonl`);
  if (existsSync(sinkFile)) fixture.otel = lines(sinkFile).map((r) => clean(otlpAllowlisted(r.body)));
  const rolloutFile = join(rawDir, `${s}.rollout.jsonl`);
  if (existsSync(rolloutFile)) {
    fixture.turn_context = lines(rolloutFile).filter((l) => l.type === "turn_context")
      .map(({ payload: p }) => clean({ approval_policy: p.approval_policy, approvals_reviewer: p.approvals_reviewer, sandbox_policy: p.sandbox_policy }));
  }
  const execFile = join(rawDir, `${s}.exec.jsonl`);
  if (existsSync(execFile)) fixture.exec = lines(execFile).map(clean);
  writeFileSync(join(outDir, `${s}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(s);
}
