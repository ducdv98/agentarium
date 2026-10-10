#!/usr/bin/env node
// Spike: turn raw captures in <raw-dir> into one sanitized fixture per scenario:
// <out-dir>/<scenario>.json = { codex_cli_version, scenario, hooks: [...], app?: [...] }.
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
  const execFile = join(rawDir, `${s}.exec.jsonl`);
  if (existsSync(execFile)) fixture.exec = lines(execFile).map(clean);
  writeFileSync(join(outDir, `${s}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(s);
}
