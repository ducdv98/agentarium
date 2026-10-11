import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = (home: string, ...args: string[]) => promisify(execFile)(process.execPath, [
  fileURLToPath(new URL("../dist/bin.js", import.meta.url)), ...args,
], { env: { ...process.env, AGENTARIUM_HOME: home }, windowsHide: true });

describe("glitches command", () => {
  it("prints recent fixture entries and respects --since", async () => {
    const home = mkdtempSync(join(tmpdir(), "agentarium-cli-glitches-"));
    const now = Date.now();
    writeFileSync(join(home, "glitches.jsonl"), [
      JSON.stringify({ ts: now - 10 * 60_000, kind: "late_session_start", room: "f:/repo", agent: "m:codex:12345678:root", provider: "codex", reason: "tool_start" }),
      JSON.stringify({ ts: now - 2 * 86_400_000, kind: "codex_live_dropped", room: "f:/repo", reason: "closed" }),
    ].join("\n") + "\n");
    const recent = await run(home, "glitches", "--since", "30m");
    expect(recent.stdout).toContain("tool_start");
    expect(recent.stdout).not.toContain("Codex live");
    const invalid = await run(home, "glitches", "--since", "soon").catch((error: unknown) => error) as unknown as { code: number; stderr: string };
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toContain("Invalid duration");
    const huge = await run(home, "glitches", "--since", "9".repeat(400) + "d").catch((error: unknown) => error) as unknown as { code: number };
    expect(huge.code).toBe(1);
  });
});
