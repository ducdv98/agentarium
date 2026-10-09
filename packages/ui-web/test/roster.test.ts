import { describe, expect, it } from "vitest";
import { reduce, replay, type AgentEvent, type AgentRef } from "@agentarium/core";
import { buildRoster, needsInputCount } from "../src/roster";

const ref = (agent: string, session = "sess-1234567890"): AgentRef => ({
  machine: "m",
  provider: "claude-code",
  session,
  agent,
});
const ev = (ts: number, kind: string, agent: AgentRef, extra: object = {}): AgentEvent =>
  ({ schema_version: 1, ts, kind, agent, ...extra }) as AgentEvent;

describe("buildRoster", () => {
  it("lists agents needing the user first and flags their ancestors", () => {
    const root = ref("root");
    const sub = ref("abcdef123456");
    const other = ref("root", "other-session-1");
    const world = replay([
      ev(1, "prompt", root),
      ev(2, "spawn", sub, { parent: root, provenance: "observed" }),
      ev(3, "prompt", other),
      ev(4, "needs_input", sub),
    ]);
    const rows = buildRoster(world);
    expect(needsInputCount(rows)).toBe(2); // sub and its lead
    expect(rows.slice(0, 2).every((r) => r.needsInput)).toBe(true);
    expect(rows[2]?.needsInput).toBe(false);
    const subRow = rows.find((r) => r.label.startsWith("sub-agent"))!;
    expect(subRow).toMatchObject({ status: "waiting", member: true, depth: 1 });
    expect(rows.find((r) => r.label === "session sess-123")).toMatchObject({ lead: true, depth: 0 });
  });

  it("omits lost agents", () => {
    let w = replay([ev(1, "prompt", ref("root"))]);
    w = reduce(w, { schema_version: 1, kind: "tick", ts: 1 + 700_000 });
    expect(buildRoster(w)).toEqual([]);
  });
});
