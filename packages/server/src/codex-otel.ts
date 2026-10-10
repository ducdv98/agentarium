import { SCHEMA_VERSION, type AgentRef, type NewEvent } from "@agentarium/core";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Only extracts the identifiers and outcomes needed for correlation. */
export function codexOtelOutcomes(body: unknown, resolve: (threadId: string) => AgentRef | undefined): NewEvent[] {
  const events: NewEvent[] = [];
  const resources = record(body)?.resourceLogs;
  if (!Array.isArray(resources)) return events;
  for (const resource of resources) {
    const scopes = record(resource)?.scopeLogs;
    if (!Array.isArray(scopes)) continue;
    for (const scope of scopes) {
      const logs = record(scope)?.logRecords;
      if (!Array.isArray(logs)) continue;
      for (const log of logs) {
        const attributes = record(log)?.attributes;
        if (!Array.isArray(attributes)) continue;
        const picked: Record<string, string> = {};
        for (const attr of attributes) {
          const entry = record(attr);
          const key = entry?.key;
          if (key !== "event.name" && key !== "conversation.id" && key !== "call_id" && key !== "success" && key !== "decision") continue;
          const value = record(entry?.value);
          const scalar = value?.stringValue ?? value?.intValue ?? value?.boolValue;
          if (typeof scalar === "string" || typeof scalar === "number" || typeof scalar === "boolean") picked[key] = String(scalar);
        }
        const failed = picked["event.name"] === "codex.tool_result" ? picked.success === "false" :
          picked["event.name"] === "codex.tool_decision" && !!picked.decision &&
          picked.decision !== "approved" && picked.decision !== "approved_for_session";
        if (!failed || !picked["conversation.id"] || !picked.call_id) continue;
        const agent = resolve(picked["conversation.id"]);
        if (agent) events.push({ schema_version: SCHEMA_VERSION, agent, kind: "tool_end", tool_use_id: picked.call_id, ok: false });
      }
    }
  }
  return events;
}
