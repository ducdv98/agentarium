#!/usr/bin/env node
// Spike: turn capture-headless.mjs output into one sanitized sequence fixture per scenario:
// <out-dir>/<scenario>.json = { claude_code_version, scenario, hooks: [payload with at_ms] }.
// Redacts the throwaway repo, home and username; truncates long strings.
// Usage: node sanitize-sequences.mjs <raw-dir> <out-dir> <claude-version>
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { join } from "node:path";

const [rawDir, outDir, version] = process.argv.slice(2);
if (!rawDir || !outDir || !version) {
  console.error("usage: sanitize-sequences.mjs <raw-dir> <out-dir> <claude-version>");
  process.exit(1);
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const variants = (p) => [p.replace(/\\/g, "\\\\"), p, p.replace(/\\/g, "/")];
const scratch = (p) => new RegExp(`${esc(p)}[\\\\/]+agentarium-claude-[A-Za-z0-9]+(?:[\\\\/]+repo)?`, "gi");
const rules = [
  ...variants(tmpdir()).map((v) => [scratch(v), "<CWD>"]),
  ...variants(homedir()).map((v) => [new RegExp(esc(v), "gi"), "<HOME>"]),
  [new RegExp(esc(userInfo().username), "gi"), "user"],
];
const MAX = 300;
function clean(v) {
  if (typeof v === "string") {
    let s = v;
    for (const [re, to] of rules) s = s.replace(re, to);
    return s.length > MAX ? `${s.slice(0, MAX)}…[truncated]` : s;
  }
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)]));
  return v;
}

mkdirSync(outDir, { recursive: true });
for (const file of readdirSync(rawDir).filter((f) => f.endsWith(".hooks.jsonl")).sort()) {
  const scenario = file.replace(/\.hooks\.jsonl$/, "");
  const lines = readFileSync(join(rawDir, file), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const t0 = lines[0]?.received_at ?? 0;
  const hooks = lines.map(({ received_at, payload }) => clean({ at_ms: received_at - t0, ...payload }));
  writeFileSync(join(outDir, `${scenario}.json`), `${JSON.stringify({ claude_code_version: version, scenario, hooks }, null, 2)}\n`);
  console.log(scenario);
}
