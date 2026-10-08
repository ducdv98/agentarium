import { describe, expect, it } from "vitest";
import {
  agentKey,
  emptyWorld,
  isLead,
  isMember,
  needsInput,
  reduce,
  relationships,
  replay,
  visibleAgents,
  type AgentEvent,
} from "../src";
import { e, ref } from "./builders";

const run = (events: AgentEvent[]) => replay(events);
const root = agentKey(ref());
const sub = ref("a1");
const subKey = agentKey(sub);

describe("identity", () => {
  it("keys agents by machine:provider:session:agent", () => {
    expect(root).toBe("m1:claude-code:s1:root");
  });
});

describe("working and tools", () => {
  it("tracks the current tool and category, then thinks between tools", () => {
    let w = run([e.sessionStart(0), e.prompt(1), e.toolStart(2, "t1", "read")]);
    expect(w.agents[root]).toMatchObject({ status: "working", category: "read", tool: "Bash" });
    w = reduce(w, e.toolEnd(3, "t1"));
    expect(w.agents[root]).toMatchObject({ status: "working", category: "think", tool: null });
  });

  it("a failed tool blocks the agent with the error category until the next event", () => {
    let w = run([e.prompt(0), e.toolStart(1, "t1"), e.toolEnd(2, "t1", false)]);
    expect(w.agents[root]).toMatchObject({ status: "blocked", category: "error" });
    w = reduce(w, e.toolStart(3, "t2", "write"));
    expect(w.agents[root]).toMatchObject({ status: "working", category: "write" });
  });

  it("keeps the remaining pending tool's category when one of two parallel tools ends", () => {
    const w = run([e.prompt(0), e.toolStart(1, "t1", "read"), e.toolStart(2, "t2", "search"), e.toolEnd(3, "t2")]);
    expect(w.agents[root]).toMatchObject({ status: "working", category: "read" });
  });

  it("stop returns to idle with no category and clears pending tools", () => {
    const w = run([e.prompt(0), e.toolStart(1, "t1"), e.stop(2)]);
    expect(w.agents[root]).toMatchObject({ status: "idle", category: null, pending: {} });
  });

  it("end marks the agent done", () => {
    expect(run([e.prompt(0), e.end(1)]).agents[root]?.status).toBe("done");
  });
});

describe("needs-input", () => {
  it("a permission request makes the agent waiting; any later event from it clears that", () => {
    let w = run([e.prompt(0), e.toolStart(1, "t1"), e.needsInput(2)]);
    expect(w.agents[root]).toMatchObject({ status: "waiting", category: "wait" });
    expect(needsInput(w, root)).toBe(true);
    w = reduce(w, e.toolEnd(3, "t1"));
    expect(w.agents[root]?.status).toBe("working");
    expect(needsInput(w, root)).toBe(false);
  });

  it("duplicate signals (PermissionRequest plus Notification) are idempotent", () => {
    const w = run([e.prompt(0), e.needsInput(1), e.needsInput(2)]);
    expect(w.agents[root]?.status).toBe("waiting");
  });

  it("rolls up to every ancestor", () => {
    const grand = ref("a2");
    const w = run([e.prompt(0), e.spawn(1, sub), e.spawn(2, grand, sub), e.needsInput(3, grand)]);
    expect(needsInput(w, agentKey(grand))).toBe(true);
    expect(needsInput(w, subKey)).toBe(true);
    expect(needsInput(w, root)).toBe(true);
    expect(w.agents[root]?.status).not.toBe("waiting");
  });

  it("a done descendant no longer raises the flag", () => {
    const w = run([e.prompt(0), e.spawn(1, sub), e.needsInput(2, sub), e.end(3, sub)]);
    expect(needsInput(w, root)).toBe(false);
  });

  it("a waiting agent never goes idle", () => {
    const w = run([e.prompt(0), e.needsInput(1), e.tick(1 + 120_000)]);
    expect(w.agents[root]?.status).toBe("waiting");
  });
});

describe("sub-agents", () => {
  it("records parent, provenance, lead and member roles", () => {
    const w = run([e.prompt(0), e.spawn(1, sub, ref(), "inferred")]);
    expect(w.agents[subKey]).toMatchObject({ parent: root, parentProvenance: "inferred", status: "working" });
    expect(isLead(w, root)).toBe(true);
    expect(isMember(w, subKey)).toBe(true);
    expect(isMember(w, root)).toBe(false);
    expect(relationships(w)).toEqual([{ type: "spawned_by", from: subKey, to: root, provenance: "inferred" }]);
  });

  it("a later observed spawn upgrades the provenance without duplicating", () => {
    const w = run([e.prompt(0), e.spawn(1, sub), e.spawn(2, sub, ref(), "observed")]);
    expect(Object.keys(w.agents)).toHaveLength(2);
    expect(relationships(w)[0]?.provenance).toBe("observed");
  });

  it("a late observed spawn does not revive a sub-agent that already ended", () => {
    const w = run([e.prompt(0), e.spawn(1, sub), e.end(2, sub), e.spawn(3, sub, ref(), "observed")]);
    expect(w.agents[subKey]).toMatchObject({ status: "done", parentProvenance: "observed", lastTs: 2 });
  });

  it("is no longer a lead once all members are done", () => {
    const w = run([e.prompt(0), e.spawn(1, sub), e.end(2, sub)]);
    expect(isLead(w, root)).toBe(false);
  });

  it("ignores a spawn that would create a cycle", () => {
    const w = run([e.prompt(0), e.spawn(1, sub), e.spawn(2, ref(), sub)]);
    expect(w.agents[root]?.parent).toBeNull();
  });
});

describe("idle and lost timeouts", () => {
  it("goes idle after 30 s of silence while working", () => {
    let w = run([e.prompt(0), e.toolStart(1, "t1"), e.toolEnd(2, "t1")]);
    w = reduce(w, e.tick(2 + 29_999));
    expect(w.agents[root]?.status).toBe("working");
    w = reduce(w, e.tick(2 + 30_000));
    expect(w.agents[root]).toMatchObject({ status: "idle", category: null });
  });

  it("a pending tool call blocks idle", () => {
    const w = run([e.prompt(0), e.toolStart(1, "t1"), e.tick(1 + 300_000)]);
    expect(w.agents[root]?.status).toBe("working");
  });

  it("is lost after 10 min of silence, even with a pending tool or waiting", () => {
    const w = run([e.prompt(0), e.toolStart(1, "t1"), e.spawn(2, sub), e.needsInput(3, sub), e.tick(3 + 600_000)]);
    expect(w.agents[root]?.status).toBe("lost");
    expect(w.agents[subKey]?.status).toBe("lost");
    expect(visibleAgents(w)).toEqual([]);
    expect(needsInput(w, root)).toBe(false);
  });

  it("an idle agent that stopped is also lost without a session end", () => {
    const w = run([e.prompt(0), e.stop(1), e.tick(1 + 600_000)]);
    expect(w.agents[root]?.status).toBe("lost");
  });

  it("a done agent is never marked lost", () => {
    const w = run([e.prompt(0), e.end(1), e.tick(1 + 3_600_000)]);
    expect(w.agents[root]?.status).toBe("done");
  });

  it("a lost agent returns when it sends an event again", () => {
    let w = run([e.prompt(0), e.tick(600_000)]);
    expect(w.agents[root]?.status).toBe("lost");
    w = reduce(w, e.toolStart(600_001, "t9", "read"));
    expect(w.agents[root]).toMatchObject({ status: "working", category: "read" });
  });

  it("honours custom timeouts", () => {
    const w = replay([e.prompt(0), e.tick(5)], { idleMs: 5, lostMs: 50 });
    expect(w.agents[root]?.status).toBe("idle");
  });
});

describe("determinism", () => {
  it("does not mutate its input and replays identically", () => {
    const events = [e.prompt(0), e.toolStart(1, "t1"), e.spawn(2, sub), e.needsInput(3, sub), e.tick(40_000)];
    const a = replay(events);
    const snapshot = structuredClone(a);
    reduce(a, e.toolEnd(50_000, "t1"));
    expect(a).toEqual(snapshot);
    expect(replay(events)).toEqual(a);
    expect(emptyWorld()).toEqual({ agents: {}, now: 0 });
  });

  it("is JSON-serialisable (snapshot for the UI)", () => {
    const w = run([e.prompt(0), e.spawn(1, sub)]);
    expect(JSON.parse(JSON.stringify(w))).toEqual(w);
  });
});
