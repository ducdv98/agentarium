import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { agentKey, replay, type AgentEvent } from "@agentarium/core";
import { startDaemon, type Daemon } from "@agentarium/server";
import { generateScript, runLoad } from "../src";

describe("generateScript", () => {
  it("is deterministic per seed and time ordered", () => {
    const a = generateScript({ agents: 50, durationMs: 5_000, seed: 7 });
    expect(a).toEqual(generateScript({ agents: 50, durationMs: 5_000, seed: 7 }));
    expect(a).not.toEqual(generateScript({ agents: 50, durationMs: 5_000, seed: 8 }));
    expect(a.map((e) => e.atMs)).toEqual([...a.map((e) => e.atMs)].sort((x, y) => x - y));
  });

  it("defaults to about 200 agents", () => {
    const refs = new Set(generateScript().map((e) => agentKey(e.event.agent)));
    expect(refs.size).toBe(200);
  });

  it("is bursty: some 50 ms windows hold far more events than the average", () => {
    const script = generateScript({ agents: 200, durationMs: 10_000 });
    const buckets = new Map<number, number>();
    for (const e of script) buckets.set(Math.floor(e.atMs / 50), (buckets.get(Math.floor(e.atMs / 50)) ?? 0) + 1);
    const avg = script.length / (10_000 / 50);
    expect(Math.max(...buckets.values())).toBeGreaterThan(avg * 3);
  });

  it("produces a stream the reducer accepts end to end", () => {
    const script = generateScript({ agents: 30, durationMs: 3_000 });
    const events = script.map((s, i) => ({ ...s.event, ts: i + 1 }) as AgentEvent);
    expect(Object.keys(replay(events).agents)).toHaveLength(30);
  });
});

describe("runLoad against the daemon", () => {
  let daemon: Daemon | undefined;
  afterEach(async () => {
    await daemon?.close();
  });

  it("delivers every event and the daemon holds every agent", async () => {
    daemon = await startDaemon({ port: 0, dataDir: mkdtempSync(join(tmpdir(), "agentarium-load-")), tickMs: 0 });
    const script = generateScript({ agents: 200, durationMs: 4_000, seed: 3 });
    const report = await runLoad({ port: daemon.port, token: daemon.token, script, speed: 8 });
    expect(report.failed).toBe(0);
    expect(report.sent).toBe(script.length);
    expect(Object.keys(daemon.world("unassigned").agents)).toHaveLength(200);
  }, 30_000);
});
