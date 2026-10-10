import { ACTION_CATEGORIES, SCHEMA_VERSION, type AgentRef, type NewEvent } from "@agentarium/core";

export interface IngestRequest {
  cwd?: string;
  /** The daemon assigns `ts` on receipt. */
  event: NewEvent;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;

function isRef(v: unknown): v is AgentRef {
  return isObj(v) && str(v.machine) && str(v.provider) && str(v.session) && str(v.agent);
}

const SIMPLE = new Set(["session_start", "prompt", "stop", "end"]);
const PROVENANCE = new Set(["observed", "inferred", "declared"]);

/** Returns the parsed request, or a message describing why the body is invalid. */
export function parseIngest(body: unknown): IngestRequest | string {
  if (!isObj(body) || !isObj(body.event)) return "body must be {cwd?, event}";
  if (body.cwd !== undefined && typeof body.cwd !== "string") return "cwd must be a string";
  const ev = body.event;
  if (ev.schema_version !== SCHEMA_VERSION) return `unsupported schema_version (want ${SCHEMA_VERSION})`;
  if (!isRef(ev.agent)) return "event.agent must be {machine, provider, session, agent}";
  const base = { schema_version: SCHEMA_VERSION, agent: ev.agent, ...(str(ev.permission_mode) ? { permission_mode: ev.permission_mode } : {}) } as const;
  const cwd = body.cwd;
  const ok = (event: IngestRequest["event"]): IngestRequest =>
    cwd === undefined ? { event } : { cwd, event };

  if (typeof ev.kind === "string" && SIMPLE.has(ev.kind)) {
    return ok({ ...base, kind: ev.kind as "session_start" | "prompt" | "stop" | "end" });
  }
  const summary = typeof ev.summary === "string" ? { summary: ev.summary } : {};
  switch (ev.kind) {
    case "tool_start":
      if (!str(ev.tool_use_id) || !str(ev.tool)) return "tool_start needs tool_use_id and tool";
      if (!(ACTION_CATEGORIES as readonly unknown[]).includes(ev.category)) {
        return "unknown action category";
      }
      return ok({
        ...base,
        kind: "tool_start",
        tool_use_id: ev.tool_use_id,
        tool: ev.tool,
        category: ev.category as (typeof ACTION_CATEGORIES)[number],
        ...summary,
      });
    case "tool_end":
      if (!str(ev.tool_use_id) || typeof ev.ok !== "boolean") {
        return "tool_end needs tool_use_id and ok";
      }
      return ok({ ...base, kind: "tool_end", tool_use_id: ev.tool_use_id, ok: ev.ok });
    case "needs_input":
      return ok({ ...base, kind: "needs_input", ...summary });
    case "spawn":
      if (!isRef(ev.parent) || typeof ev.provenance !== "string" || !PROVENANCE.has(ev.provenance)) {
        return "spawn needs parent and provenance";
      }
      return ok({
        ...base,
        kind: "spawn",
        parent: ev.parent,
        provenance: ev.provenance as "observed" | "inferred" | "declared",
      });
    default:
      return "unknown event kind";
  }
}
