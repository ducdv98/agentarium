import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT_AGENT, replay, type AgentEvent, type NewEvent } from "@agentarium/core";
import { createClaudeCodeAdapter } from "../src";

const fx = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(__dirname, "../../../spikes/fixtures/claude-code", `${name}.json`), "utf8"));

const adapter = () => createClaudeCodeAdapter({ machine: "m1" });
const kinds = (evs: NewEvent[]) => evs.map((e) => e.kind);

describe("claude code adapter", () => {
  it("maps tool names to action categories", () => {
    const cat = (name: string) => {
      const out = adapter().map({ ...fx("PreToolUse.Read"), tool_name: name });
      const ev = out.events[0];
      return ev?.kind === "tool_start" ? ev.category : undefined;
    };
    expect(cat("Read")).toBe("read");
    expect(cat("Edit")).toBe("write");
    expect(cat("PowerShell")).toBe("exec");
    expect(cat("Glob")).toBe("search");
    expect(cat("WebSearch")).toBe("network");
    expect(cat("Agent")).toBe("delegate");
    expect(cat("mcp__x__y")).toBe("think");
  });

  it("maps PreToolUse for the root agent with cwd, ids and a short summary", () => {
    const out = adapter().map(fx("PreToolUse.Bash"));
    expect(out.cwd).toBe(fx("PreToolUse.Bash").cwd);
    expect(out.events).toHaveLength(1);
    const ev = out.events[0]!;
    expect(ev).toMatchObject({ kind: "tool_start", category: "exec", tool: "Bash" });
    expect(ev.agent).toEqual({
      machine: "m1",
      provider: "claude-code",
      session: fx("PreToolUse.Bash").session_id,
      agent: ROOT_AGENT,
    });
    const summary = (ev as { summary?: string }).summary ?? "";
    expect(summary.length).toBeLessThanOrEqual(80);
  });

  it("never forwards content-bearing fields", () => {
    const stop = adapter().map({ ...fx("Stop"), last_assistant_message: "SECRET-TEXT" });
    expect(JSON.stringify(stop)).not.toContain("SECRET-TEXT");
    const write = adapter().map({ ...fx("PreToolUse.Write"), tool_input: { file_path: "/a/b/c.txt", content: "SECRET-BODY" } });
    expect(JSON.stringify(write)).not.toContain("SECRET-BODY");
    expect((write.events[0] as { summary?: string }).summary).toBe("c.txt");
  });

  it("uses agent_id for tool calls inside a sub-agent", () => {
    const ev = adapter().map(fx("PreToolUse.Bash.in-subagent")).events[0]!;
    expect(ev.agent.agent).toBe(fx("PreToolUse.Bash.in-subagent").agent_id);
  });

  it("maps PostToolUse and failures to tool_end", () => {
    expect(adapter().map(fx("PostToolUse.Bash")).events[0]).toMatchObject({ kind: "tool_end", ok: true });
    expect(adapter().map({ ...fx("PostToolUse.Bash"), hook_event_name: "PostToolUseFailure" }).events[0]).toMatchObject({
      kind: "tool_end",
      ok: false,
    });
  });

  it("maps lifecycle events", () => {
    expect(kinds(adapter().map(fx("UserPromptSubmit")).events)).toEqual(["prompt"]);
    expect(kinds(adapter().map(fx("Stop")).events)).toEqual(["stop"]);
    expect(kinds(adapter().map(fx("SessionStart")).events)).toEqual(["session_start"]);
    const end = adapter().map(fx("SessionEnd")).events[0]!;
    expect(end).toMatchObject({ kind: "end" });
    expect(end.agent.agent).toBe(ROOT_AGENT);
  });

  it("raises needs_input for permission requests and permission/elicitation notifications, not idle_prompt", () => {
    expect(kinds(adapter().map(fx("PermissionRequest.Bash")).events)).toEqual(["needs_input"]);
    expect(kinds(adapter().map(fx("Notification.permission_prompt")).events)).toEqual(["needs_input"]);
    expect(kinds(adapter().map({ ...fx("Notification.permission_prompt"), notification_type: "elicitation_dialog" }).events)).toEqual(["needs_input"]);
    expect(kinds(adapter().map({ ...fx("Notification.permission_prompt"), notification_type: "idle_prompt" }).events)).toEqual(["stop"]);
  });

  it("infers sub-agent parent at SubagentStart and observes it at Agent PostToolUse", () => {
    const a = adapter();
    a.map(fx("PreToolUse.Agent"));
    const start = a.map(fx("SubagentStart")).events[0]!;
    expect(start).toMatchObject({ kind: "spawn", provenance: "inferred" });
    if (start.kind !== "spawn") throw new Error();
    expect(start.agent.agent).toBe(fx("SubagentStart").agent_id);
    expect(start.parent.agent).toBe(ROOT_AGENT);

    const post = a.map(fx("PostToolUse.Agent")).events;
    expect(kinds(post)).toEqual(["tool_end", "spawn"]);
    expect(post[1]).toMatchObject({ kind: "spawn", provenance: "observed" });
    expect(kinds(a.map(fx("SubagentStop")).events)).toEqual(["end"]);
  });

  it("falls back to the root agent as parent when no Agent call was seen", () => {
    const start = adapter().map(fx("SubagentStart")).events[0]!;
    expect(start).toMatchObject({ kind: "spawn", provenance: "inferred" });
  });

  it("ignores unknown and malformed payloads", () => {
    expect(adapter().map({ hook_event_name: "Whatever", session_id: "s" }).events).toEqual([]);
    expect(adapter().map(null).events).toEqual([]);
    expect(adapter().map({ hook_event_name: "Stop" }).events).toEqual([]);
  });

  it("drives the reducer to the expected states", () => {
    const a = adapter();
    const seq = ["UserPromptSubmit", "PreToolUse.Bash", "PermissionRequest.Bash", "PostToolUse.Bash"].flatMap(
      (n) => a.map({ ...fx(n), session_id: "s" }).events,
    );
    const evs = seq.map((e, i) => ({ ...e, ts: i + 1 }) as AgentEvent);
    expect(Object.values(replay(evs.slice(0, 3)).agents)[0]?.status).toBe("waiting");
    expect(Object.values(replay(evs).agents)[0]?.status).toBe("working");
  });
});
