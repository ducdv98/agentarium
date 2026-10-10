import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT_AGENT, replay, type AgentEvent, type NewEvent } from "@agentarium/core";
import { createCodexAdapter, createCodexLiveMapper, createOutcomeGate } from "../src";

type Entry = Record<string, unknown> & { at_ms: number; dir?: string; method?: string; hook_event_name?: string };
function fixture(name: string): { hooks: Entry[]; app: Entry[] } {
  return JSON.parse(readFileSync(join(__dirname, "../../../spikes/fixtures/codex", `${name}.json`), "utf8"));
}
function scenario(name: string) {
  const source = fixture(name);
  const hook = createCodexAdapter({ machine: "m" });
  const live = createCodexLiveMapper({ machine: "m" });
  const gate = createOutcomeGate();
  const events: AgentEvent[] = [];
  const checkpoints: Record<string, ReturnType<typeof replay>> = {};
  const timeline = [
    ...source.hooks.map((entry) => ({ entry, source: "hook" as const })),
    ...source.app.filter((entry) => entry.dir !== "reply").map((entry) => ({ entry, source: "live" as const })),
  ].sort((a, b) => a.entry.at_ms - b.entry.at_ms);
  for (const { entry, source: kind } of timeline) {
    const output = kind === "hook" ? hook.map(entry) : live.map(entry);
    for (const event of output.events) if (gate(kind, event)) events.push({ ...event, ts: entry.at_ms + 10_000 } as AgentEvent);
    if (kind === "live" && ["item/commandExecution/requestApproval", "serverRequest/resolved", "item/completed"].includes(entry.method ?? "")) {
      checkpoints[entry.method!] = replay(events);
    }
    if (kind === "hook" && ["Stop", "Interrupt"].includes(entry.hook_event_name ?? "")) checkpoints[entry.hook_event_name!] = replay(events);
  }
  const root = (state: ReturnType<typeof replay>) => Object.values(state.agents).find((a) => a.ref.agent === ROOT_AGENT);
  return { events, checkpoints, root };
}

describe("Codex live fixture replay", () => {
  it("accepts an approval, resumes the command, and ends idle", () => {
    const { checkpoints: s, root } = scenario("approve-accept");
    expect(root(s["item/commandExecution/requestApproval"]!)?.status).toBe("waiting");
    expect(root(s["serverRequest/resolved"]!)?.status).toBe("working");
    expect(root(s["serverRequest/resolved"]!)?.category).toBe("exec");
    expect(root(s["item/completed"]!)?.status).toBe("working");
    expect(root(s.Stop!)?.status).toBe("idle");
  });
  it("records a declined command as blocked until Stop", () => {
    const { checkpoints: s, root } = scenario("approve-decline");
    expect(root(s["item/commandExecution/requestApproval"]!)?.status).toBe("waiting");
    expect(root(s["item/completed"]!)?.status).toBe("blocked");
    expect(root(s["item/completed"]!)?.category).toBe("error");
    expect(root(s.Stop!)?.status).toBe("idle");
  });
  it.each(["approve-cancel", "interrupt"])("ends %s idle", (name) => {
    const { checkpoints: s, root } = scenario(name);
    expect(root(s.Interrupt!)?.status).toBe("idle");
  });
});

describe("Codex live mapping and outcomes", () => {
  const agent = { machine: "m", provider: "codex", session: "s", agent: ROOT_AGENT } as const;
  const end = (ok: boolean, id = "tool"): NewEvent => ({ schema_version: 1, agent, kind: "tool_end", tool_use_id: id, ok });
  it("lets precise failures supersede hook completion and bounds remembered IDs", () => {
    const gate = createOutcomeGate(2);
    expect(gate("hook", end(true))).toBe(true);
    expect(gate("live", end(true))).toBe(false);
    expect(gate("live", end(false))).toBe(true);
    expect(gate("hook", end(true, "other"))).toBe(true);
    expect(gate("live", end(true, "third"))).toBe(true);
    expect(gate("hook", end(true, "third"))).toBe(false);
    expect(gate("hook", end(true))).toBe(true);
  });
  it("reports unknown item outcomes without calling them successful", () => {
    const unknown: unknown[][] = [];
    const mapper = createCodexLiveMapper({ machine: "m", onUnknownOutcome: (...args) => unknown.push(args) });
    mapper.thread({ id: "s", sessionId: "s", cwd: "/repo" });
    const output = mapper.map({ method: "item/completed", params: { threadId: "s", item: { type: "commandExecution", id: "t", status: "cancelled", command: "secret" } } });
    expect(output.events).toEqual([]);
    expect(unknown).toEqual([["t", "cancelled"]]);
    expect(JSON.stringify(output)).not.toContain("secret");
  });
  it("maps supported tool kinds without forwarding output or prompts", () => {
    const mapper = createCodexLiveMapper({ machine: "m" });
    expect(mapper.map({ method: "item/started", params: { threadId: "missing", item: { type: "commandExecution", id: "x" } } }).events).toEqual([]);
    mapper.thread({ id: "s", sessionId: "s", cwd: "/repo" });
    const cases = [
      [{ type: "commandExecution", command: "/bin/bash -lc 'echo hello'" }, "Bash", "exec", "echo hello"],
      [{ type: "fileChange", changes: { "/repo/a.txt": {} } }, "apply_patch", "write", "a.txt"],
      [{ type: "mcpToolCall", server: "files", tool: "read_file" }, "mcp__files__read_file", "read", undefined],
      [{ type: "webSearch" }, "webrun", "network", undefined],
      [{ type: "collabAgentToolCall", tool: "spawn_agent" }, "collaborationspawn_agent", "delegate", undefined],
      [{ type: "imageView" }, "view_image", "read", undefined],
    ] as const;
    for (const [item, tool, category, summary] of cases) {
      const output = mapper.map({ method: "item/started", params: { threadId: "s", item: { ...item, id: tool, output: "PRIVATE" } } });
      expect(output.events[0]).toMatchObject({ kind: "tool_start", tool, category, ...(summary ? { summary } : {}) });
      expect(JSON.stringify(output)).not.toContain("PRIVATE");
    }
  });
});
