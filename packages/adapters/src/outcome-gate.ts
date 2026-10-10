import type { NewEvent } from "@agentarium/core";

/** De-duplicates Codex hook, live and OTel outcomes while preserving a later failure. */
export function createOutcomeGate(limit = 1000) {
  const ended = new Map<string, { success: boolean; failure: boolean }>();
  return (_source: "hook" | "live" | "otel", event: NewEvent): boolean => {
    if (event.kind !== "tool_end") return true;
    const key = `${event.agent.machine}\0${event.agent.session}\0${event.agent.agent}\0${event.tool_use_id}`;
    const prior = ended.get(key) ?? { success: false, failure: false };
    const keep = event.ok ? !prior.success && !prior.failure : !prior.failure;
    ended.delete(key);
    ended.set(key, { success: prior.success || event.ok, failure: prior.failure || !event.ok });
    if (ended.size > limit) ended.delete(ended.keys().next().value!);
    return keep;
  };
}
