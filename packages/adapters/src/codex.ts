import { ROOT_AGENT, SCHEMA_VERSION, type ActionCategory, type AgentRef, type NewEvent } from "@agentarium/core";
import type { AdapterOutput } from "./claude-code";
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

export function createCodexAdapter(opts: { machine: string }): { map(payload: unknown): AdapterOutput } {
  const sessions = new Map<string, { callers: string[]; children: Set<string> }>();
  const ref = (session: string, agent: string): AgentRef => ({ machine: opts.machine, provider: "codex", session, agent });
  return {
    map(payload) {
      if (!isObj(payload)) return { events: [] };
      const session = text(payload.session_id);
      const hook = text(payload.hook_event_name);
      if (!session || !hook) return { events: [] };
      const agentId = text(payload.agent_id) ?? ROOT_AGENT;
      const base = { schema_version: SCHEMA_VERSION, agent: ref(session, agentId) } as const;
      const cwd = text(payload.cwd);
      const out = (...events: NewEvent[]): AdapterOutput => cwd ? { cwd, events } : { events };
      const tool = text(payload.tool_name);
      const id = text(payload.tool_use_id);
      const state = () => {
        let s = sessions.get(session);
        if (!s) { s = { callers: [], children: new Set() }; sessions.set(session, s); }
        return s;
      };
      switch (hook) {
        case "SessionStart": return payload.source === "compact" ? out() : out({ ...base, agent: ref(session, ROOT_AGENT), kind: "session_start" });
        case "UserPromptSubmit": return out({ ...base, kind: "prompt" });
        case "PreToolUse": {
          if (!tool || !id) return out();
          if (tool === "collaborationspawn_agent") {
            const callers = state().callers;
            callers.push(agentId);
            if (callers.length > 100) callers.shift();
          }
          const label = summary(tool, payload.tool_input);
          return out({ ...base, kind: "tool_start", tool_use_id: id, tool, category: categoryForCodexTool(tool), ...(label ? { summary: label } : {}) });
        }
        case "PostToolUse": {
          if (!id) return out();
          let ok = true;
          if (tool === "apply_patch" && typeof payload.tool_response === "string") {
            const exit = /^Exit code: (\d+)/.exec(payload.tool_response);
            if (exit) ok = Number(exit[1]) === 0;
          } else if (tool?.startsWith("mcp__") && isObj(payload.tool_response)) ok = payload.tool_response.isError !== true;
          // Bash hooks have no exit code; PostToolUse only establishes completion.
          return out({ ...base, kind: "tool_end", tool_use_id: id, ok });
        }
        case "PermissionRequest": return out({ ...base, kind: "needs_input", ...(tool ? { summary: clip(tool) } : {}) });
        case "SubagentStart": {
          if (agentId === ROOT_AGENT) return out();
          const s = state();
          s.children.add(agentId);
          return out({ ...base, kind: "spawn", parent: ref(session, s.callers.shift() ?? ROOT_AGENT), provenance: "inferred" });
        }
        case "SubagentStop": return agentId === ROOT_AGENT ? out() : out({ ...base, kind: "stop" });
        case "Stop": return out({ ...base, kind: "stop" });
        case "Interrupt": return out({ ...base, agent: ref(session, ROOT_AGENT), kind: "stop" });
        case "SessionEnd": {
          const children = sessions.get(session)?.children ?? new Set<string>();
          sessions.delete(session);
          return out({ ...base, agent: ref(session, ROOT_AGENT), kind: "end" }, ...[...children].map((child): NewEvent => ({ ...base, agent: ref(session, child), kind: "end" })));
        }
        default: return out();
      }
    },
  };
}
