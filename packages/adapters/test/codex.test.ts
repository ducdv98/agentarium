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
  it.each(["onreq-ro-accept", "onreq-ww-accept", "file-ro-accept", "mcp-elicit"])("keeps %s waiting until completion", (name) => {
    const hooks = fixture(name).hooks;
    const a = createCodexAdapter({ machine: "m1" });
    const evs = hooks.slice(0, hooks.findIndex((h) => h.hook_event_name === "PermissionRequest") + 1).flatMap((h) => a.map(h).events);
    expect(root(evs)?.status).toBe("waiting");
    expect(evs.filter((e) => e.kind === "tool_end" && e.ok === false)).toHaveLength(0);
  });
  it.each(["onreq-ro-decline", "onreq-ww-decline", "file-decline", "onreq-ro-cancel"])("closes %s as a failed prompt", (name) => {
    const evs = events(name);
    const ended = evs.find((e) => e.kind === "tool_end" && e.ok === false);
    expect(ended).toMatchObject({ tool_use_id: expect.any(String) });
    expect(root(evs)?.status).toBe("idle");
  });
  it.each(["onreq-ro-accept", "onreq-ww-accept", "never-sandbox-deny"])("keeps permission mode for %s", (name) => {
    expect(root(events(name))?.permissionMode).toBe(name === "never-sandbox-deny" ? "bypassPermissions" : "default");
  });
  it("does not expose automatic review as needs-input when rollout review says so", () => {
    const fx = fixture("auto-approve");
    const withReview = createCodexAdapter({ machine: "m1", reviewer: () => "auto_review" });
    expect(fx.hooks.flatMap((h) => withReview.map(h).events).some((e) => e.kind === "needs_input")).toBe(false);
    expect(events("auto-approve").some((e) => e.kind === "needs_input")).toBe(true);
  });
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
  it("ends restored children without looking up their lineage", () => {
    let lookups = 0;
    const adapter = createCodexAdapter({ machine: "m1", lineage: () => { lookups++; return null; } });
    adapter.restore({ machine: "m1", provider: "codex", session: "s", agent: "child" });
    expect(adapter.map({ session_id: "s", agent_id: "child", hook_event_name: "PreToolUse", tool_name: "Bash", tool_use_id: "t" }).events)
      .toEqual([expect.objectContaining({ kind: "tool_start" })]);
    expect(adapter.map({ session_id: "s", agent_id: "child", hook_event_name: "SubagentStop" }).events)
      .toEqual([expect.objectContaining({ kind: "stop" })]);
    expect(lookups).toBe(0);
    expect(adapter.map({ session_id: "s", hook_event_name: "SessionEnd" }).events)
      .toEqual([expect.objectContaining({ kind: "end", agent: expect.objectContaining({ agent: ROOT_AGENT }) }),
        expect.objectContaining({ kind: "end", agent: expect.objectContaining({ agent: "child" }) })]);
  });
  it("recovers a grandchild from its first mid-session hook and refines a stopped child", () => {
    const hooks = fixture("subagents").hooks;
    const first = hooks.find((h) => h.hook_event_name === "PreToolUse" && h.agent_id &&
      h.tool_name === "Bash")!;
    const child = hooks.find((h) => h.hook_event_name === "SubagentStart")!.agent_id as string;
    const grandchild = first.agent_id as string;
    const observed = createCodexAdapter({ machine: "m1", lineage: (id) =>
      id === grandchild ? { parentThreadId: child } : null });
    expect(observed.map(first).events).toEqual([
      expect.objectContaining({ kind: "spawn", provenance: "observed", parent: expect.objectContaining({ agent: child }) }),
      expect.objectContaining({ kind: "tool_start", agent: expect.objectContaining({ agent: grandchild }) }),
    ]);
    const noMetadata = createCodexAdapter({ machine: "m1", lineage: () => null });
    expect(noMetadata.map(first).events.map((e) => e.kind)).toEqual(["tool_start"]);
    const stop = hooks.find((h) => h.hook_event_name === "SubagentStop" && h.agent_id === child)!;
    const refining = createCodexAdapter({ machine: "m1", lineage: () => ({ parentThreadId: stop.session_id as string }) });
    refining.map(hooks.find((h) => h.hook_event_name === "SubagentStart" && h.agent_id === child)!);
    expect(refining.map(stop).events).toEqual([
      expect.objectContaining({ kind: "spawn", provenance: "observed", parent: expect.objectContaining({ agent: ROOT_AGENT }) }),
      expect.objectContaining({ kind: "stop" }),
    ]);
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

describe("Codex TUI presets (tui-permissions)", () => {
  it("follows the preset's permission mode, fails the Esc'd prompt at Interrupt and passes the approved one", () => {
    const a = createCodexAdapter({ machine: "m1" });
    const turns: { hooks: string[]; events: NewEvent[] }[] = [];
    for (const h of fixture("tui-permissions").hooks) {
      if (h.hook_event_name === "UserPromptSubmit") turns.push({ hooks: [], events: [] });
      const turn = turns.at(-1);
      const evs = a.map(h).events;
      if (turn) { turn.hooks.push(String(h.hook_event_name)); turn.events.push(...evs); }
    }
    const modes = turns.map((t) => t.events[0]?.permission_mode);
    expect(modes).toEqual(["default", "default", "bypassPermissions", "default", "default"]);
    const failed = (t: (typeof turns)[number]) => t.events.filter((e) => e.kind === "tool_end" && !e.ok);
    expect(turns[3]!.hooks).toContain("Interrupt");
    expect(failed(turns[3]!)).toHaveLength(1);
    expect(turns[4]!.hooks).toContain("PermissionRequest");
    expect(failed(turns[4]!)).toEqual([]);
    expect(turns.slice(0, 3).every((t) => !t.events.some((e) => e.kind === "needs_input"))).toBe(true);
  });
});

describe("Codex requests that wait on the user without a PermissionRequest hook", () => {
  it.each(["reqperm-accept", "reqperm-decline", "user-input"])("shows %s as waiting from the tool's start until its result, then no longer waiting", (name) => {
    const hooks = fixture(name).hooks;
    const a = createCodexAdapter({ machine: "m1" });
    const mapped = hooks.map((h) => ({ hook: String(h.hook_event_name), tool: h.tool_name, events: a.map(h).events }));
    const start = mapped.findIndex((h) => h.hook === "PreToolUse" && /^request_/.test(String(h.tool)));
    const end = mapped.findIndex((h, i) => i > start && h.hook === "PostToolUse");
    expect(root(mapped.slice(0, start + 1).flatMap((h) => h.events))?.status).toBe("waiting");
    expect(root(mapped.slice(0, end + 1).flatMap((h) => h.events))?.status).not.toBe("waiting");
  });

  it("records a declined permission request (nothing granted) as failed and a granted one as ok", () => {
    const outcome = (name: string) => events(name).filter((e) => e.kind === "tool_end").map((e) => e.kind === "tool_end" && e.ok);
    expect(outcome("reqperm-decline")).toEqual([false]);
    expect(outcome("reqperm-accept")).toEqual([true, true]);
  });

  it("leaves an automatic reviewer's permission request out of needs-input", () => {
    const a = createCodexAdapter({ machine: "m1", reviewer: () => "auto_review" });
    const evs = fixture("reqperm-accept").hooks.flatMap((h) => a.map(h).events);
    expect(evs.some((e) => e.kind === "needs_input")).toBe(false);
  });

  it("never shows a granular auto-rejection or a reviewer denial as waiting, and closes the denial as failed", () => {
    expect(events("granular-deny").some((e) => e.kind === "needs_input")).toBe(false);
    const a = createCodexAdapter({ machine: "m1", reviewer: () => "auto_review" });
    const evs = fixture("auto-reject").hooks.flatMap((h) => a.map(h).events);
    expect(evs.some((e) => e.kind === "needs_input")).toBe(false);
    expect(evs.filter((e) => e.kind === "tool_end" && !e.ok)).toHaveLength(1);
  });

  it("closes a cancel under workspace-write as failed at Interrupt", () => {
    expect(events("onreq-ww-cancel").filter((e) => e.kind === "tool_end" && !e.ok)).toHaveLength(1);
  });
});
