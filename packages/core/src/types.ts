export const SCHEMA_VERSION = 1;

/** Closed set (ADR 0004). `think` and `wait` are derived by the reducer, not from tool names. */
export const ACTION_CATEGORIES = [
  "read",
  "write",
  "exec",
  "search",
  "network",
  "delegate",
  "think",
  "wait",
  "error",
] as const;
export type ActionCategory = (typeof ACTION_CATEGORIES)[number];

export const AGENT_STATES = ["working", "idle", "waiting", "blocked", "lost", "done"] as const;
export type AgentStatus = (typeof AGENT_STATES)[number];

/** Agent id used for the session's root agent (hook payloads without `agent_id`). */
export const ROOT_AGENT = "root";

/** Identity is machine : provider : session : agent from day 0 (ADR 0003). */
export interface AgentRef {
  machine: string;
  provider: string;
  session: string;
  agent: string;
}

export type Provenance = "observed" | "inferred" | "declared";

interface EventBase {
  schema_version: typeof SCHEMA_VERSION;
  /** Milliseconds since epoch, assigned by the ingesting daemon. */
  ts: number;
}

interface AgentEventBase extends EventBase {
  agent: AgentRef;
}

export type AgentEvent =
  | (AgentEventBase & { kind: "session_start" })
  | (AgentEventBase & { kind: "prompt" })
  | (AgentEventBase & {
      kind: "tool_start";
      tool_use_id: string;
      tool: string;
      category: ActionCategory;
      summary?: string;
    })
  | (AgentEventBase & { kind: "tool_end"; tool_use_id: string; ok: boolean })
  | (AgentEventBase & { kind: "needs_input"; summary?: string })
  /** `agent` is the child; the parent is created if not yet seen. */
  | (AgentEventBase & { kind: "spawn"; parent: AgentRef; provenance: Provenance })
  /** The agent finished its turn and awaits the next prompt. */
  | (AgentEventBase & { kind: "stop" })
  /** The agent is finished for good (session end or sub-agent stop). */
  | (AgentEventBase & { kind: "end" })
  /** Advances the clock so idle and lost timeouts replay deterministically. */
  | (EventBase & { kind: "tick" });

export interface PendingTool {
  tool: string;
  category: ActionCategory;
}

export interface AgentState {
  key: string;
  ref: AgentRef;
  /** Key of the spawning agent; null for a root agent. */
  parent: string | null;
  parentProvenance: Provenance | null;
  status: AgentStatus;
  category: ActionCategory | null;
  tool: string | null;
  summary: string | null;
  pending: Record<string, PendingTool>;
  firstTs: number;
  lastTs: number;
}

export interface WorldState {
  agents: Record<string, AgentState>;
  now: number;
}

export interface Timeouts {
  /** No events while working with no pending tool call. */
  idleMs: number;
  /** No events and no end observed. */
  lostMs: number;
  /** Like lostMs, for an agent waiting on the user: kept visible far longer, since it needs the user. */
  waitingLostMs: number;
}

export const DEFAULT_TIMEOUTS: Timeouts = { idleMs: 30_000, lostMs: 600_000, waitingLostMs: 7_200_000 };

export interface Relationship {
  type: "spawned_by";
  from: string;
  to: string;
  provenance: Provenance;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** What adapters emit: an agent event before the daemon stamps `ts` on it. */
export type NewEvent = DistributiveOmit<Exclude<AgentEvent, { kind: "tick" }>, "ts">;
