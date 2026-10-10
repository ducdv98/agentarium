import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findCodexRollout, readCodexSessionMeta, readCodexApprovalsReviewer } from "../src/codex-rollouts";

const meta = (id: string, parent: string | null = null) => JSON.stringify({ type: "session_meta", payload: {
  id, session_id: "root", parent_thread_id: parent, cwd: "/repo", cli_version: "0.160.0", instructions: "x".repeat(200_000),
} }) + "\n" + "DO NOT READ THE REST".repeat(100_000);

describe("Codex rollout metadata", () => {
  it("reads the last turn reviewer from a bounded tail", () => {
    const path = join(mkdtempSync(join(tmpdir(), "codex-review-")), "rollout.jsonl");
    writeFileSync(path, [
      JSON.stringify({ type: "turn_context", payload: { approvals_reviewer: "user" } }),
      "x".repeat(300_000),
      JSON.stringify({ type: "turn_context", payload: { approvals_reviewer: "auto_review" } }),
    ].join("\n"));
    expect(readCodexApprovalsReviewer(path)).toBe("auto_review");
    expect(readCodexApprovalsReviewer(join(path, "missing"))).toBeNull();
  });
  it("reads only a bounded first line and searches newest dates before archives", () => {
    const home = mkdtempSync(join(tmpdir(), "codex-home-"));
    const older = join(home, "sessions/2026/10/09");
    const newer = join(home, "sessions/2026/10/10");
    mkdirSync(older, { recursive: true }); mkdirSync(newer, { recursive: true });
    writeFileSync(join(older, "rollout-older-child.jsonl"), meta("child", "old"));
    const path = join(newer, "rollout-newer-child.jsonl");
    writeFileSync(path, meta("child", "parent"));
    expect(readCodexSessionMeta(path)).toEqual({ threadId: "child", sessionId: "root", parentThreadId: "parent", cwd: "/repo", cliVersion: "0.160.0" });
    expect(findCodexRollout(home, "child")?.parentThreadId).toBe("parent");
    expect(readCodexSessionMeta(join(home, "missing"))).toBeNull();
    writeFileSync(join(newer, "rollout-bad-bad.jsonl"), "{broken\n");
    expect(findCodexRollout(home, "bad")).toBeNull();
  });
  it("searches archives even if sessions are missing and bounds dated searches", () => {
    const home = mkdtempSync(join(tmpdir(), "codex-home-"));
    const archived = join(home, "archived_sessions"); mkdirSync(archived);
    writeFileSync(join(archived, "rollout-archived-archive.jsonl"), meta("archive"));
    expect(findCodexRollout(home, "archive")?.threadId).toBe("archive");
    expect(findCodexRollout(home, "absent")).toBeNull();
    const dates = Array.from({ length: 15 }, (_, i) => String(i + 1).padStart(2, "0"));
    for (const day of dates) mkdirSync(join(home, "sessions/2026/10", day), { recursive: true });
    writeFileSync(join(home, "sessions/2026/10/01/rollout-old-old.jsonl"), meta("old"));
    expect(findCodexRollout(home, "old")).toBeNull();
  });
});
