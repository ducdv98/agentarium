import type { ScriptedEvent } from "./generate";

export interface RunOptions {
  port: number;
  token: string;
  script: ScriptedEvent[];
  /** Playback speed: 2 plays the script twice as fast. */
  speed?: number;
  /** Max requests in flight. */
  concurrency?: number;
}

export interface RunReport {
  sent: number;
  failed: number;
  elapsedMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const percentile = (sorted: number[], p: number): number =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]! : 0;

/** Plays the script against a running daemon in (scaled) real time and reports latency. */
export async function runLoad(opts: RunOptions): Promise<RunReport> {
  const speed = opts.speed ?? 1;
  const limit = opts.concurrency ?? 64;
  const latencies: number[] = [];
  let failed = 0;
  let inFlight = 0;
  const waiting: (() => void)[] = [];
  const pending = new Set<Promise<void>>();
  const t0 = Date.now();

  const post = async (item: ScriptedEvent): Promise<void> => {
    const start = performance.now();
    try {
      const res = await fetch(`http://127.0.0.1:${opts.port}/events`, {
        method: "POST",
        headers: { authorization: `Bearer ${opts.token}`, "content-type": "application/json" },
        body: JSON.stringify({ ...(item.cwd ? { cwd: item.cwd } : {}), event: item.event }),
      });
      await res.arrayBuffer();
      if (res.status !== 202) failed++;
    } catch {
      failed++;
    }
    latencies.push(performance.now() - start);
  };

  for (const item of opts.script) {
    const wait = item.atMs / speed - (Date.now() - t0);
    if (wait > 1) await sleep(wait);
    if (inFlight >= limit) await new Promise<void>((r) => waiting.push(r));
    inFlight++;
    const p: Promise<void> = post(item).finally(() => {
      inFlight--;
      pending.delete(p);
      waiting.shift()?.();
    });
    pending.add(p);
  }
  await Promise.all(pending);

  latencies.sort((a, b) => a - b);
  return {
    sent: opts.script.length,
    failed,
    elapsedMs: Date.now() - t0,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    maxMs: latencies.at(-1) ?? 0,
  };
}
