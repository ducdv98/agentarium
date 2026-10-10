import { ROOT_AGENT, SCHEMA_VERSION, type AgentRef, type NewEvent } from "@agentarium/core";
import type { AdapterOutput } from "./claude-code";
import { categoryForCodexTool } from "./codex";
import { basename, clip, isObj, text } from "./shared";

type ToolStart = Extract<NewEvent, { kind: "tool_start" }>;
const requestSummary: Record<string, string> = {
  "item/commandExecution/requestApproval": "command approval",
  "item/fileChange/requestApproval": "file change approval",
  "item/permissions/requestApproval": "permissions approval",
  "item/tool/requestUserInput": "tool input",
  "mcpServer/elicitation/request": "MCP input",
  execCommandApproval: "command approval",
  applyPatchApproval: "file change approval",
};

function toolStart(item: Record<string, unknown>, agent: AgentRef): ToolStart | undefined {
  const id = text(item.id);
  const type = text(item.type);
  if (!id || !type) return undefined;
  let tool: string;
  let summary: string | undefined;
  switch (type) {
    case "commandExecution": {
      tool = "Bash";
      const command = text(item.command);
      summary = command ? clip(command.replace(/^(?:\/bin\/)?bash -lc '([\s\S]*)'$/, "$1")) : undefined;
      break;
    }
    case "fileChange": {
      tool = "apply_patch";
      const changes = isObj(item.changes) ? Object.keys(item.changes) : [];
      summary = changes[0] ? clip(basename(changes[0])) : undefined;
      break;
    }
    case "mcpToolCall": tool = `mcp__${text(item.server) ?? "unknown"}__${text(item.tool) ?? "unknown"}`; break;
    case "webSearch": tool = "webrun"; break;
    case "collabAgentToolCall": tool = `collaboration${text(item.tool) ?? "unknown"}`; break;
    case "imageView": tool = "view_image"; break;
    default: return undefined;
  }
  return { schema_version: SCHEMA_VERSION, agent, kind: "tool_start", tool_use_id: id, tool,
    category: categoryForCodexTool(tool), ...(summary ? { summary } : {}) };
}

export function createCodexLiveMapper(opts: { machine: string; onThread?: (threadId: string, agent: AgentRef, cwd?: string) => void; onUnknownOutcome?: (itemId: string, status: unknown) => void }) {
  const threads = new Map<string, { agent: AgentRef; cwd?: string }>();
  const open = new Map<string, ToolStart>();
  const startedIn = new Map<string, string>();
  const requests = new Map<string, { threadId: string; itemId?: string }>();
  const empty = (): AdapterOutput => ({ events: [] });
  const requestKey = (id: unknown) => typeof id === "string" || typeof id === "number" ? String(id) : undefined;
  function thread(value: unknown): AdapterOutput {
    if (!isObj(value)) return empty();
    const id = text(value.id);
    const session = text(value.sessionId);
    if (!id || !session) return empty();
    for (const [itemId, threadId] of startedIn) if (threadId === id) { startedIn.delete(itemId); open.delete(itemId); }
    const environment = Array.isArray(value.environments) ? value.environments[0] : undefined;
    const cwd = text(value.cwd) ?? (isObj(environment) ? text(environment.cwd) : undefined);
    const agent: AgentRef = { machine: opts.machine, provider: "codex", session,
      agent: id === session ? ROOT_AGENT : id };
    threads.set(id, { agent, cwd });
    opts.onThread?.(id, agent, cwd);
    const events: NewEvent[] = [];
    const parent = text(value.parentThreadId);
    if (parent) events.push({ schema_version: SCHEMA_VERSION, agent, kind: "spawn", provenance: "observed",
      parent: { ...agent, agent: parent === session ? ROOT_AGENT : parent } });
    if (isObj(value.status) && value.status.type === "idle") events.push({ schema_version: SCHEMA_VERSION, agent, kind: "stop" });
    return cwd ? { cwd, events } : { events };
  }
  return {
    thread,
    map(message: unknown): AdapterOutput {
      if (!isObj(message)) return empty();
      const method = text(message.method);
      const params = isObj(message.params) ? message.params : {};
      if (method === "thread/started") return thread(params.thread);
      const threadId = text(params.threadId);
      if (!threadId) return empty();
      const known = threads.get(threadId);
      if (!known) return empty();
      const out = (...events: NewEvent[]): AdapterOutput => known.cwd ? { cwd: known.cwd, events } : { events };
      if (method && Object.hasOwn(requestSummary, method) && requestKey(message.id) !== undefined) {
        requests.set(requestKey(message.id)!, { threadId, itemId: text(params.itemId) });
        return out({ schema_version: SCHEMA_VERSION, agent: known.agent, kind: "needs_input", summary: requestSummary[method] });
      }
      if (method === "serverRequest/resolved") {
        const key = requestKey(params.requestId);
        const request = key === undefined ? undefined : requests.get(key);
        if (key !== undefined) requests.delete(key);
        const start = request?.threadId === threadId && request.itemId ? open.get(request.itemId) : undefined;
        return start ? out(start) : out();
      }
      if (method === "item/started" && isObj(params.item)) {
        const start = toolStart(params.item, known.agent);
        if (start) { open.set(start.tool_use_id, start); startedIn.set(start.tool_use_id, threadId); return out(start); }
      }
      if (method === "item/completed" && isObj(params.item)) {
        const id = text(params.item.id);
        if (!id || startedIn.get(id) !== threadId || !toolStart(params.item, known.agent)) return out();
        open.delete(id);
        startedIn.delete(id);
        const status = params.item.status;
        if (status !== "completed" && status !== "failed" && status !== "declined") {
          try { opts.onUnknownOutcome?.(id, status); } catch { /* Mapping never fails because diagnostics failed. */ }
          return out();
        }
        return out({ schema_version: SCHEMA_VERSION, agent: known.agent, kind: "tool_end", tool_use_id: id, ok: status === "completed" });
      }
      if (method === "turn/completed") return out({ schema_version: SCHEMA_VERSION, agent: known.agent, kind: "stop" });
      return out();
    },
  };
}
