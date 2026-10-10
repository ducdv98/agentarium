import { basename, dirname } from "node:path";
import { readTailLines } from "./tail";

const SESSION_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/;
const REJECTED = "User rejected tool use";

/**
 * Ids among `ids` whose permission prompt the user rejected (No or Esc in the TUI fires no hook).
 * The path arrives in a hook payload: only `<config>/projects/<slug>/<session>.jsonl` is read, only a bounded tail, and
 * only tool_result ids and the rejection marker are inspected.
 */
export function readClaudeRejections(path: string, ids: readonly string[]): string[] {
  if (!SESSION_FILE.test(basename(path)) || basename(dirname(dirname(path))) !== "projects") return [];
  const wanted = new Set(ids);
  const found = new Set<string>();
  for (const line of readTailLines(path)) {
    let entry: { type?: unknown; toolUseResult?: unknown; message?: { content?: unknown } };
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.type !== "user" || entry.toolUseResult !== REJECTED || !Array.isArray(entry.message?.content)) continue;
    for (const item of entry.message.content as { type?: unknown; tool_use_id?: unknown; is_error?: unknown }[]) {
      if (item?.type === "tool_result" && item.is_error === true && typeof item.tool_use_id === "string" && wanted.has(item.tool_use_id)) found.add(item.tool_use_id);
    }
  }
  return ids.filter((id) => found.has(id));
}
