import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT_AGENT, needsInput, replay, type AgentEvent, type NewEvent } from "@agentarium/core";
import { categoryForTool, createClaudeCodeAdapter } from "../src";

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
    expect(cat("mcp__x__y")).toBe("exec");
  });

  it("maps MCP tools by the verb in their name, never to think", () => {
    const cat = (name: string) => categoryForTool(name);
    expect(cat("mcp__claude-in-chrome__navigate")).toBe("network");
    expect(cat("mcp__claude-in-chrome__read_page")).toBe("read");
    expect(cat("mcp__claude-in-chrome__get_page_text")).toBe("read");
    expect(cat("mcp__claude-in-chrome__find")).toBe("search");
    expect(cat("mcp__claude_ai_Gmail__search_threads")).toBe("search");
    expect(cat("mcp__claude_ai_Claude_Docs__create")).toBe("write");
    expect(cat("mcp__stitch__edit_screens")).toBe("write");
    expect(cat("mcp__stitch__delete_project")).toBe("write");
    expect(cat("mcp__stitch__fetch-page")).toBe("network");
    expect(cat("mcp__claude-in-chrome__computer")).toBe("exec");
    expect(cat("mcp__stitch__generate_screen_from_text")).toBe("exec");
    expect(cat("mcp__ide__executeCode")).toBe("exec");
  });

  it("keeps non-MCP unknown tools as think", () => {
    expect(categoryForTool("SomeFutureTool")).toBe("think");
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
    expect(kinds(adapter().map(fx("Notification.idle_prompt")).events)).toEqual(["stop"]);
  });

  it("ignores ConfigChange and CwdChanged", () => {
    expect(adapter().map(fx("ConfigChange")).events).toEqual([]);
    expect(adapter().map(fx("CwdChanged")).events).toEqual([]);
  });

  it("an AskUserQuestion makes the agent waiting until it is answered", () => {
    const a = adapter();
    const seq = [
      "UserPromptSubmit",
      "PreToolUse.AskUserQuestion",
      "PermissionRequest.AskUserQuestion",
      "Notification.permission_prompt",
      "PostToolUse.AskUserQuestion",
    ].flatMap((n) => a.map({ ...fx(n), session_id: "s" }).events);
    const evs = seq.map((e, i) => ({ ...e, ts: i + 1 }) as AgentEvent);
    expect(Object.values(replay(evs.slice(0, 4)).agents)[0]?.status).toBe("waiting");
    expect(Object.values(replay(evs).agents)[0]?.status).toBe("working");
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

describe("claude code permission modes (2.1.296 fixtures)", () => {
  const seq = (name: string): Record<string, unknown>[] =>
    (JSON.parse(readFileSync(join(__dirname, "../../../spikes/fixtures/claude-code/modes", `${name}.json`), "utf8")) as { hooks: Record<string, unknown>[] }).hooks;
  /** Events per hook, in order, from one adapter. */
  const mapAll = (name: string) => {
    const a = adapter();
    return seq(name).map((payload) => ({ hook: String(payload.hook_event_name), events: a.map(payload).events }));
  };
  const flat = (name: string) => mapAll(name).flatMap((h) => h.events);
  const asEvents = (evs: NewEvent[]) => evs.map((e, i) => ({ ...e, ts: i + 1 }) as AgentEvent);
  const failures = (evs: NewEvent[]) => evs.filter((e) => e.kind === "tool_end" && !e.ok);

  it("keeps the payload's permission mode on every event", () => {
    const evs = flat("plan").filter((e) => e.kind === "tool_start");
    expect(evs[0]).toMatchObject({ tool: "Write", permission_mode: "plan" });
    expect(evs.at(-1)).toMatchObject({ tool: "Bash", permission_mode: "default" });
    expect(Object.values(replay(asEvents(flat("dontask"))).agents)[0]?.permissionMode).toBe("dontAsk");
  });

  it.each(["auto", "auto-risky", "dontask", "bypass", "deny-rule"])("never shows %s as waiting", (name) => {
    expect(flat(name).some((e) => e.kind === "needs_input")).toBe(false);
  });

  it.each(["manual-allow", "acceptedits", "plan", "ask-rule", "manual-deny"])("shows a person-routed prompt in %s as waiting", (name) => {
    const hooks = mapAll(name);
    const upTo = hooks.findIndex((h) => h.hook === "PermissionRequest");
    const world = replay(asEvents(hooks.slice(0, upTo + 1).flatMap((h) => h.events)));
    expect(Object.values(world.agents)[0]?.status).toBe("waiting");
  });

  it.each(["manual-deny", "ask-rule"])("records a denial in %s as a failed outcome when the turn stops without it", (name) => {
    const hooks = mapAll(name);
    const stop = hooks.find((h) => h.hook === "Stop")!;
    const bashId = flat(name).find((e) => e.kind === "tool_start" && e.tool === "Bash");
    expect(kinds(stop.events)).toEqual(["tool_end", "stop"]);
    expect(stop.events[0]).toMatchObject({ ok: false, tool_use_id: bashId?.kind === "tool_start" ? bashId.tool_use_id : "" });
    const throughStop = hooks.slice(0, hooks.indexOf(stop) + 1).flatMap((h) => h.events);
    expect(Object.values(replay(asEvents(throughStop)).agents)[0]?.status).toBe("idle");
  });

  it.each(["manual-allow", "acceptedits", "plan", "auto", "bypass"])("records no failure when %s runs everything it asked for", (name) => {
    expect(failures(flat(name))).toEqual([]);
  });

  it("raises the flag on a sub-agent's prompt and through it on its lead, and records the sub-agent's denial", () => {
    const hooks = mapAll("subagent-deny");
    const upTo = hooks.findIndex((h) => h.hook === "PermissionRequest");
    const world = replay(asEvents(hooks.slice(0, upTo + 1).flatMap((h) => h.events)));
    const waiting = Object.values(world.agents).find((a) => a.status === "waiting");
    expect(waiting?.ref.agent).not.toBe(ROOT_AGENT);
    expect(needsInput(world, waiting!.parent!)).toBe(true);
    const stop = hooks.find((h) => h.hook === "SubagentStop")!;
    expect(kinds(stop.events)).toEqual(["tool_end", "end"]);
    expect(stop.events[0]).toMatchObject({ ok: false, agent: { agent: waiting!.ref.agent } });
  });

  it("keeps a prompt open across its permission_prompt notification and closes it on the tool's own result", () => {
    const a = adapter();
    const evs = ["UserPromptSubmit", "PreToolUse.Bash", "PermissionRequest.Bash", "Notification.permission_prompt", "PostToolUse.Bash", "Stop"]
      .flatMap((n) => a.map({ ...fx(n), session_id: "s" }).events);
    expect(failures(evs)).toEqual([]);
  });

  it("matches the prompt to its own call when calls run in parallel", () => {
    const a = adapter();
    const base = { session_id: "s", tool_name: "Read" };
    a.map({ ...base, hook_event_name: "PreToolUse", tool_use_id: "r1", tool_input: { file_path: "/a" } });
    a.map({ ...base, hook_event_name: "PreToolUse", tool_use_id: "r2", tool_input: { file_path: "/b" } });
    a.map({ ...base, hook_event_name: "PermissionRequest", tool_input: { file_path: "/a" } });
    a.map({ ...base, hook_event_name: "PostToolUse", tool_use_id: "r2" });
    const stop = a.map({ session_id: "s", hook_event_name: "Stop" }).events;
    expect(stop[0]).toMatchObject({ kind: "tool_end", tool_use_id: "r1", ok: false });
  });

  describe("interactive captures", () => {
    it.each(["tui-deny", "tui-esc", "tui-idle-prompt", "tui-ask-question", "tui-auto"])("shows the first prompt in %s as waiting", (name) => {
      const hooks = mapAll(name);
      const world = replay(asEvents(hooks.slice(0, hooks.findIndex((h) => h.hook === "PermissionRequest") + 1).flatMap((h) => h.events)));
      expect(Object.values(world.agents)[0]?.status).toBe("waiting");
    });

    it("records a TUI denial as failed only when the next prompt arrives, since no hook closes it", () => {
      const hooks = mapAll("tui-deny");
      const next = hooks.findIndex((h, i) => h.hook === "UserPromptSubmit" && i > hooks.findIndex((x) => x.hook === "PermissionRequest"));
      expect(hooks.slice(hooks.findIndex((h) => h.hook === "PermissionRequest") + 1, next).every((h) => h.events.every((e) => e.kind === "needs_input"))).toBe(true);
      expect(kinds(hooks[next]!.events)).toEqual(["tool_end", "prompt"]);
      expect(hooks[next]!.events[0]).toMatchObject({ ok: false });
    });

    it("closes a sub-agent's denied TUI prompt at SubagentStop", () => {
      const stop = mapAll("tui-subagent").find((h) => h.hook === "SubagentStop")!;
      expect(kinds(stop.events)).toEqual(["tool_end", "end"]);
      expect(stop.events[0]).toMatchObject({ ok: false });
    });

    it("records no failure for an answered question", () => {
      expect(failures(flat("tui-ask-question"))).toEqual([]);
    });
  });
});
