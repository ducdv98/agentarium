import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { agentKey, needsInput, relationships, replay, ROOT_AGENT, type ActionCategory, type AgentEvent } from "../src";
import { ref } from "./builders";

// Test-only stand-in for the Claude Code adapter (ticket 04): maps the real
// payload fixtures from ticket 01 onto Events with synthetic timestamps.
const dir = join(dirname(fileURLToPath(import.meta.url)), "../../../spikes/fixtures/claude-code");
const load = (name: string) => JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));

const SESSION = "fixture-session";
const CATEGORY: Record<string, ActionCategory> = {
  Read: "read",
  Write: "write",
  Edit: "write",
  Bash: "exec",
  Grep: "search",
  Glob: "search",
  ToolSearch: "search",
  WebFetch: "network",
  Agent: "delegate",
};
// Fixtures come from more than one capture, so their sub-agent ids differ.
// Pin every sub-agent payload to the SubagentStart fixture's id.
const SUB_ID: string = load("SubagentStart").agent_id;
const agentOf = (p: { agent_id?: string }) => ref(p.agent_id ? SUB_ID : ROOT_AGENT, SESSION);

function toEvents(name: string, ts: number): AgentEvent[] {
  const p = load(name);
  const base = { schema_version: 1 as const, ts, agent: agentOf(p) };
  switch (p.hook_event_name) {
    case "SessionStart":
      return [{ ...base, kind: "session_start" }];
    case "UserPromptSubmit":
      return [{ ...base, kind: "prompt" }];
    case "PreToolUse":
      return [
        {
          ...base,
          kind: "tool_start",
          tool_use_id: p.tool_use_id,
          tool: p.tool_name,
          category: CATEGORY[p.tool_name] ?? "think",
        },
      ];
    case "PostToolUse": {
      const out: AgentEvent[] = [{ ...base, kind: "tool_end", tool_use_id: p.tool_use_id, ok: true }];
      if (p.tool_name === "Agent") {
        out.push({
          ...base,
          kind: "spawn",
          agent: ref(SUB_ID, SESSION),
          parent: ref(ROOT_AGENT, SESSION),
          provenance: "observed",
        });
      }
      return out;
    }
    case "SubagentStart":
      return [{ ...base, kind: "spawn", parent: ref(ROOT_AGENT, SESSION), provenance: "inferred" }];
    case "SubagentStop":
    case "SessionEnd":
      return [{ ...base, kind: "end" }];
    case "PermissionRequest":
    case "Notification":
      return [{ ...base, kind: "needs_input" }];
    case "Stop":
      return [{ ...base, kind: "stop" }];
  }
  throw new Error(`unmapped fixture ${name}`);
}

const sequence = (names: string[]) => names.flatMap((n, i) => toEvents(n, (i + 1) * 1000));
const root = agentKey(ref(ROOT_AGENT, SESSION));
const subKey = () => agentKey(ref(SUB_ID, SESSION));

describe("replaying ticket 01 fixtures", () => {
  const lifecycle = [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse.Read",
    "PostToolUse.Read",
    "PreToolUse.Write",
    "PostToolUse.Write",
    "PreToolUse.Agent",
    "SubagentStart",
    "PreToolUse.Bash.in-subagent",
    "PostToolUse.Bash.in-subagent",
    "SubagentStop",
    "PostToolUse.Agent",
    "PreToolUse.Bash",
    "PostToolUse.Bash",
    "Stop",
    "SessionEnd",
  ];

  it("builds the sub-agent tree and upgrades the link from inferred to observed", () => {
    const w = replay(sequence(lifecycle));
    expect(Object.keys(w.agents).sort()).toEqual([root, subKey()].sort());
    expect(w.agents[subKey()]).toMatchObject({ parent: root, parentProvenance: "observed", status: "done" });
    expect(relationships(w)).toEqual([{ type: "spawned_by", from: subKey(), to: root, provenance: "observed" }]);
    expect(w.agents[root]?.status).toBe("done");
  });

  it("shows the sub-agent working with an inferred link mid-run", () => {
    const w = replay(sequence(lifecycle.slice(0, 10)));
    expect(w.agents[subKey()]).toMatchObject({ status: "working", parentProvenance: "inferred" });
    expect(w.agents[root]).toMatchObject({ status: "working", category: "delegate" });
  });

  it("raises needs-input on a permission request and clears it after the tool ends", () => {
    const upToRequest = ["SessionStart", "UserPromptSubmit", "PreToolUse.Bash", "PermissionRequest.Bash", "Notification.permission_prompt"];
    expect(needsInput(replay(sequence(upToRequest)), root)).toBe(true);
    expect(needsInput(replay(sequence([...upToRequest, "PostToolUse.Bash"])), root)).toBe(false);
  });

  it("is deterministic across replays", () => {
    const events = sequence(lifecycle);
    expect(replay(events)).toEqual(replay(events));
  });
});
