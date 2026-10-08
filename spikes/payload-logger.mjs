#!/usr/bin/env node
// Spike: append every Claude Code hook payload (stdin JSON) to a JSONL file.
// Output path: $AGENTARIUM_SPIKE_OUT, else ./payloads.jsonl next to this script.
// Never blocks: always exits 0, prints nothing.
import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out =
  process.env.AGENTARIUM_SPIKE_OUT ??
  join(dirname(fileURLToPath(import.meta.url)), "payloads.jsonl");

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = { unparsed: raw };
  }
  try {
    appendFileSync(out, JSON.stringify({ received_at: Date.now(), payload }) + "\n");
  } catch {
    // swallow: a spike logger must never disturb the session
  }
  process.exit(0);
});
