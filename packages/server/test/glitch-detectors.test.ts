import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { SCHEMA_VERSION } from "@agentarium/core";
import { memoryGlitchLog, startDaemon, type Daemon } from "../src";

const SECRET = "SECRET-USER-TEXT";
const agentRef = (session: string) => ({ machine: "m", provider: "claude-code", session, agent: "root" });
const event = (kind: string, session: string, extra: object = {}) =>
  ({ schema_version: SCHEMA_VERSION, kind, agent: agentRef(session), ...extra });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const daemons: Daemon[] = [];
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(daemons.splice(0).map((d) => d.close()));
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function start(opts: Parameters<typeof startDaemon>[0] = {}) {
  const log = memoryGlitchLog();
  const dataDir = await mkdtemp(join(tmpdir(), "agentarium-glitch-data-"));
  const d = await startDaemon({ port: 0, dataDir, flushMs: 5, tickMs: 0, glitches: log, ...opts });
  daemons.push(d);
  return { d, log };
}

async function post(d: Daemon, body: unknown): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${d.port}/events`, {
    method: "POST",
    headers: { authorization: `Bearer ${d.token}`, "content-type": "application/json" },
    body: JSON.stringify({ event: body }),
  });
  return ((await response.json()) as { room: string }).room;
}

async function connect(d: Daemon, room: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${d.port}/ws?token=${d.token}&room=${encodeURIComponent(room)}`);
  await new Promise((resolve) => ws.once("open", resolve));
  return ws;
}

async function waitFor(check: () => Promise<boolean> | boolean): Promise<void> {
  const end = Date.now() + 3000;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("timed out waiting for a Glitch");
    await sleep(10);
  }
}

describe("Glitch detectors", () => {
  it("records a stale client once, when it leaves, if an Agent needed the user meanwhile", async () => {
    const { d, log } = await start({ maxBufferedBytes: -1 });
    const room = await post(d, event("session_start", "s1"));
    const ws = await connect(d, room);
    await post(d, event("needs_input", "s1", { summary: SECRET }));
    await sleep(30);
    await post(d, event("tool_start", "s1", { tool_use_id: "t", tool: "Bash", category: "exec", summary: SECRET }));
    await sleep(30);
    expect(await log.read(0)).toEqual([]);
    ws.close();
    await waitFor(async () => (await log.read(0)).length > 0);
    await sleep(30);
    const glitches = await log.read(0);
    expect(glitches).toEqual([expect.objectContaining({ kind: "stale_client", room })]);
    expect(JSON.stringify(glitches)).not.toContain(SECRET);
  });

  it("records no stale client when no Agent needed the user", async () => {
    const { d, log } = await start({ maxBufferedBytes: -1 });
    const room = await post(d, event("session_start", "s1"));
    const ws = await connect(d, room);
    await post(d, event("prompt", "s1"));
    await sleep(30);
    ws.close();
    await sleep(50);
    expect(await log.read(0)).toEqual([]);
  });

  it("records an Agent marked lost that sends another event", async () => {
    let now = 1_000;
    const { d, log } = await start({ clock: () => now, tickMs: 5, timeouts: { idleMs: 10, lostMs: 100, waitingLostMs: 200 } });
    const room = await post(d, event("session_start", "s1"));
    now = 1_500;
    await waitFor(() => Object.values(d.world(room).agents)[0]?.status === "lost");
    await post(d, event("tool_start", "s1", { tool_use_id: "t", tool: "Bash", category: "exec", summary: SECRET }));
    await post(d, event("tool_end", "s1", { tool_use_id: "t", ok: true }));
    const glitches = await log.read(0);
    expect(glitches).toEqual([
      expect.objectContaining({ kind: "lost_but_alive", room, provider: "claude-code", durationMs: 500 }),
    ]);
    expect(JSON.stringify(glitches)).not.toContain(SECRET);
  });

  it("records a root Agent whose first event is not session_start, and nothing for one that starts properly", async () => {
    const { d, log } = await start();
    await post(d, event("session_start", "ok"));
    await post(d, event("prompt", "ok"));
    const room = await post(d, event("tool_start", "late", { tool_use_id: "t", tool: "Bash", category: "exec", summary: SECRET }));
    await post(d, event("tool_end", "late", { tool_use_id: "t", ok: true }));
    const glitches = await log.read(0);
    expect(glitches).toEqual([expect.objectContaining({ kind: "late_session_start", room, reason: "tool_start" })]);
    expect(glitches[0]?.agent).toContain(":late:");
    expect(JSON.stringify(glitches)).not.toContain(SECRET);
  });

  it("records Codex live dropping after it was connected, but not when it was never connected", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agentarium-glitch-codex-"));
    const socketPath = join(dir, "control.sock");
    await writeFile(socketPath, "");
    const server = createServer();
    const wss = new WebSocketServer({ server });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(async () => {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    wss.on("connection", (client) => client.on("message", (bytes) => {
      const message = JSON.parse(bytes.toString()) as { id: number; method: string };
      if (message.method === "initialize") client.send(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} }));
      if (message.method === "thread/loaded/list") {
        client.send(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { data: [] } }));
      }
    }));
    // Stands in for `codex app-server proxy`: relays stdio to the test's WebSocket server.
    const fakeProxy = join(dir, "proxy.mjs");
    await writeFile(fakeProxy, [
      'import { connect } from "node:net";',
      'const tcp = connect(Number(process.argv[2]), "127.0.0.1");',
      "process.stdin.pipe(tcp).pipe(process.stdout);",
      'tcp.on("close", () => process.exit(0));',
    ].join("\n"));
    const proxy = [process.execPath, fakeProxy, String((server.address() as AddressInfo).port)];

    const never = await start({ codexControlSocket: join(dir, "missing.sock"), codexLiveProxy: proxy, log: () => {} });
    const { d, log } = await start({ codexControlSocket: socketPath, codexLiveProxy: proxy, log: () => {} });
    const live = async () =>
      ((await (await fetch(`http://127.0.0.1:${d.port}/health`)).json()) as { codexLive: boolean }).codexLive;
    await waitFor(live);
    for (const client of wss.clients) client.terminate();
    await waitFor(async () => (await log.read(0)).length > 0);
    expect(await log.read(0)).toEqual([expect.objectContaining({ kind: "codex_live_dropped" })]);
    expect(await never.log.read(0)).toEqual([]);
  });
});
