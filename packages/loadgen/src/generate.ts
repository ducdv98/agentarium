import { ROOT_AGENT, SCHEMA_VERSION, type ActionCategory, type AgentRef, type NewEvent } from "@agentarium/core";

export interface ScriptedEvent {
  /** Offset from the start of the run. */
  atMs: number;
  cwd?: string;
  event: NewEvent;
}

export interface GenerateOptions {
  /** Total agents including sub-agents. */
  agents?: number;
  durationMs?: number;
  seed?: number;
  /** Fraction of agents that are sub-agents of some root. */
  subAgentRatio?: number;
  /** Working directories to spread sessions across; none means the unassigned room. */
  cwds?: string[];
}

const TOOLS: { tool: string; category: ActionCategory }[] = [
  { tool: "Read", category: "read" },
  { tool: "Edit", category: "write" },
  { tool: "Bash", category: "exec" },
  { tool: "Grep", category: "search" },
  { tool: "WebFetch", category: "network" },
];

/** Small deterministic PRNG so a run can be reproduced from its seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds a bursty, time-ordered event script: agents start at random offsets and work in
 * cycles (prompt, a tight burst of tool calls, sometimes a permission wait, stop). A few
 * global burst moments pull many agents' cycles to the same instant.
 */
export function generateScript(opts: GenerateOptions = {}): ScriptedEvent[] {
  const agents = opts.agents ?? 200;
  const durationMs = opts.durationMs ?? 30_000;
  const rnd = mulberry32(opts.seed ?? 1);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const subCount = Math.floor(agents * (opts.subAgentRatio ?? 0.4));
  const rootCount = Math.max(1, agents - subCount);
  const bursts = [0.2, 0.5, 0.8].map((f) => f * durationMs);

  const out: ScriptedEvent[] = [];
  const emit = (atMs: number, event: NewEvent, cwd?: string): void => {
    out.push({ atMs: Math.max(0, Math.round(atMs)), event, ...(cwd ? { cwd } : {}) });
  };

  const roots: { ref: AgentRef; cwd?: string }[] = [];
  for (let i = 0; i < rootCount; i++) {
    const cwd = opts.cwds?.length ? pick(opts.cwds) : undefined;
    roots.push({ ref: { machine: "load", provider: "claude-code", session: `load-${i}`, agent: ROOT_AGENT }, ...(cwd ? { cwd } : {}) });
  }

  const base = { schema_version: SCHEMA_VERSION } as const;
  let toolSeq = 0;

  const work = (ref: AgentRef, cwd: string | undefined, startMs: number, endMs: number): void => {
    let t = startMs;
    while (t < endMs) {
      // Snap some cycles onto a global burst moment.
      if (rnd() < 0.3) t = pick(bursts) + rnd() * 50;
      if (t >= endMs) break;
      emit(t, { ...base, kind: "prompt", agent: ref }, cwd);
      const calls = 1 + Math.floor(rnd() * 6);
      t += 20 + rnd() * 100;
      for (let c = 0; c < calls; c++) {
        const { tool, category } = pick(TOOLS);
        const id = `lt-${toolSeq++}`;
        emit(t, { ...base, kind: "tool_start", agent: ref, tool_use_id: id, tool, category, summary: tool.toLowerCase() }, cwd);
        t += 5 + rnd() * 40;
        if (rnd() < 0.1) {
          emit(t, { ...base, kind: "needs_input", agent: ref }, cwd);
          t += 200 + rnd() * 800; // the user takes a while
        }
        emit(t, { ...base, kind: "tool_end", agent: ref, tool_use_id: id, ok: rnd() > 0.05 }, cwd);
        t += 5 + rnd() * 40;
      }
      emit(t, { ...base, kind: "stop", agent: ref }, cwd);
      t += 500 + rnd() * 3_000;
    }
  };

  for (const root of roots) {
    const start = rnd() * durationMs * 0.3;
    emit(start, { ...base, kind: "session_start", agent: root.ref }, root.cwd);
    work(root.ref, root.cwd, start + 10, durationMs);
    emit(durationMs, { ...base, kind: "end", agent: root.ref }, root.cwd);
  }
  for (let i = 0; i < subCount; i++) {
    const parent = pick(roots);
    const ref: AgentRef = { ...parent.ref, agent: `sub-${i}` };
    const start = rnd() * durationMs * 0.6;
    emit(start, { ...base, kind: "spawn", agent: ref, parent: parent.ref, provenance: "observed" }, parent.cwd);
    work(ref, parent.cwd, start + 10, Math.min(durationMs, start + 2_000 + rnd() * 5_000));
    emit(Math.min(durationMs, start + 8_000), { ...base, kind: "end", agent: ref }, parent.cwd);
  }

  return out.sort((a, b) => a.atMs - b.atMs);
}
