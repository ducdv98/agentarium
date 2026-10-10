import type { AgentState, WorldState } from "@agentarium/core";

export const agent = (key: string, over: Partial<AgentState> = {}): AgentState => ({
  key,
  ref: { machine: "m", provider: "p", session: "s", agent: key },
  parent: null,
  parentProvenance: null,
  status: "working",
  category: "exec",
  tool: null,
  summary: null,
  permissionMode: null,
  pending: {},
  firstTs: 0,
  lastTs: 0,
  ...over,
});

export const world = (...agents: AgentState[]): WorldState => ({
  agents: Object.fromEntries(agents.map((a) => [a.key, a])),
  now: 0,
});
