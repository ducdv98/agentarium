import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT_AGENT, replay, type AgentEvent, type NewEvent } from "@agentarium/core";
import { categoryForCodexTool, createCodexAdapter } from "../src";

const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, "../../../spikes/fixtures/codex", `${name}.json`), "utf8")) as { hooks: Record<string, unknown>[] };
const events = (name: string): NewEvent[] => {
  const a = createCodexAdapter({ machine: "m1" });
  return fixture(name).hooks.flatMap((h) => a.map(h).events);
};
const state = (evs: NewEvent[]) => replay(evs.map((e, i) => ({ ...e, ts: i + 1 }) as AgentEvent));
const root = (evs: NewEvent[]) => Object.values(state(evs).agents).find((a) => a.ref.agent === ROOT_AGENT);

 describe("codex adapter fixtures", () => {
  it.each(["exec-fail", "long-exec"])("maps %s to exec and an idle then done agent", (name) => {
    const evs = events(name);
    expect(evs.map((e) => e.kind)).toEqual(["session_start", "prompt", "tool_start", "tool_end", "stop", "end"]);
    expect(evs.find((e) => e.kind === "tool_start")).toMatchObject({ category: "exec" });
    expect(root(evs.slice(0, -1))?.status).toBe("idle");
    expect(root(evs)?.status).toBe("done");
  });
  it("a completed turn is idle", () => expect(root(events("exec-fail").slice(0, -1))?.status).toBe("idle"));
  it("maps patches and clears a failed patch on Stop", () => {
    const ok = events("patch-ok");
    expect(ok.find((e) => e.kind === "tool_start")).toMatchObject({ category: "write", summary: "b.txt" });
    expect(ok.find((e) => e.kind === "tool_end")).toMatchObject({ ok: true });
    const fail = events("patch-fail");
    expect(fail.some((e) => e.kind === "tool_end")).toBe(false);
    expect(root(fail.slice(0, -1))?.status).toBe("idle");
  });
  it("maps MCP and web calls", () => {
    expect(events("mcp").filter((e) => e.kind === "tool_end")).toHaveLength(1);
    expect(events("mcp").find((e) => e.kind === "tool_end")).toMatchObject({ ok: true });
    expect(events("web").filter((e) => e.kind === "tool_start")).toEqual(expect.arrayContaining([expect.objectContaining({ category: "network" })]));
  });
  it("infers nested parents and ends all agents", () => {
    const evs = events("subagents");
    const spawns = evs.filter((e) => e.kind === "spawn");
    expect(spawns).toHaveLength(2);
    expect(spawns[0]).toMatchObject({ provenance: "inferred", parent: { agent: ROOT_AGENT } });
    expect(spawns[1]).toMatchObject({ provenance: "inferred", parent: { agent: spawns[0]!.agent.agent } });
    expect(evs.filter((e) => e.kind === "tool_start" && e.category === "delegate").length).toBeGreaterThan(2);
    expect(Object.values(state(evs).agents).map((a) => a.status)).toEqual(["done", "done", "done"]);
  });
  it("tracks approvals, cancellation and interruption", () => {
    const accept = events("approve-accept");
    const waitingAt = accept.findIndex((e) => e.kind === "needs_input");
    expect(root(accept.slice(0, waitingAt + 1))?.status).toBe("waiting");
    expect(root(accept.slice(0, waitingAt + 2))?.status).toBe("working");
    for (const name of ["approve-cancel", "interrupt"]) {
      const evs = events(name);
      expect(evs.at(-2)?.kind).toBe("stop");
      expect(root(evs.slice(0, -1))?.status).toBe("idle");
    }
  });
  it("ignores compaction and never includes content fields", () => {
    const a = createCodexAdapter({ machine: "m1" });
    expect(a.map({ session_id: "s", hook_event_name: "SessionStart", source: "compact" }).events).toEqual([]);
    expect(a.map({ session_id: "s", hook_event_name: "PreCompact" }).events).toEqual([]);
    const out = a.map({ session_id: "s", hook_event_name: "PreToolUse", tool_name: "apply_patch", tool_use_id: "t", tool_input: { command: "*** Add File: /a/b.txt\nSECRET-CONTENT" }, last_assistant_message: "SECRET-MESSAGE", tool_response: "SECRET-OUTPUT" });
    expect(JSON.stringify(out)).not.toMatch(/SECRET-(CONTENT|MESSAGE|OUTPUT)/);
    expect(categoryForCodexTool("view_image")).toBe("read");
  });
});
