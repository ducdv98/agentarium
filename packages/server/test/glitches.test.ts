import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatGlitch, jsonlGlitchLog, memoryGlitchLog, readGlitchFile, type Glitch } from "../src";

const glitch = (ts: number, kind: Glitch["kind"] = "stale_client"): Glitch => ({
  ts, kind, room: "f:/opensource/agentarium", agent: "machine:codex:123456789:root", provider: "codex", durationMs: 12_000,
});

describe("glitch logs", () => {
  it("retains recent entries, trims by size, and skips torn lines", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agentarium-glitches-"));
    const file = join(dir, "glitches.jsonl");
    await writeFile(file, `${JSON.stringify(glitch(1))}\nnot finished\n${JSON.stringify(glitch(50))}\n`, "utf8");
    const log = jsonlGlitchLog(file, { clock: () => 100, retentionMs: 60, maxBytes: 1_000 });
    expect(await log.read(0)).toHaveLength(1);
    log.record(glitch(100));
    expect(await log.read(0)).toHaveLength(2);
    const small = jsonlGlitchLog(join(dir, "small.jsonl"), { maxBytes: 1, clock: () => 100 });
    small.record(glitch(100));
    expect(await small.read(0)).toEqual([]);
  });

  it("drops expired entries from a long-running log once a day", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agentarium-glitches-"));
    let now = 0;
    const day = 86_400_000;
    const log = jsonlGlitchLog(join(dir, "glitches.jsonl"), { clock: () => now, retentionMs: 14 * day });
    log.record(glitch(0));
    now = 15 * day;
    log.record(glitch(now));
    expect((await log.read(0)).map((entry) => entry.ts)).toEqual([now]);
  });

  it("skips lines with an unknown kind or wrongly typed fields", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agentarium-glitches-"));
    const file = join(dir, "glitches.jsonl");
    await writeFile(file, [
      JSON.stringify({ ts: 1, kind: "unknown" }),
      JSON.stringify({ ts: 2, kind: "stale_client", room: 42 }),
      JSON.stringify(glitch(3)),
    ].join("\n"), "utf8");
    expect((await readGlitchFile(file, 0)).map((entry) => entry.ts)).toEqual([3]);
  });

  it("reads a missing file as empty", async () => {
    const log = jsonlGlitchLog(join(await mkdtemp(join(tmpdir(), "agentarium-glitches-")), "missing.jsonl"));
    expect(await log.read(0)).toEqual([]);
  });
});

describe("formatGlitch", () => {
  const ts = new Date(2026, 9, 11, 14, 3).getTime();
  it.each([
    ["stale_client", undefined, "a client of agentarium was stale for 12s while an Agent needed the user"],
    ["lost_but_alive", undefined, "Agent codex:12345678 in agentarium was marked lost, then sent an event after 12s of silence"],
    ["late_session_start", "tool_start", "Agent codex:12345678 in agentarium first appeared with tool_start instead of session_start"],
    ["codex_live_dropped", "connection closed", "Codex live became unavailable (connection closed)"],
  ] as const)("formats %s as a usage-log bullet", (kind, reason, sentence) => {
    expect(formatGlitch({ ...glitch(ts, kind), ...(reason ? { reason } : {}) }))
      .toBe(`- 2026-10-11 14:03 Glitch: ${sentence}. What was true: ?. Hurt triage: ?`);
  });

  it("shows long durations in minutes or hours", () => {
    expect(formatGlitch({ ...glitch(ts), durationMs: 15 * 60_000 })).toContain("stale for 15m");
    expect(formatGlitch({ ...glitch(ts), durationMs: 3 * 3_600_000 })).toContain("stale for 3h");
  });
});

it("memory log copies entries", async () => {
  const log = memoryGlitchLog();
  log.record(glitch(1));
  expect(await log.read(1)).toEqual([glitch(1)]);
});
