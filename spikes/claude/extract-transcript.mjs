#!/usr/bin/env node
// Spike: copy a Claude Code session transcript into a fixture keeping only what a rejection check reads:
// entry type, tool_use/tool_result ids, is_error, the interrupt marker, and toolUseResult when it is a string.
// Prompts, tool input and tool output are dropped. The file keeps the session id as its name.
// Usage: node extract-transcript.mjs <transcript.jsonl> <out-dir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const [input, outDir] = process.argv.slice(2);
if (!input || !outDir) {
  console.error("usage: extract-transcript.mjs <transcript.jsonl> <out-dir>");
  process.exit(1);
}
const keep = (item) => {
  if (item?.type === "tool_use") return { type: "tool_use", id: item.id, name: item.name };
  if (item?.type === "tool_result") return { type: "tool_result", tool_use_id: item.tool_use_id, ...(item.is_error ? { is_error: true } : {}) };
  if (item?.type === "text" && /^\[Request interrupted/.test(item.text)) return { type: "text", text: item.text };
  return null;
};
const lines = readFileSync(input, "utf8").trim().split("\n").flatMap((l) => {
  const e = JSON.parse(l);
  if (e.type !== "user" && e.type !== "assistant") return [];
  const content = Array.isArray(e.message?.content) ? e.message.content.map(keep).filter(Boolean) : [];
  if (!content.length) return [];
  return [JSON.stringify({ type: e.type, message: { role: e.type, content },
    ...(typeof e.toolUseResult === "string" ? { toolUseResult: e.toolUseResult.slice(0, 80) } : e.toolUseResult ? { toolUseResult: "<object>" } : {}) })];
});
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, basename(input)), `${lines.join("\n")}\n`);
console.log(`${basename(input)}: ${lines.length} entries`);
