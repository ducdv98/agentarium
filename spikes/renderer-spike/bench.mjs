// Bench for the renderer spike (phase-3-scene 03). Drives installed Chrome through playwright-core, one fresh page per
// case, and writes results/<label>/results.json and summary.md.
//
//   node bench.mjs [--gpu default|low-power|high-performance|swiftshader] [--cpu-throttle N] [--label name]
//                  [--quick] [--cases substring,substring] [--executable path/to/chrome] [--port 5174]
import { chromium } from "playwright-core";
import { PNG } from "pngjs";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const gpu = opt("--gpu", "default");
const throttle = Number(opt("--cpu-throttle", 1));
const quick = args.includes("--quick");
const label = opt("--label", `${os.hostname().toLowerCase()}-${gpu}-cpu${throttle}x`);
const only = opt("--cases", null)?.split(",");
const WARM = quick ? 1500 : 5000, MEASURE = quick ? 2000 : 10000, PORT = Number(opt("--port", 5174));
const out = path.join(here, "results", label);
const log = (...a) => console.log(`[bench]`, ...a);

const GPU_FLAGS = {
  default: [],
  "low-power": ["--force_low_power_gpu"],
  "high-performance": ["--force_high_performance_gpu"],
  swiftshader: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
};

// ------------------------------------------------------------------------------------------------- cases
const cases = [];
const add = (name, params, kind = "run") => cases.push({ name, params, kind });
// Batching: characters only (no desks), then the full scene with banded desk caches.
for (const renderer of ["pixi", "canvas"]) {
  for (const mode of ["plain", "tint", "mask", ...(renderer === "pixi" ? ["filter"] : [])]) {
    add(`${renderer} ${mode} 200 no-desks`, { renderer, mode, count: 200, props: 0 });
  }
  add(`${renderer} mask 200`, { renderer, mode: "mask", count: 200 });
  add(`${renderer} mask 5`, { renderer, mode: "mask", count: 5 });
  add(`${renderer} mask 200 30fps`, { renderer, mode: "mask", count: 200, fps: 30 });
  add(`${renderer} mask 200 idle`, { renderer, mode: "mask", count: 200 }, "idle");
  if (renderer === "pixi") add(`pixi mask 200 idle + Ticker.system stopped`, { renderer, mode: "mask", count: 200 }, "idle-all");
}
add("pixi mask 200 desks as Graphics", { renderer: "pixi", mode: "mask", count: 200, cache: "none" });
const selected = only ? cases.filter((c) => only.some((s) => c.name.includes(s))) : cases;

// ------------------------------------------------------------------------------------------------- helpers
const server = spawn(process.execPath, [path.join(here, "serve.mjs"), String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((resolve, reject) => {
  server.stdout.once("data", resolve);
  server.once("exit", (code) => reject(new Error(`serve.mjs exited with ${code}; is port ${PORT} in use?`)));
});
const urlFor = (params) => `http://127.0.0.1:${PORT}/?${new URLSearchParams({ hud: 0, ...params })}`;

const browser = await chromium.launch({
  headless: false,
  channel: opt("--executable", null) ? undefined : "chrome",
  executablePath: opt("--executable", undefined),
  args: [
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
    "--window-size=1300,820", ...GPU_FLAGS[gpu],
  ],
});
const browserCdp = await browser.newBrowserCDPSession();

// Total CPU seconds per Chrome process type (browser, renderer, GPU, utility).
async function processCpu() {
  const { processInfo } = await browserCdp.send("SystemInfo.getProcessInfo");
  const byType = {};
  for (const p of processInfo) byType[p.type] = (byType[p.type] ?? 0) + p.cpuTime;
  return byType;
}

async function pageMetrics(cdp) {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

async function openPage(params) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  if (throttle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  await page.goto(urlFor(params));
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  return { page, cdp, errors };
}

// Measures one window of MEASURE ms: page stats, main-thread busy time and per-process CPU.
async function measureWindow(page, cdp) {
  await page.evaluate(() => window.__bench.resetStats());
  const [m0, p0, t0] = [await pageMetrics(cdp), await processCpu(), Date.now()];
  await page.waitForTimeout(MEASURE);
  const [m1, p1, t1] = [await pageMetrics(cdp), await processCpu(), Date.now()];
  const wall = (t1 - t0) / 1000;
  const pct = (a, b) => Math.round(((b ?? 0) - (a ?? 0)) / wall * 1000) / 10;
  const cpu = {};
  for (const type of Object.keys(p1)) cpu[type] = pct(p0[type], p1[type]);
  return {
    wallSeconds: wall,
    stats: await page.evaluate(() => window.__bench.stats()),
    mainThreadBusyPct: pct(m0.TaskDuration, m1.TaskDuration),
    scriptPct: pct(m0.ScriptDuration, m1.ScriptDuration),
    processCpuPct: cpu, // % of one core, per process type
    jsHeapMB: Math.round(m1.JSHeapUsedSize / 1e5) / 10,
  };
}

// ------------------------------------------------------------------------------------------------- run
await mkdir(out, { recursive: true });
const results = {
  label, date: new Date().toISOString(), gpuFlag: gpu, cpuThrottle: throttle, quick,
  host: { platform: `${process.platform}-${process.arch}`, cpu: os.cpus()[0]?.model, cores: os.cpus().length, ramGB: Math.round(os.totalmem() / 2 ** 30) },
  chrome: browser.version(), info: null, cases: [], cacheCheck: [],
};

for (const c of selected) {
  log(c.name);
  const { page, cdp, errors } = await openPage(c.params);
  results.info ??= await page.evaluate(() => window.__bench.info);
  await page.waitForTimeout(WARM);
  if (c.kind.startsWith("idle")) {
    await page.evaluate((all) => { window.__bench.stop(); if (all) window.__bench.stopBackground(); }, c.kind === "idle-all");
    await page.waitForTimeout(2000);
  }
  const m = await measureWindow(page, cdp);
  const info = await page.evaluate(() => window.__bench.info);
  if (c.name === "pixi mask 200" || c.name === "canvas mask 200") {
    await page.locator("canvas").screenshot({ path: path.join(out, `scene-${c.params.renderer}.png`) });
  }
  results.cases.push({ ...c, ...m, info, errors });
  await page.close();
}

// cacheAsTexture check: the same paused frame with desks uncached, in one cached texture, and in depth bands.
// A correct cache gives the same pixels as the uncached reference.
const pending = [];
function diff(a, b, file) {
  const A = PNG.sync.read(a), B = PNG.sync.read(b), D = new PNG({ width: A.width, height: A.height });
  const { width: W, height: H } = A, n = W * H, hit = new Uint8Array(n);
  let sum = 0;
  for (let p = 0; p < n; p++) {
    let d = 0;
    for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(A.data[p * 4 + k] - B.data[p * 4 + k]));
    sum += d;
    hit[p] = d > 8 ? 1 : 0;
  }
  // Resampling a cached texture changes 1-2 px of anti-aliased edge; a wrong draw order changes solid areas. A pixel
  // counts as an order error when at least 7 of its 8 neighbours differ too.
  let differing = 0, orderErrors = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x;
    let solid = false;
    if (hit[p]) {
      differing++;
      let around = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && x + dx >= 0 && y + dy >= 0 && x + dx < W && y + dy < H) around += hit[p + dy * W + dx];
      }
      solid = around >= 7;
      if (solid) orderErrors++;
    }
    const i = p * 4;
    D.data[i] = solid ? 255 : hit[p] ? 255 : A.data[i] / 3;
    D.data[i + 1] = solid ? 0 : hit[p] ? 200 : A.data[i + 1] / 3;
    D.data[i + 2] = solid ? 0 : hit[p] ? 0 : A.data[i + 2] / 3;
    D.data[i + 3] = 255;
  }
  if (file) pending.push(writeFile(file, PNG.sync.write(D)));
  const pct = (v) => Math.round(v / n * 10000) / 100;
  return { meanAbs: Math.round(sum / n * 1000) / 1000, differingPct: pct(differing), orderErrorPct: pct(orderErrors), orderErrorPx: orderErrors };
}

if (!only || only.includes("cache")) {
  for (const t of [4.2, 9.7, 15.1]) {
    const shots = {};
    for (const renderer of ["pixi", "canvas"]) for (const cache of ["none", "single", "bands"]) {
      const { page } = await openPage({ renderer, cache, mode: "mask", paused: 1, t });
      shots[`${renderer}-${cache}`] = await page.locator("canvas").screenshot({ path: path.join(out, `cache-${renderer}-${cache}-t${t}.png`) });
      await page.close();
    }
    for (const renderer of ["pixi", "canvas"]) for (const cache of ["single", "bands"]) {
      results.cacheCheck.push({ t, renderer, cache, against: "none", ...diff(shots[`${renderer}-none`], shots[`${renderer}-${cache}`], path.join(out, `cache-diff-${renderer}-${cache}-t${t}.png`)) });
    }
    results.cacheCheck.push({ t, renderer: "pixi vs canvas", cache: "none", against: "canvas none", ...diff(shots["pixi-none"], shots["canvas-none"], path.join(out, `cross-diff-t${t}.png`)) });
  }
}
await Promise.all(pending);
await browser.close();
server.kill();

// ------------------------------------------------------------------------------------------------- report
await writeFile(path.join(out, "results.json"), JSON.stringify(results, null, 1));
const f = (v, d = 2) => (v == null ? "–" : Number(v).toFixed(d));
const lines = [
  `# Renderer spike: ${label}`, "",
  `${results.date} · ${results.host.platform} · ${results.host.cores} x ${results.host.cpu} · ${results.host.ramGB} GB · Chrome ${results.chrome}`,
  `GPU flag \`${gpu}\` → \`${results.info?.gpu}\` · CPU throttle ${throttle}x · Pixi ${results.info?.pixi} · max batchable textures ${results.info?.maxBatchableTextures} · GPU timer ${results.info?.gpuTimer}` + (quick ? " · **quick run**" : ""),
  "", `Window ${MEASURE / 1000} s after ${WARM / 1000} s warm-up, 1280×720, 1x device pixels. CPU columns are % of one core over the window. Canvas "draws" are 2D context calls (drawImage, fill, stroke, fillRect), not GPU draw calls.`, "",
  "| case | fps | frame ms p50 / p95 / max | GPU ms p50 | draws/frame | main thread % | renderer CPU % | GPU process CPU % | browser CPU % | errors |",
  "|---|---:|---|---:|---:|---:|---:|---:|---:|---|",
];
for (const c of results.cases) {
  const s = c.stats, cpu = c.processCpuPct;
  lines.push(`| ${c.name} | ${f(s.fps, 1)} | ${f(s.frameMs?.p50)} / ${f(s.frameMs?.p95)} / ${f(s.frameMs?.max)} | ${f(s.gpuMs?.p50)} | ${f(s.drawCalls?.mean, 1)} | ${f(c.mainThreadBusyPct, 1)} | ${f(cpu.renderer, 1)} | ${f(cpu.GPU, 1)} | ${f(cpu.browser, 1)} | ${c.errors.length || ""} |`);
}
const tint = results.cases.find((c) => c.name === "canvas mask 200")?.info?.tintCopies;
if (tint) lines.push("", `Canvas tinted copies after the mask case: ${tint.copies} frames, ${f(tint.bytes / 2 ** 20, 1)} MB, ${f(tint.ms, 0)} ms to build.`);
if (results.cacheCheck.length) {
  lines.push("", "cacheAsTexture check (paused frames compared with the uncached reference; differing = any channel off by more than 8/255; order errors = differing pixels inside a solid differing area, not a 1-2 px resampled edge (a heuristic; check the diff PNGs); red in the cache-diff PNGs, edges in yellow):", "",
    "| t | renderer | desks | vs | mean max-channel diff /255 | pixels differing % | order-error pixels |", "|---:|---|---|---|---:|---:|---:|");
  for (const r of results.cacheCheck) lines.push(`| ${r.t} | ${r.renderer} | ${r.cache} | ${r.against} | ${f(r.meanAbs, 3)} | ${f(r.differingPct)} | ${r.orderErrorPx} |`);
}
await writeFile(path.join(out, "summary.md"), lines.join("\n") + "\n");
console.log(lines.join("\n"));
