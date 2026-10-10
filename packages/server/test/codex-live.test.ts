import { existsSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { startDaemon, type Daemon } from "../src";
import { startCodexLive } from "../src/codex-live";

const dirs: string[] = [];
const daemons: Daemon[] = [];
const servers: { close(): Promise<void> }[] = [];
const temp = () => { const dir = mkdtempSync(join(tmpdir(), "ag-codex-")); dirs.push(dir); return dir; };
const waitFor = async (check: () => boolean) => {
  const end = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out waiting for Codex state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
afterEach(async () => {
  await Promise.all(daemons.splice(0).map((d) => d.close()));
  await Promise.all(servers.splice(0).map((s) => s.close()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Codex live daemon", () => {
  it("times out unanswered RPC calls and retries discovery", async () => {
    const socketPath = join(temp(), "control.sock");
    const server = createServer();
    const wss = new WebSocketServer({ server });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    servers.push({ close: async () => {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    } });
    let discoveryCalls = 0;
    wss.on("connection", (client) => client.on("message", (bytes) => {
      const message = JSON.parse(bytes.toString()) as { id: number; method: string };
      if (message.method === "initialize") client.send(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} }));
      if (message.method === "thread/loaded/list") discoveryCalls++;
    }));
    const observer = startCodexLive({
      socketPath,
      mapper: { thread: () => ({ events: [] }), map: () => ({ events: [] }) },
      onEvents: () => {},
      log: () => {},
      pollMs: 30,
      rpcTimeoutMs: 20,
    });
    try {
      await waitFor(() => discoveryCalls >= 2);
      expect(observer.connected()).toBe(true);
    } finally {
      await observer.close();
    }
  });
  it("reuses one short socket alias across reconnects and removes it on close", async () => {
    const dir = temp();
    const socketPath = join(dir, "control.sock");
    const longSocketPath = join(dir, "x".repeat(100));
    const server = createServer();
    const wss = new WebSocketServer({ server });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    symlinkSync(socketPath, longSocketPath);
    servers.push({ close: async () => {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    } });
    const aliases = () => readdirSync(tmpdir()).filter((name) => name.startsWith("agentarium-codex-") && name !== dir.split("/").at(-1));
    const before = new Set(aliases());
    let connections = 0;
    wss.on("connection", (client) => {
      connections++;
      client.on("message", (bytes) => {
        const message = JSON.parse(bytes.toString()) as { id: number; method: string };
        if (message.method === "initialize") client.send(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} }));
        if (message.method === "thread/loaded/list") {
          client.send(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { data: [] } }));
          if (connections === 1) client.close();
        }
      });
    });
    const observer = startCodexLive({
      socketPath: longSocketPath,
      mapper: { thread: () => ({ events: [] }), map: () => ({ events: [] }) },
      onEvents: () => {},
      log: () => {},
      retryMs: 20,
      pollMs: 100,
    });
    let created: string[] = [];
    try {
      await waitFor(() => connections >= 2 && observer.connected());
      created = aliases().filter((name) => !before.has(name));
      expect(created).toHaveLength(1);
    } finally {
      await observer.close();
    }
    expect(existsSync(join(tmpdir(), created[0]!))).toBe(false);
  });
  it("observes an approval and its outcome without replying to the app-server request", async () => {
    const dir = temp();
    const socketPath = join(dir, "control.sock");
    const longSocketPath = join(dir, "x".repeat(100));
    const server = createServer();
    const wss = new WebSocketServer({ server });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    symlinkSync(socketPath, longSocketPath);
    servers.push({ close: async () => {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    } });
    let replyToApproval = false;
    let client: import("ws").WebSocket | undefined;
    wss.on("connection", (ws) => {
      client = ws;
      ws.on("message", (bytes) => {
        const message = JSON.parse(bytes.toString()) as { id?: number; method?: string };
        if (message.id === 777) replyToApproval = true;
        const send = (value: unknown) => ws.send(JSON.stringify(value));
        if (message.method === "initialize") send({ jsonrpc: "2.0", id: message.id, result: {} });
        if (message.method === "thread/loaded/list") send({ jsonrpc: "2.0", id: message.id, result: { data: ["s"] } });
        if (message.method === "thread/resume") {
          // An already pending approval can be replayed before the resume reply.
          send({ jsonrpc: "2.0", method: "item/started", params: { threadId: "s", item: { type: "commandExecution", id: "t", command: "/bin/bash -lc 'echo ok'" } } });
          send({ jsonrpc: "2.0", id: 777, method: "item/commandExecution/requestApproval", params: { threadId: "s", itemId: "t", reason: "private text" } });
          send({ jsonrpc: "2.0", id: message.id, result: { thread: { id: "s", sessionId: "s", cwd: dir } } });
        }
      });
    });
    const logs: string[] = [];
    const d = await startDaemon({ port: 0, dataDir: join(dir, "data"), tickMs: 0, machine: "m", codexControlSocket: longSocketPath, log: (line) => logs.push(line) });
    daemons.push(d);
    const room = () => Object.values(d.world("unassigned").agents)[0];
    await waitFor(() => room()?.status === "waiting").catch(() => { throw new Error(`wait failed: ${logs.join(" | ")}; state ${JSON.stringify(room())}`); });
    expect(room()?.category).toBe("wait");
    expect((await (await fetch(`http://127.0.0.1:${d.port}/health`)).json()).codexLive).toBe(true);
    client!.send(JSON.stringify({ jsonrpc: "2.0", method: "serverRequest/resolved", params: { threadId: "s", requestId: 777 } }));
    await waitFor(() => room()?.status === "working" && room()?.category === "exec");
    client!.send(JSON.stringify({ jsonrpc: "2.0", method: "item/completed", params: { threadId: "s", item: { type: "commandExecution", id: "t", status: "failed" } } }));
    await waitFor(() => room()?.status === "blocked");
    expect(room()?.category).toBe("error");
    expect(replyToApproval).toBe(false);
  });

  it("keeps hooks active and logs unavailable once when the socket is missing", async () => {
    const dir = temp();
    const logs: string[] = [];
    const d = await startDaemon({ port: 0, dataDir: join(dir, "data"), tickMs: 0, machine: "m",
      codexControlSocket: join(dir, "missing.sock"), log: (line) => logs.push(line) });
    daemons.push(d);
    await waitFor(() => logs.some((line) => line.includes("codex live: unavailable")));
    const health = await (await fetch(`http://127.0.0.1:${d.port}/health`)).json() as { codexLive: boolean };
    expect(health.codexLive).toBe(false);
    const response = await fetch(`http://127.0.0.1:${d.port}/hooks/codex`, { method: "POST",
      headers: { authorization: `Bearer ${d.token}`, "content-type": "application/json" },
      body: JSON.stringify({ session_id: "s", hook_event_name: "SessionStart", cwd: dir }) });
    expect(response.status).toBe(204);
    expect(Object.values(d.world("unassigned").agents)[0]?.status).toBe("idle");
    expect(logs.filter((line) => line.includes("codex live: unavailable"))).toHaveLength(1);
  });
});
