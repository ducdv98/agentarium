import { describe, expect, it } from "vitest";
import { codexOtelOutcomes } from "../src/codex-otel";

const ref = { machine: "m", provider: "codex", session: "root-thread", agent: "child-thread" };
const log = (name: string, outcome: string, call: string, conversation = "child-thread") => ({ attributes: [
  { key: "event.name", value: { stringValue: name } },
  { key: "conversation.id", value: { stringValue: conversation } },
  { key: "call_id", value: { stringValue: call } },
  { key: name === "codex.tool_result" ? "success" : "decision", value: { stringValue: outcome } },
  { key: "prompt", value: { stringValue: "PRIVATE" } },
] });

describe("Codex OTel outcomes", () => {
  it("keeps only failures and denied decisions for known conversations", () => {
    const body = { resourceLogs: [{ scopeLogs: [{ logRecords: [
      log("codex.tool_result", "true", "success"),
      log("codex.tool_result", "false", "failed"),
      log("codex.tool_decision", "approved_for_session", "approved"),
      log("codex.tool_decision", "abort", "aborted"),
      log("codex.tool_decision", "denied", "other", "unknown"),
      log("codex.user_prompt", "false", "ignored"),
    ] }] }] };
    const outcomes = codexOtelOutcomes(body, (thread) => thread === "child-thread" ? ref : undefined);
    expect(outcomes).toEqual([
      expect.objectContaining({ agent: ref, kind: "tool_end", tool_use_id: "failed", ok: false }),
      expect.objectContaining({ agent: ref, kind: "tool_end", tool_use_id: "aborted", ok: false }),
    ]);
    expect(JSON.stringify(outcomes)).not.toContain("PRIVATE");
  });
});
