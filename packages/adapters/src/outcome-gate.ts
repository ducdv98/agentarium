import type { NewEvent } from "@agentarium/core";

/** De-duplicates Codex hook and live outcomes while preserving a later precise failure. */
export function createOutcomeGate(limit = 1000) {
  const ended = new Map<string, { hook: boolean; live: boolean }>();
  return (source: "hook" | "live", event: NewEvent): boolean => {
    if (event.kind !== "tool_end") return true;
    const key = `${event.agent.machine}\0${event.agent.session}\0${event.agent.agent}\0${event.tool_use_id}`;
    const prior = ended.get(key) ?? { hook: false, live: false };
    const keep = source === "hook" ? !prior.live : !prior.hook || !event.ok;
    ended.delete(key);
    ended.set(key, { ...prior, [source]: true });
    if (ended.size > limit) ended.delete(ended.keys().next().value!);
    return keep;
  };
}
