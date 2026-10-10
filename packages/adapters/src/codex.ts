import { ROOT_AGENT, SCHEMA_VERSION, type ActionCategory, type AgentRef, type NewEvent } from "@agentarium/core";
import type { AdapterOutput } from "./claude-code";
import { createPermissionPrompts } from "./permission-prompts";
import { basename, categoryForMcpTool, clip, isObj, text } from "./shared";

export const categoryForCodexTool = (tool: string): ActionCategory => {
  if (tool === "Bash") return "exec";
  if (tool === "apply_patch") return "write";
  if (tool === "webrun") return "network";
  if (tool.startsWith("collaboration")) return "delegate";
  if (tool.startsWith("mcp__")) return categoryForMcpTool(tool);
  if (tool === "view_image") return "read";
  return "think";
};

/** A request_permissions result grants nothing when every permission in it is null (declined or cancelled). */
function granted(response: string): boolean {
  try {
    const parsed: unknown = JSON.parse(response);
    return !isObj(parsed) || !isObj(parsed.permissions) || Object.values(parsed.permissions).some((v) => v !== null);
  } catch { return true; }
}

function summary(tool: string, input: unknown): string | undefined {
  if (!isObj(input)) return undefined;
  const command = text(input.command);
  if (tool === "Bash") return command ? clip(command) : undefined;
  if (tool === "apply_patch" && command) {
    const path = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/m.exec(command)?.[1];
    return path ? clip(basename(path)) : undefined;
  }
  if (tool === "webrun") {
    const q = Array.isArray(input.search_query) && isObj(input.search_query[0]) ? text(input.search_query[0].q) : undefined;
    if (q) return clip(q);
    const ref = Array.isArray(input.open) && isObj(input.open[0]) ? text(input.open[0].ref_id) : undefined;
    if (ref) { try { return clip(new URL(ref).hostname); } catch { /* a non-URL ref has no hostname */ } }
  }
  if (tool === "collaborationspawn_agent") return text(input.task_name) ? clip(text(input.task_name)!) : undefined;
  return undefined;
}

export function createCodexAdapter(opts: { machine: string; lineage?: (threadId: string, rolloutPath?: string) => { parentThreadId: string | null } | null; reviewer?: (rolloutPath: string) => string | null }): { map(payload: unknown): AdapterOutput; restore(agent: AgentRef): void } {
  const sessions = new Map<string, { callers: string[]; children: Set<string>; restored: Set<string> }>();
  const prompts = createPermissionPrompts();
  const ref = (session: string, agent: string): AgentRef => ({ machine: opts.machine, provider: "codex", session, agent });
  return {
    restore(agent) {
      if (agent.provider !== "codex" || agent.agent === ROOT_AGENT) return;
      let session = sessions.get(agent.session);
      if (!session) {
        session = { callers: [], children: new Set(), restored: new Set() };
        sessions.set(agent.session, session);
      }
      session.children.add(agent.agent);
      session.restored.add(agent.agent);
    },
    map(payload) {
      if (!isObj(payload)) return { events: [] };
      const session = text(payload.session_id);
      const hook = text(payload.hook_event_name);
      if (!session || !hook) return { events: [] };
      const agentId = text(payload.agent_id) ?? ROOT_AGENT;
      const mode = text(payload.permission_mode);
      const base = { schema_version: SCHEMA_VERSION, agent: ref(session, agentId), ...(mode ? { permission_mode: mode } : {}) } as const;
      const cwd = text(payload.cwd);
      const out = (...events: NewEvent[]): AdapterOutput => cwd ? { cwd, events } : { events };
      const closing = (...events: NewEvent[]): AdapterOutput => out(
        ...prompts.close(session, agentId).map((tool_use_id): NewEvent => ({ ...base, kind: "tool_end", tool_use_id, ok: false })), ...events);
      const tool = text(payload.tool_name);
      const id = text(payload.tool_use_id);
      const autoReviewed = () => { const path = text(payload.transcript_path); return !!path && opts.reviewer?.(path) === "auto_review"; };
      const state = () => {
        let s = sessions.get(session);
        if (!s) { s = { callers: [], children: new Set(), restored: new Set() }; sessions.set(session, s); }
        return s;
      };
      const prior = agentId !== ROOT_AGENT && state().children.has(agentId);
      const restored = agentId !== ROOT_AGENT && state().restored.has(agentId);
      const needsLineage = agentId !== ROOT_AGENT && ((hook === "SubagentStop" && !restored) || (!prior && hook !== "SubagentStart"));
      const lineage = needsLineage ? opts.lineage?.(agentId, text(payload.agent_transcript_path) ?? text(payload.transcript_path)) : null;
      const observed = lineage?.parentThreadId ? { ...base, kind: "spawn" as const,
        parent: ref(session, lineage.parentThreadId === session ? ROOT_AGENT : lineage.parentThreadId), provenance: "observed" as const } : undefined;
      const recovery = !prior && hook !== "SubagentStart" && observed ? [observed] : [];
      if (agentId !== ROOT_AGENT) state().children.add(agentId);
      function mapHook(hook: string, payload: Record<string, unknown>, session: string): AdapterOutput {
        switch (hook) {
          case "SessionStart":
            return payload.source === "compact" ? out() : out({ ...base, agent: ref(session, ROOT_AGENT), kind: "session_start" });
          case "UserPromptSubmit":
            return closing({ ...base, kind: "prompt" });
          case "PreToolUse": {
            if (!tool || !id) return out();
            prompts.started(session, agentId, id, tool, payload.tool_input);
            if (tool === "collaborationspawn_agent") {
              const callers = state().callers;
              callers.push(agentId);
              if (callers.length > 100) callers.shift();
            }
            const label = summary(tool, payload.tool_input);
            const start: NewEvent = { ...base, kind: "tool_start", tool_use_id: id, tool, category: categoryForCodexTool(tool), ...(label ? { summary: label } : {}) };
            // These tools wait on the user themselves; Codex fires no PermissionRequest hook for them.
            const asksUser = tool === "request_user_input" || (tool === "request_permissions" && !autoReviewed());
            return asksUser ? out(start, { ...base, kind: "needs_input", summary: clip(tool) }) : out(start);
          }
          case "PostToolUse": {
            if (!id) return out();
            prompts.ended(session, agentId, id);
            let ok = true;
            if (tool === "apply_patch" && typeof payload.tool_response === "string") {
              const exit = /^Exit code: (\d+)/.exec(payload.tool_response);
              if (exit) ok = Number(exit[1]) === 0;
            } else if (tool?.startsWith("mcp__") && isObj(payload.tool_response)) ok = payload.tool_response.isError !== true;
            else if (tool === "request_permissions" && typeof payload.tool_response === "string") ok = granted(payload.tool_response);
            // Bash hooks have no exit code; PostToolUse only establishes completion.
            return out({ ...base, kind: "tool_end", tool_use_id: id, ok });
          }
          case "PermissionRequest":
            prompts.prompted(session, agentId, tool, payload.tool_input);
            return autoReviewed() ? out() :
              out({ ...base, kind: "needs_input", ...(tool ? { summary: clip(tool) } : {}) });
          case "SubagentStart": {
            if (agentId === ROOT_AGENT) return out();
            const s = state();
            s.children.add(agentId);
            return out({ ...base, kind: "spawn", parent: ref(session, s.callers.shift() ?? ROOT_AGENT), provenance: "inferred" });
          }
          case "SubagentStop":
            return agentId === ROOT_AGENT ? out() : closing(...(observed ? [observed] : []), { ...base, kind: "stop" });
          case "Stop":
            return closing({ ...base, kind: "stop" });
          case "Interrupt":
            return closing({ ...base, agent: ref(session, ROOT_AGENT), kind: "stop" });
          case "SessionEnd": {
            const children = sessions.get(session)?.children ?? new Set<string>();
            const result = out(
              ...prompts.close(session, ROOT_AGENT).map((tool_use_id): NewEvent => ({ ...base, agent: ref(session, ROOT_AGENT), kind: "tool_end", tool_use_id, ok: false })),
              ...[...children].flatMap((child): NewEvent[] => prompts.close(session, child).map((tool_use_id) => ({ ...base, agent: ref(session, child), kind: "tool_end", tool_use_id, ok: false }))),
              { ...base, agent: ref(session, ROOT_AGENT), kind: "end" },
              ...[...children].map((child): NewEvent => ({ ...base, agent: ref(session, child), kind: "end" })),
            );
            sessions.delete(session);
            prompts.forgetSession(session);
            return result;
          }
          default:
            return out();
        }
      }
      const result = mapHook(hook, payload, session);
      return recovery.length ? { ...result, events: [...recovery, ...result.events.filter((event) => event.kind !== "spawn")] } : result;
    },
  };
}
