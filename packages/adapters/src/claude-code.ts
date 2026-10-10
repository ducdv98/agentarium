import { createPermissionPrompts } from "./permission-prompts";
import { basename, categoryForMcpTool, clip, isObj, text } from "./shared";
import {
  ROOT_AGENT,
  SCHEMA_VERSION,
  type ActionCategory,
  type AgentRef,
  type NewEvent,
} from "@agentarium/core";

export interface AdapterOutput {
  /** Used by the daemon to pick the Room. */
  cwd?: string;
  events: NewEvent[];
}

export interface WaitingPrompt {
  session: string;
  agent: string;
  toolUseId: string;
  transcriptPath: string;
  cwd?: string;
}

export interface ClaudeCodeAdapter {
  /** Maps one hook payload to zero or more events. Never throws. */
  map(payload: unknown): AdapterOutput;
  /** Root-agent permission prompts still open, with the transcript that records their answer. */
  waitingPrompts(): WaitingPrompt[];
  /** The transcript shows the user rejected this prompt (TUI No or Esc fire no hook): a failed outcome, then idle. */
  reject(session: string, agent: string, toolUseId: string): AdapterOutput;
}

const PROVIDER = "claude-code";
const MAX_PENDING_AGENT_CALLS = 100;

const CATEGORY_BY_TOOL: Record<string, ActionCategory> = {
  Read: "read",
  NotebookRead: "read",
  Write: "write",
  Edit: "write",
  MultiEdit: "write",
  NotebookEdit: "write",
  Bash: "exec",
  PowerShell: "exec",
  Grep: "search",
  Glob: "search",
  ToolSearch: "search",
  WebFetch: "network",
  WebSearch: "network",
  Agent: "delegate",
};

const MCP_PREFIX = "mcp__";

/**
 * Maps a tool name to an action category. Built-in tools use a fixed table; MCP tools are classified
 * by the verb in their name. Other unknown tools default to `think`; the real name stays in `tool`.
 */
export const categoryForTool = (tool: string): ActionCategory => {
  const known = CATEGORY_BY_TOOL[tool];
  if (known) return known;
  return tool.startsWith(MCP_PREFIX) ? categoryForMcpTool(tool) : "think";
};

/** Reduces a tool call to a short label. Never includes file contents or full commands. */
function summarize(tool: string, input: unknown): string | undefined {
  if (!isObj(input)) return undefined;
  switch (categoryForTool(tool)) {
    case "read":
    case "write": {
      const path = text(input.file_path) ?? text(input.notebook_path) ?? text(input.path);
      return path ? clip(basename(path)) : undefined;
    }
    case "exec": {
      const s = text(input.description) ?? text(input.command);
      return s ? clip(s) : undefined;
    }
    case "search": {
      const s = text(input.pattern) ?? text(input.query);
      return s ? clip(s) : undefined;
    }
    case "network": {
      const url = text(input.url);
      if (url) {
        try {
          return clip(new URL(url).hostname);
        } catch {
          return undefined;
        }
      }
      const q = text(input.query);
      return q ? clip(q) : undefined;
    }
    case "delegate": {
      const s = text(input.description);
      return s ? clip(s) : undefined;
    }
    default:
      return undefined;
  }
}

export function createClaudeCodeAdapter(opts: { machine: string }): ClaudeCodeAdapter {
  /** Per session: callers of `Agent` whose SubagentStart has not been seen yet, oldest first. */
  const pendingAgentCalls = new Map<string, string[]>();
  const prompts = createPermissionPrompts();
  /** Keyed by tool_use_id; stale entries are pruned when listed. */
  const transcripts = new Map<string, WaitingPrompt>();

  const ref = (session: string, agent: string): AgentRef => ({
    machine: opts.machine,
    provider: PROVIDER,
    session,
    agent,
  });

  return {
    waitingPrompts() {
      for (const [id, w] of transcripts) if (!prompts.isPrompted(w.session, w.agent, id)) transcripts.delete(id);
      return [...transcripts.values()];
    },
    reject(session, agent, toolUseId) {
      const waiting = transcripts.get(toolUseId);
      transcripts.delete(toolUseId);
      if (!prompts.reject(session, agent, toolUseId)) return { events: [] };
      const base = { schema_version: SCHEMA_VERSION, agent: ref(session, agent) } as const;
      const events: NewEvent[] = [{ ...base, kind: "tool_end", tool_use_id: toolUseId, ok: false }, { ...base, kind: "stop" }];
      return waiting?.cwd ? { cwd: waiting.cwd, events } : { events };
    },
    map(payload) {
      if (!isObj(payload)) return { events: [] };
      const session = text(payload.session_id);
      const hook = text(payload.hook_event_name);
      if (!session || !hook) return { events: [] };

      const agentId = text(payload.agent_id) ?? ROOT_AGENT;
      const agent = ref(session, agentId);
      const mode = text(payload.permission_mode);
      const base = { schema_version: SCHEMA_VERSION, agent, ...(mode ? { permission_mode: mode } : {}) } as const;
      const cwd = text(payload.cwd);
      const out = (...events: NewEvent[]): AdapterOutput => (cwd ? { cwd, events } : { events });
      /** The turn is over: a prompted call that never finished was denied or aborted. */
      const closing = (...events: NewEvent[]): AdapterOutput => {
        const unfinished = prompts.close(session, agentId);
        for (const id of unfinished) transcripts.delete(id);
        return out(...unfinished.map((id): NewEvent => ({ ...base, kind: "tool_end", tool_use_id: id, ok: false })), ...events);
      };
      const toolName = text(payload.tool_name);
      const toolUseId = text(payload.tool_use_id);

      switch (hook) {
        case "SessionStart":
          return out({ ...base, kind: "session_start" });
        case "UserPromptSubmit":
          return closing({ ...base, kind: "prompt" });
        case "PreToolUse": {
          if (!toolName || !toolUseId) return out();
          prompts.started(session, agentId, toolUseId, toolName, payload.tool_input);
          if (toolName === "Agent") {
            const queue = pendingAgentCalls.get(session) ?? [];
            queue.push(agentId);
            if (queue.length > MAX_PENDING_AGENT_CALLS) queue.shift();
            pendingAgentCalls.set(session, queue);
          }
          const summary = summarize(toolName, payload.tool_input);
          return out({
            ...base,
            kind: "tool_start",
            tool_use_id: toolUseId,
            tool: toolName,
            category: categoryForTool(toolName),
            ...(summary ? { summary } : {}),
          });
        }
        case "PostToolUse":
        case "PostToolUseFailure": {
          if (!toolUseId) return out();
          prompts.ended(session, agentId, toolUseId);
          transcripts.delete(toolUseId);
          const events: NewEvent[] = [
            { ...base, kind: "tool_end", tool_use_id: toolUseId, ok: hook === "PostToolUse" },
          ];
          if (toolName === "Agent" && hook === "PostToolUse" && isObj(payload.tool_response)) {
            const child = text(payload.tool_response.agentId);
            if (child) {
              events.push({ ...base, kind: "spawn", agent: ref(session, child), parent: agent, provenance: "observed" });
            }
          }
          return out(...events);
        }
        case "PermissionRequest": {
          const prompted = prompts.prompted(session, agentId, toolName, payload.tool_input);
          const transcriptPath = text(payload.transcript_path);
          // A sub-agent's prompt closes at its SubagentStop; its payload names only the parent's transcript.
          if (prompted && transcriptPath && agentId === ROOT_AGENT) {
            transcripts.set(prompted, { session, agent: agentId, toolUseId: prompted, transcriptPath, ...(cwd ? { cwd } : {}) });
          }
          return out({ ...base, kind: "needs_input", ...(toolName ? { summary: clip(toolName) } : {}) });
        }
        case "Notification": {
          const type = text(payload.notification_type);
          if (type === "permission_prompt" || type === "elicitation_dialog") {
            return out({ ...base, kind: "needs_input" });
          }
          // idle_prompt: the agent is idle and does not need the user.
          return type === "idle_prompt" ? out({ ...base, kind: "stop" }) : out();
        }
        case "SubagentStart": {
          if (agentId === ROOT_AGENT) return out();
          const caller = pendingAgentCalls.get(session)?.shift() ?? ROOT_AGENT;
          return out({ ...base, kind: "spawn", parent: ref(session, caller), provenance: "inferred" });
        }
        case "SubagentStop":
          return agentId === ROOT_AGENT ? out() : closing({ ...base, kind: "end" });
        case "Stop":
          return closing({ ...base, kind: "stop" });
        case "SessionEnd": {
          pendingAgentCalls.delete(session);
          const result = closing({ ...base, agent: ref(session, ROOT_AGENT), kind: "end" });
          prompts.forgetSession(session);
          for (const [id, w] of transcripts) if (w.session === session) transcripts.delete(id);
          return result;
        }
        default:
          return out();
      }
    },
  };
}
