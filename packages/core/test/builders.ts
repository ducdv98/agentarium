import {
  ROOT_AGENT,
  SCHEMA_VERSION,
  type ActionCategory,
  type AgentEvent,
  type AgentRef,
  type Provenance,
} from "../src/types";

export const ref = (agent: string = ROOT_AGENT, session = "s1"): AgentRef => ({
  machine: "m1",
  provider: "claude-code",
  session,
  agent,
});

const base = (ts: number) => ({ schema_version: SCHEMA_VERSION, ts }) as const;

export const e = {
  sessionStart: (ts: number, agent = ref()): AgentEvent => ({ ...base(ts), kind: "session_start", agent }),
  prompt: (ts: number, agent = ref()): AgentEvent => ({ ...base(ts), kind: "prompt", agent }),
  toolStart: (
    ts: number,
    id: string,
    category: ActionCategory = "exec",
    agent = ref(),
    tool = "Bash",
  ): AgentEvent => ({ ...base(ts), kind: "tool_start", agent, tool_use_id: id, tool, category }),
  toolEnd: (ts: number, id: string, ok = true, agent = ref()): AgentEvent => ({
    ...base(ts),
    kind: "tool_end",
    agent,
    tool_use_id: id,
    ok,
  }),
  needsInput: (ts: number, agent = ref()): AgentEvent => ({ ...base(ts), kind: "needs_input", agent }),
  spawn: (ts: number, child: AgentRef, parent = ref(), provenance: Provenance = "inferred"): AgentEvent => ({
    ...base(ts),
    kind: "spawn",
    agent: child,
    parent,
    provenance,
  }),
  stop: (ts: number, agent = ref()): AgentEvent => ({ ...base(ts), kind: "stop", agent }),
  end: (ts: number, agent = ref()): AgentEvent => ({ ...base(ts), kind: "end", agent }),
  tick: (ts: number): AgentEvent => ({ ...base(ts), kind: "tick" }),
};
