// Measures the isometric Renderer at 200 agents against the targets in docs/research/rendering.md (phase-3-scene 10).
// Serves bench.html with Vite, drives installed Chrome through playwright-core, one fresh page per case:
//
//   node scripts/bench-isometric.mjs [--gpu default|low-power|swiftshader] [--cpu-throttle N] [--agents 200]
//                                    [--quick] [--out <dir for screenshots>]
//
// Main-thread busy time comes from CDP `Performance.getMetrics` (TaskDuration). Frame time is the time spent in
// each animation-frame callback, which is the Renderer's own loop: scene update, sync and WebGL submission.
// "Frame loop" and "applyState" are the shares of wall time spent in those; the rest of the main thread is the
// bench's own reducer and diff, which the daemon does in real use, plus the browser. "First frame / atlases" is the
// time from navigation to the Renderer's first frame and to the last atlas JSON, on Vite's dev server (unbundled).
// A run that logs a Renderer warning, draws nothing, lacks the art it asked for or has fewer live agents fails.
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const here = resolve(import.meta.dirname, "..");
const repo = resolve(here, "../..");
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const gpu = option("--gpu", "default");
const throttle = Number(option("--cpu-throttle", 1));
const agents = Number(option("--agents", 200));
const quick = args.includes("--quick");
const out = option("--out", null);
// bench.ts starts every agent within 9 s and ends them at 30 s.
const WARM_MS = 10000;
const MEASURE_MS = quick ? 4000 : 10000;
const GPU_FLAGS = {
  default: [],
  "low-power": ["--force_low_power_gpu"],
  swiftshader: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
};

const cases = [
  { name: "placeholders, load generator", params: { mode: "load", art: "0" } },
  { name: "office art, load generator", params: { mode: "load", art: "1" } },
  { name: "placeholders, all idle", params: { mode: "idle", art: "0" } },
  { name: "office art, all idle", params: { mode: "idle", art: "1" } },
];

const server = await createServer({
  root: here,
  logLevel: "error",
  server: { port: 0, strictPort: false, fs: { allow: [repo] } },
});
await server.listen();
const base = server.resolvedUrls.local[0];
const assets = `/@fs/${join(repo, "assets").replaceAll("\\", "/")}/`;

const browser = await chromium.launch({
  headless: false,
  channel: "chrome",
  args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--window-size=1300,820", ...GPU_FLAGS[gpu]],
});

const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0);
const median = (values) => percentile([...values].sort((a, b) => a - b), 0.5);
const taskSeconds = async (cdp) => (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "TaskDuration").value;

const rows = [];
try {
  for (const c of cases) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on("console", (msg) => msg.type() === "warning" || msg.type() === "error" ? console.log(`  [page] ${msg.text()}`) : undefined);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    if (throttle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
    const query = new URLSearchParams({ agents: String(agents), assets, ...c.params });
    await page.goto(`${base}bench.html?${query}`);
    await page.waitForTimeout(WARM_MS);
    const t0 = await page.evaluate(() => performance.now());
    const liveAtStart = await page.evaluate(() => window.__bench.agents());
    const busy0 = await taskSeconds(cdp);
    await page.waitForTimeout(MEASURE_MS);
    const busy1 = await taskSeconds(cdp);
    const result = await page.evaluate((from) => {
      const bench = window.__bench;
      const until = performance.now();
      return {
        elapsed: until - from,
        samples: bench.samples.filter((s) => s.at >= from),
        applyMs: bench.applyMs.filter((s) => s.at >= from).reduce((sum, s) => sum + s.ms, 0),
        agents: bench.agents(),
        markers: bench.markers(),
        failures: bench.failures,
        firstFrame: bench.firstFrame(),
        artLoaded: bench.artLoaded(),
      };
    }, t0);
    if (out) {
      await mkdir(out, { recursive: true });
      await page.screenshot({ path: join(out, `${c.params.art === "1" ? "art" : "placeholder"}-${c.params.mode}.png`) });
    }
    const rendered = result.samples.filter((s) => s.draws > 0);
    // Reject a run that did not measure the scene it claims to.
    const invalid = [
      ...result.failures,
      result.firstFrame === null ? "the Renderer drew no frame" : null,
      c.params.art === "1" && !result.artLoaded ? "the office atlases did not load" : null,
      Math.min(liveAtStart, result.agents) < agents ? `only ${Math.min(liveAtStart, result.agents)} of ${agents} agents were live` : null,
      (c.params.mode === "load" || c.params.art === "1") && !rendered.length ? "nothing rendered while agents animate" : null,
    ].filter(Boolean);
    if (invalid.length) throw new Error(`${c.name}: invalid run: ${invalid.join("; ")}`);
    const ms = rendered.map((s) => s.ms).sort((a, b) => a - b);
    rows.push({
      case: c.name,
      fps: ((rendered.length * 1000) / result.elapsed).toFixed(1),
      frame: `${percentile(ms, 0.5).toFixed(2)} / ${percentile(ms, 0.95).toFixed(2)}`,
      draws: rendered.length ? String(median(rendered.map((s) => s.draws))) : "-",
      main: `${(((busy1 - busy0) * 1000 * 100) / result.elapsed).toFixed(1)} %`,
      loop: `${((result.samples.reduce((sum, s) => sum + s.ms, 0) * 100) / result.elapsed).toFixed(1)} %`,
      apply: `${((result.applyMs * 100) / result.elapsed).toFixed(1)} %`,
      live: `${result.agents} (${result.markers} marked)`,
      start: `${Math.round(result.firstFrame)}${result.artLoaded ? ` / ${Math.round(result.artLoaded)}` : ""}`,
    });
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

console.log(`\nIsometric renderer, ${agents} agents, gpu ${gpu}, CPU throttle ${throttle}x\n`);
console.log("| Case | Rendered fps | Frame ms p50 / p95 | Draws per frame | Main thread | Frame loop | applyState | Live agents | First frame / atlases ms |");
console.log("|---|---:|---|---:|---:|---:|---:|---|---:|");
for (const r of rows) {
  console.log(`| ${r.case} | ${r.fps} | ${r.frame} | ${r.draws} | ${r.main} | ${r.loop} | ${r.apply} | ${r.live} | ${r.start} |`);
}
