#!/usr/bin/env node
// Spike (phase-3-scene 02): headless Blender -> sprite frames -> Pixi v8 atlas.
// Runs on Windows (native) and x64 Linux (incl. WSL2). See README.md.
//
//   node pipeline.mjs all [--label NAME] [--quick] [--mannequin basic] [--no-desktop]
//   node pipeline.mjs setup | render --engine eevee|cycles | desktop --engine ... | pack <dir>
//                     compare <dirA> <dirB> | report | serve [--port 5173]
//
// Options: --blender <path> uses an existing Blender instead of the pinned download (it must still be
// the pinned build unless SPIKE_ALLOW_UNPINNED=1). --gl native skips Xvfb + llvmpipe on Linux.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync,
  writeFileSync, copyFileSync } from "node:fs";
import { createServer } from "node:http";
import { cpus, hostname, totalmem } from "node:os";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, ".cache");
const OUT = join(HERE, "out");

const PINS = {
  "blender-win32-x64": {
    url: "https://download.blender.org/release/Blender5.2/blender-5.2.2-windows-x64.zip",
    sha256: "3849d17a682cba006075aaa3f3597ecb5c9c30ec31035b2e092c53e40679b535",
    exe: "blender-5.2.2-windows-x64/blender.exe",
  },
  "blender-linux-x64": {
    url: "https://download.blender.org/release/Blender5.2/blender-5.2.2-linux-x64.tar.xz",
    sha256: "84098912789dc450e95697c4184fb8a90acbe5111c2ba4aede3fecb57806a168",
    exe: "blender-5.2.2-linux-x64/blender",
  },
  mpfb: {
    url: "https://extensions.blender.org/download/sha256:4f0a879d64a39bf646fbf5f53601ac678855da329d650617dca5737548239a87/add-on-mpfb-v2.0.17.zip",
    sha256: "4f0a879d64a39bf646fbf5f53601ac678855da329d650617dca5737548239a87",
    file: "add-on-mpfb-v2.0.17.zip",
  },
  makehuman: {
    url: "https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip",
    sha256: "b542127a8e25547c7c29c19f2d1d2adb9a664c80396ecd694095dbc8028a0107",
    file: "makehuman_system_assets_cc0.zip",
  },
};

// ---------------------------------------------------------------- args
const [cmd = "help", ...rest] = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) {
    const key = rest[i].slice(2);
    const next = rest[i + 1];
    flags[key] = next && !next.startsWith("--") ? (i++, next) : true;
  } else positional.push(rest[i]);
}
const IS_WIN = process.platform === "win32";
const LABEL = flags.label ?? `${IS_WIN ? "windows" : "linux"}-${process.arch}-${hostname().toLowerCase()}`;
const log = (...a) => console.log("[pipeline]", ...a);
// Throws rather than calling process.exit(): exiting while a fetch socket is still open trips a libuv
// assertion on Windows (UV_HANDLE_CLOSING in src\win\async.c). main() reports it and sets the exit code.
class PipelineError extends Error {}
const die = (msg) => { throw new PipelineError(msg); };

// ---------------------------------------------------------------- setup
async function sha256(path) {
  const h = createHash("sha256");
  await streamPipeline(createReadStream(path), h);
  return h.digest("hex");
}

async function download(pin, dest) {
  if (existsSync(dest) && (await sha256(dest)) === pin.sha256) return log(`ok ${relative(HERE, dest)}`);
  log(`downloading ${pin.url}`);
  const res = await fetch(pin.url);
  if (!res.ok) {
    await res.body?.cancel();
    // blender.org sits behind a Cloudflare challenge that blocks scripted downloads from some networks
    die(`download failed ${res.status} ${pin.url}\n  Download it in a browser and save it as ${dest}; ` +
      "setup checks its sha256 and skips the download");
  }
  mkdirSync(dirname(dest), { recursive: true });
  await streamPipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  const got = await sha256(dest);
  if (got !== pin.sha256) { rmSync(dest); die(`checksum mismatch for ${dest}: ${got} != ${pin.sha256}`); }
  log(`verified ${relative(HERE, dest)} sha256 ${got}`);
}

function blenderPath() {
  if (flags.blender) return resolve(flags.blender);
  const key = `blender-${process.platform}-${process.arch}`;
  const pin = PINS[key];
  if (!pin) die(`no pinned Blender for ${key}. Blender ships 5.2.2 for Windows x64 and Linux x64 only; ` +
    "run on one of those, or pass --blender <path> with SPIKE_ALLOW_UNPINNED=1 for a dev run");
  return join(CACHE, pin.exe);
}

// The pinned build's own user dirs live under .cache, so the spike never touches the user's Blender config.
const blenderEnv = () => ({ ...process.env, BLENDER_USER_RESOURCES: join(CACHE, "blender-user") });

function runSync(exe, args, opts = {}) {
  const r = spawnSync(exe, args, { stdio: "inherit", env: blenderEnv(), ...opts });
  if (r.status !== 0) die(`${exe} ${args.join(" ")} exited ${r.status}${r.error ? ` (${r.error.message})` : ""}`);
}

async function setup() {
  mkdirSync(CACHE, { recursive: true });
  if (!flags.blender) {
    const pin = PINS[`blender-${process.platform}-${process.arch}`];
    blenderPath(); // fails early on an unsupported platform
    const archive = join(CACHE, pin.url.split("/").pop());
    await download(pin, archive);
    if (!existsSync(join(CACHE, pin.exe))) {
      log("extracting Blender");
      // Windows 10+ ships bsdtar, which reads .zip; call it by path so Git Bash's GNU tar is not picked up
      const tar = IS_WIN ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
      runSync(tar, [IS_WIN ? "-xf" : "-xJf", archive, "-C", CACHE]);
    }
  }
  await download(PINS.mpfb, join(CACHE, PINS.mpfb.file));
  await download(PINS.makehuman, join(CACHE, PINS.makehuman.file));
  const blender = blenderPath();
  const assets = join(CACHE, "makehuman");
  if (!existsSync(join(assets, "clothes"))) {
    log("extracting MakeHuman CC0 assets");
    runSync(blender, ["-b", "--factory-startup", "--python-expr",
      `import zipfile; zipfile.ZipFile(r"${join(CACHE, PINS.makehuman.file)}").extractall(r"${assets}")`]);
  }
  if (!existsSync(join(CACHE, "blender-user", "extensions", "user_default", "mpfb"))) {
    log("installing MPFB 2.0.17 into the spike's own Blender user dir");
    // render.py enables it; installing without --enable avoids saving preferences
    runSync(blender, ["-b", "--factory-startup", "--command", "extension", "install-file",
      "--repo", "user_default", join(CACHE, PINS.mpfb.file)]);
  }
  log("setup done");
}

// ---------------------------------------------------------------- render
function blenderVersion(blender) {
  const r = spawnSync(blender, ["-b", "--factory-startup", "--version"], { encoding: "utf8", env: blenderEnv() });
  return (r.stdout ?? "").split(/\r?\n/).slice(0, 3).join(" | ").trim();
}

function renderArgs(engine, out, extra = []) {
  const a = ["--factory-startup", "-P", join(HERE, "render.py"), "--", "--engine", engine, "--out", out,
    "--assets", join(CACHE, "makehuman"), ...extra];
  if (flags.quick) a.push("--quick");
  if (flags.mannequin) a.push("--mannequin", flags.mannequin);
  return a;
}

async function render(engine, { desktop = false } = {}) {
  if (!["eevee", "cycles"].includes(engine)) die("--engine eevee|cycles");
  const blender = blenderPath();
  if (!existsSync(blender)) die(`Blender not found at ${blender}; run setup first`);
  const out = join(OUT, desktop ? `desktop-${engine}` : engine);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  let exe = blender;
  let args = renderArgs(engine, out, desktop ? ["--desktop"] : []);
  if (!desktop) args.unshift("-b");
  const env = blenderEnv();
  // Linux without a GPU: EEVEE through Xvfb + Mesa llvmpipe (also forced under WSL2, so the figures match a VPS)
  if (!IS_WIN && engine === "eevee" && !desktop && flags.gl !== "native") {
    env.LIBGL_ALWAYS_SOFTWARE = "1";
    exe = "xvfb-run";
    args = ["-a", "-s", "-screen 0 1280x1024x24", blender, ...args];
  }
  log(`render ${engine}${desktop ? " (desktop GUI)" : ""} -> ${relative(HERE, out)}`);
  const started = Date.now();
  const logFile = createWriteStream(join(out, "blender.log"));
  const child = spawn(exe, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  let peakRssMb = 0;
  const poll = setInterval(() => { const mb = processTreeRssMb(child.pid); if (mb > peakRssMb) peakRssMb = mb; }, IS_WIN ? 3000 : 1000);
  for (const s of [child.stdout, child.stderr]) {
    s.on("data", (d) => {
      logFile.write(d);
      for (const line of d.toString().split("\n")) if (/^(FRAME|DONE|BUILD|WARNING|Refusing)|Error|Traceback/.test(line)) console.log("  " + line.trim());
    });
  }
  const code = await new Promise((r) => child.on("close", r));
  clearInterval(poll);
  logFile.end();
  const wall = (Date.now() - started) / 1000;
  if (code !== 0 || !existsSync(join(out, "render-log.json"))) die(`render ${engine} failed (exit ${code}); see ${join(out, "blender.log")}`);
  const rl = JSON.parse(readFileSync(join(out, "render-log.json"), "utf8"));
  rl.wall_seconds = wall;
  rl.peak_rss_tree_mb = Math.round(peakRssMb);
  writeFileSync(join(out, "render-log.json"), JSON.stringify(rl, null, 1));
  log(`render ${engine} done in ${wall.toFixed(0)} s`);
  return out;
}

// Memory of Blender and its descendants (xvfb-run wraps it on Linux; on Windows Blender has no children), sampled
// every 1 s (3 s on Windows): a sampled maximum that can miss short spikes. render.py's in-process peak is exact.
function processTreeRssMb(pid) {
  try {
    if (IS_WIN) {
      const r = spawnSync("powershell", ["-NoProfile", "-Command",
        `(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq ${pid} -or $_.ParentProcessId -eq ${pid} } | Measure-Object WorkingSetSize -Sum).Sum`],
        { encoding: "utf8" });
      return Number(r.stdout.trim()) / 2 ** 20 || 0;
    }
    const all = readdirSync("/proc").filter((p) => /^\d+$/.test(p));
    const parent = Object.fromEntries(all.map((p) => {
      try { return [p, readFileSync(`/proc/${p}/stat`, "utf8").split(") ")[1].split(" ")[1]]; } catch { return [p, "0"]; }
    }));
    const tree = new Set([String(pid)]);
    let grew = true;
    while (grew) { grew = false; for (const p of all) if (!tree.has(p) && tree.has(parent[p])) { tree.add(p); grew = true; } }
    let kb = 0;
    for (const p of tree) {
      try { kb += Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${p}/status`, "utf8"))?.[1] ?? 0); } catch { /* exited */ }
    }
    return kb / 1024;
  } catch { return 0; }
}

// ---------------------------------------------------------------- png helpers
const readPng = (p) => PNG.sync.read(readFileSync(p));
const toLin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const toSrgb = (c) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)));

function listFrames(dir) {
  const out = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : f.endsWith(".png") && out.push(p); } };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

// ---------------------------------------------------------------- pack
// For each beauty frame, derive a "shirt" frame: the neutral shirt divided by its neutral grey, with the mask as
// alpha. Pixi draws it over the beauty frame with sprite.tint = agent colour (multiply), which is the p3-01
// mask + tint in a form Pixi does natively.
async function pack(dir) {
  const { packAsync } = await import("free-tex-packer-core");
  const rl = JSON.parse(readFileSync(join(dir, "render-log.json"), "utf8"));
  const { frame_1x: [w1, h1], anchor_1x: [ax, ay], scale, neutral_shirt: neutral, anims } = rl.meta;
  const atlasDir = join(dir, "atlas");
  rmSync(atlasDir, { recursive: true, force: true });
  mkdirSync(atlasDir, { recursive: true });
  const index = {};
  // One atlas per animation and direction keeps every page well under 4096 px, whatever the character's size.
  for (const [anim, d] of Object.keys(anims).flatMap((a) => rl.meta.dirs.map((d) => [a, d]))) {
    const key = `${anim}/${d}`;
    const files = [];
    for (const beautyPath of listFrames(join(dir, "frames", "beauty", anim, d))) {
      const rel = relative(join(dir, "frames", "beauty"), beautyPath).split(sep).join("/").replace(/\.png$/, "");
      const maskPath = join(dir, "frames", "mask", ...rel.split("/")) + ".png";
      const beauty = readPng(beautyPath);
      const mask = readPng(maskPath);
      const shirt = new PNG({ width: beauty.width, height: beauty.height });
      for (let i = 0; i < beauty.data.length; i += 4) {
        const m = toLin(mask.data[i]) * (mask.data[i + 3] / 255);
        for (let c = 0; c < 3; c++) shirt.data[i + c] = toSrgb(toLin(beauty.data[i + c]) / neutral[c]);
        shirt.data[i + 3] = Math.round(255 * m);
      }
      files.push({ path: `${rel}.png`, contents: readFileSync(beautyPath) });
      files.push({ path: `${rel}-shirt.png`, contents: PNG.sync.write(shirt) });
    }
    if (!files.length) continue;
    const packed = await packAsync(files, {
      textureName: `${anim}-${d}`, width: 4096, height: 4096, fixedSize: false, powerOfTwo: false, padding: 2, extrude: 0,
      allowRotation: false, detectIdentical: true, allowTrim: true, trimMode: "trim", alphaThreshold: 0,
      removeFileExtension: true, prependFolderName: true, exporter: "Pixi", packer: "OptimalPacker",
    });
    const jsons = packed.filter((f) => f.name.endsWith(".json"));
    if (jsons.length !== 1) die(`${key}: expected one atlas page, got ${jsons.length}`);
    for (const f of packed) {
      if (!f.name.endsWith(".json")) { writeFileSync(join(atlasDir, f.name), f.buffer); continue; }
      const sheet = JSON.parse(f.buffer.toString());
      const animations = {};
      for (const name of Object.keys(sheet.frames).sort()) {
        const fr = sheet.frames[name];
        delete fr.pivot;
        fr.anchor = { x: ax / w1, y: ay / h1 }; // feet on the tile centre, trim-aware in Pixi
        (animations[`${key}${name.endsWith("-shirt") ? "-shirt" : ""}`] ??= []).push(name);
      }
      sheet.animations = animations;
      sheet.meta.scale = scale; // 2x art: Pixi shows it at half size, full detail on HiDPI
      sheet.meta.app = "agentarium spikes/blender-pipeline (free-tex-packer-core 0.3.9)";
      writeFileSync(join(atlasDir, f.name), JSON.stringify(sheet, null, 1));
      index[key] = { json: f.name, fps: anims[anim].fps, frames: Object.keys(sheet.frames).length, size: sheet.meta.size };
    }
  }
  writeFileSync(join(atlasDir, "index.json"), JSON.stringify({ engine: rl.args.engine, anims: Object.keys(anims),
    dirs: rl.meta.dirs, sheets: index }, null, 1));
  log(`packed ${relative(HERE, atlasDir)}: ${Object.entries(index).map(([k, v]) => `${k} ${v.size.w}x${v.size.h}`).join(", ")}`);
  return index;
}

// ---------------------------------------------------------------- compare
// Per-frame mean and p99 absolute difference (0-255, RGB premultiplied by alpha, and alpha) over pixels either
// image covers, for the beauty and mask layers. B may be a subset of A (the desktop run renders a few frames);
// every frame B has must exist in A at the same size. "Match" means no visible difference: mean <= 1 and p99 <= 8.
const MATCH = { mean: 1, p99: 8 };

function compare(a, b) {
  const rows = [];
  const problems = [];
  for (const layer of ["beauty", "mask"]) {
    for (const pb of listFrames(join(b, "frames", layer))) {
      const rel = relative(join(b, "frames", layer), pb);
      const pa = join(a, "frames", layer, rel);
      if (!existsSync(pa)) { problems.push(`missing in ${relative(HERE, a)}: ${layer}/${rel}`); continue; }
      const A = readPng(pa), B = readPng(pb);
      if (A.width !== B.width || A.height !== B.height) { problems.push(`size differs: ${layer}/${rel}`); continue; }
      const diffs = [];
      for (let i = 0; i < A.data.length; i += 4) {
        const aa = A.data[i + 3] / 255, ba = B.data[i + 3] / 255;
        if (aa === 0 && ba === 0) continue;
        let d = Math.abs(A.data[i + 3] - B.data[i + 3]);
        for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(A.data[i + c] * aa - B.data[i + c] * ba));
        diffs.push(d);
      }
      diffs.sort((x, y) => x - y);
      const mean = diffs.reduce((s, x) => s + x, 0) / Math.max(1, diffs.length);
      rows.push({ layer, frame: rel.split(sep).join("/"), mean: +mean.toFixed(2), p99: diffs[Math.floor(diffs.length * 0.99)] ?? 0 });
    }
  }
  const byLayer = Object.fromEntries(["beauty", "mask"].map((layer) => {
    const r = rows.filter((x) => x.layer === layer);
    if (!r.length) return [layer, { frames: 0 }];
    const mean = +(r.reduce((s, x) => s + x.mean, 0) / r.length).toFixed(2);
    const worst_p99 = Math.max(...r.map((x) => x.p99));
    return [layer, { frames: r.length, mean, worst_p99, match: mean <= MATCH.mean && worst_p99 <= MATCH.p99 }];
  }));
  if (!rows.length) problems.push("no frames to compare");
  return { a: relative(HERE, a), b: relative(HERE, b), ...byLayer, problems, rows };
}

// ---------------------------------------------------------------- report
function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? { n: s.length, mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(3), median: s[s.length >> 1], max: s.at(-1) } : { n: 0 };
}

// Headless vs desktop (GUI) render of the same engine is the "matches a desktop render" check. EEVEE vs Cycles is
// informational only: Cycles has no Shader to RGB, so it renders flat Principled materials instead of the toon look.
const COMPARES = [["eevee", "desktop-eevee"], ["cycles", "desktop-cycles"], ["eevee", "cycles"]];

function report() {
  const compares = COMPARES.filter(([a, b]) => existsSync(join(OUT, a, "frames")) && existsSync(join(OUT, b, "frames")))
    .map(([a, b]) => compare(join(OUT, a), join(OUT, b)));
  const dest = join(HERE, "results", LABEL);
  mkdirSync(dest, { recursive: true });
  const runs = {};
  for (const name of readdirSync(OUT)) {
    const p = join(OUT, name, "render-log.json");
    if (!existsSync(p)) continue;
    const rl = JSON.parse(readFileSync(p, "utf8"));
    runs[name] = {
      blender: rl.blender, pinned: rl.pinned, host: rl.host, gl: rl.gl, engine: rl.engine, errors: rl.errors,
      build_seconds: rl.build_seconds, wall_seconds: rl.wall_seconds,
      peak_memory_mb: rl.peak_memory_mb, peak_rss_tree_mb: rl.peak_rss_tree_mb,
      seconds_per_frame: {
        beauty: stats(rl.frames.filter((f) => f.layer === "beauty").map((f) => f.seconds)),
        mask: stats(rl.frames.filter((f) => f.layer === "mask").map((f) => f.seconds)),
      },
    };
    copyFileSync(p, join(dest, `${name}.render-log.json`));
    const atlas = join(OUT, name, "atlas");
    if (existsSync(atlas)) {
      mkdirSync(join(dest, `${name}-atlas`), { recursive: true });
      for (const f of readdirSync(atlas)) copyFileSync(join(atlas, f), join(dest, `${name}-atlas`, f));
    }
  }
  const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: HERE, encoding: "utf8" }).stdout?.trim();
  const summary = { label: LABEL, date: new Date().toISOString(), commit, node: process.version, platform: `${process.platform}-${process.arch}`,
    cpus: `${cpus().length} x ${cpus()[0]?.model}`, ram_gb: Math.round(totalmem() / 2 ** 30), runs,
    compare: compares.map(({ rows, ...c }) => c) };
  writeFileSync(join(dest, "summary.json"), JSON.stringify(summary, null, 1));
  const md = [`# Blender pipeline spike: ${LABEL}`, "", `${summary.date} · ${summary.platform} · ${summary.cpus} · ${summary.ram_gb} GB RAM`, "",
    "| run | Blender | pinned | GL | beauty s/frame (mean, max) | mask s/frame | wall s | peak MB (in-process / process tree, sampled) |",
    "|---|---|---|---|---|---|---|---|",
    ...Object.entries(runs).map(([k, r]) => `| ${k} | ${r.blender.version} ${r.blender.build_hash} | ${r.pinned ? "yes" : "**no**"} | ${r.gl?.renderer ?? r.gl?.error ?? ""} | ${r.seconds_per_frame.beauty.mean}, ${r.seconds_per_frame.beauty.max} | ${r.seconds_per_frame.mask.mean} | ${Math.round(r.wall_seconds)} | ${r.peak_memory_mb} / ${r.peak_rss_tree_mb} |`),
    "", `Match = no visible difference: mean <= ${MATCH.mean} and p99 <= ${MATCH.p99} (0-255). EEVEE vs Cycles is informational only (Cycles has no toon shading).`, "",
    "| compare | layer | frames | mean diff /255 | worst p99 /255 | match | problems |", "|---|---|---|---|---|---|---|",
    ...summary.compare.flatMap((c) => ["beauty", "mask"].map((l) =>
      `| ${c.a} vs ${c.b} | ${l} | ${c[l].frames} | ${c[l].mean ?? ""} | ${c[l].worst_p99 ?? ""} | ${c[l].match === undefined ? "" : c[l].match ? "yes" : "**no**"} | ${c.problems.length ? c.problems.slice(0, 3).join("; ") : ""} |`)), ""].join("\n");
  writeFileSync(join(dest, "summary.md"), md);
  console.log("\n" + md);
  log(`results in ${relative(process.cwd(), dest)}; commit that folder`);
}

// ---------------------------------------------------------------- serve (Pixi check page)
function serve() {
  const port = Number(flags.port ?? 5173);
  const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".png": "image/png", ".map": "application/json" };
  createServer((req, res) => {
    let url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (url === "/") url = "/pixi/index.html";
    const file = url.startsWith("/pixi.js/") ? join(HERE, "node_modules", "pixi.js", "dist", url.slice(9)) : join(HERE, url);
    if (!resolve(file).startsWith(HERE) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    createReadStream(file).pipe(res);
  }).listen(port, "127.0.0.1", () => log(`Pixi check page: http://127.0.0.1:${port}/  (Ctrl+C to stop)`));
}

// ---------------------------------------------------------------- main
async function main() {
  switch (cmd) {
    case "setup": return setup();
    case "render": return render(flags.engine);
    case "desktop": return render(flags.engine, { desktop: true });
    case "pack": return pack(resolve(positional[0] ?? join(OUT, "eevee")));
    case "compare": { const { rows, ...c } = compare(resolve(positional[0]), resolve(positional[1])); console.log(JSON.stringify(c, null, 1)); return; }
    case "report": return report();
    case "serve": return serve();
    case "all": {
      await setup();
      log(blenderVersion(blenderPath()));
      rmSync(OUT, { recursive: true, force: true }); // the report reads everything in out/, so start clean
      const eevee = await render("eevee");
      const cycles = await render("cycles");
      if (IS_WIN && !flags["no-desktop"]) {
        await render("eevee", { desktop: true });
        await render("cycles", { desktop: true });
      }
      await pack(eevee);
      await pack(cycles);
      report();
      log("next: node pipeline.mjs serve, open the page, and follow README step 4");
      return;
    }
    default:
      console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 10).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  }
}
main().catch((e) => {
  console.error(`[pipeline] ERROR: ${e instanceof PipelineError ? e.message : (e.stack ?? e)}`);
  process.exitCode = 1;
});
