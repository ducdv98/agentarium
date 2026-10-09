#!/usr/bin/env node
// Spike: turn raw payload JSONL captures into one sanitized fixture per
// (event, in-subagent?) pair. Replaces local paths/ids, truncates long strings.
// Usage: node sanitize-fixtures.mjs <out-dir> <cwd-to-redact> <payloads.jsonl>...
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

const [outDir, cwd, ...inputs] = process.argv.slice(2);
if (!outDir || !cwd || inputs.length === 0) {
  console.error("usage: sanitize-fixtures.mjs <out-dir> <cwd> <payloads.jsonl>...");
  process.exit(1);
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const variants = (p) => [p, p.replace(/\\/g, "\\\\"), p.replace(/\\/g, "/")];
const rules = [
  ...variants(cwd).map((v) => [new RegExp(esc(v), "gi"), "<CWD>"]),
  ...variants(homedir()).map((v) => [new RegExp(esc(v), "gi"), "<HOME>"]),
];
rules.push([new RegExp(esc(userInfo().username), "gi"), "user"]);
const MAX = 300;

function clean(v) {
  if (typeof v === "string") {
    let s = v;
    for (const [re, to] of rules) s = s.replace(re, to);
    return s.length > MAX ? s.slice(0, MAX) + "…[truncated]" : s;
  }
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)]));
  }
  return v;
}

mkdirSync(outDir, { recursive: true });
const seen = new Set();
for (const file of inputs) {
  for (const line of readFileSync(file, "utf8").trim().split("\n")) {
    const { payload } = JSON.parse(line);
    const event = payload.hook_event_name ?? "unknown";
    const tool = payload.tool_name ? `.${payload.tool_name}` : payload.notification_type ? `.${payload.notification_type}` : "";
    const sub = payload.agent_id && !event.startsWith("Subagent") ? ".in-subagent" : "";
    const name = `${event}${tool}${sub}`;
    if (seen.has(name)) continue;
    seen.add(name);
    writeFileSync(join(outDir, `${name}.json`), JSON.stringify(clean(payload), null, 2) + "\n");
  }
}
console.log([...seen].sort().join("\n"));
