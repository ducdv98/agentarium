import { spawn, type ChildProcess } from "node:child_process";
import { lstatSync } from "node:fs";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Duplex } from "node:stream";
import WebSocket from "ws";
import type { AdapterOutput } from "@agentarium/adapters";

interface Mapper {
  thread(thread: unknown): AdapterOutput;
  map(message: unknown): AdapterOutput;
}

// Node can't stat a Windows AF_UNIX socket (EACCES), so only ENOENT means it is missing.
function socketExists(path: string): boolean {
  try { lstatSync(path); } catch (error) { return (error as NodeJS.ErrnoException).code !== "ENOENT"; }
  return true;
}

export function startCodexLive(opts: {
  socketPath: string;
  /** Command that carries the socket's bytes over stdio; `app-server proxy --sock <socketPath>` is appended.
   * Defaults to `codex` on Windows, where Node can't connect to the AF_UNIX socket Codex creates. */
  proxy?: string[];
  mapper: Mapper;
  onEvents(output: AdapterOutput): void | Promise<void>;
  log: (message: string) => void;
  onAvailability?: (available: boolean, reason?: string) => void;
  retryMs?: number;
  pollMs?: number;
  rpcTimeoutMs?: number;
}): { connected(): boolean; close(): Promise<void> } {
  let stopped = false;
  let connected = false;
  let announced: boolean | undefined;
  let ws: WebSocket | undefined;
  let retry: NodeJS.Timeout | undefined;
  let poll: NodeJS.Timeout | undefined;
  let shortPath: Promise<string> | undefined;
  let tempDir: string | undefined;
  let proxyChild: ChildProcess | undefined;
  const proxy = opts.proxy ?? (process.platform === "win32" ? ["codex"] : undefined);
  let nextId = 1;
  const pending = new Map<number, { resolve(value: unknown): void; reject(reason: Error): void; timer: NodeJS.Timeout }>();
  const resumed = new Set<string>();
  const resuming = new Set<string>();
  const closedDuringResume = new Set<string>();
  const duringResume = new Map<string, unknown[]>();
  const transition = (available: boolean, reason = "connection closed") => {
    connected = available;
    if (announced === available) return;
    announced = available;
    opts.log(available ? `codex live: connected to ${opts.socketPath}` :
      `codex live: unavailable (${reason}); Codex sessions use hooks only`);
    opts.onAvailability?.(available, available ? undefined : reason);
  };
  const rpc = (method: string, params: object): Promise<unknown> => new Promise((resolve, reject) => {
    if (ws?.readyState !== WebSocket.OPEN) { reject(new Error("connection closed")); return; }
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`RPC ${method} timed out`));
    }, opts.rpcTimeoutMs ?? 10_000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }), (error) => {
      if (error && pending.delete(id)) { clearTimeout(timer); reject(error); }
    });
  });
  const resume = async (id: string) => {
    if (resumed.has(id) || resuming.has(id) || !connected) return;
    resuming.add(id);
    try {
      const result = await rpc("thread/resume", { threadId: id, excludeTurns: true });
      if (closedDuringResume.has(id)) return;
      if (!result || typeof result !== "object" || !("thread" in result)) return;
      const recovery = opts.mapper.thread(result.thread);
      if (recovery.events.length) await opts.onEvents(recovery);
      resumed.add(id);
      for (const message of duringResume.get(id) ?? []) deliver(message);
    } catch { /* Retry at the next poll. */ }
    finally { duringResume.delete(id); resuming.delete(id); closedDuringResume.delete(id); }
  };
  const discover = async () => {
    if (!connected) return;
    try {
      const result = await rpc("thread/loaded/list", {});
      if (result && typeof result === "object" && "data" in result && Array.isArray(result.data)) {
        await Promise.all(result.data.filter((id): id is string => typeof id === "string").map(resume));
      }
    } catch { /* The connection's close handler will retry, or the next poll will. */ }
  };
  const deliver = (message: unknown) => {
    const output = opts.mapper.map(message);
    if (output.events.length) {
      try {
        void Promise.resolve(opts.onEvents(output)).catch((error: unknown) => opts.log(`codex live: ingest failed (${String(error)})`));
      } catch (error) { opts.log(`codex live: ingest failed (${String(error)})`); }
    }
  };
  const connect = async () => {
    if (stopped) return;
    retry = undefined;
    let path = opts.socketPath;
    try {
      if (proxy) {
        // Spawn only once Codex has created the socket, so a machine without Codex isn't polled with processes.
        if (!socketExists(opts.socketPath)) throw new Error(`no socket at ${opts.socketPath}`);
      } else if (Buffer.byteLength(path) > 100) {
        shortPath ??= (async () => {
          const dir = await mkdtemp(join(tmpdir(), "agentarium-codex-"));
          tempDir = dir;
          const alias = join(dir, "socket");
          await symlink(opts.socketPath, alias);
          return alias;
        })();
        path = await shortPath;
      }
      if (stopped) return;
      let socket: WebSocket;
      if (proxy) {
        const child = spawn(proxy[0]!, [...proxy.slice(1), "app-server", "proxy", "--sock", opts.socketPath],
          { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
        proxyChild = child;
        // Node accepts a { readable, writable } pair here; @types/node only types the web-stream variant.
        const stream = Duplex.from({ readable: child.stdout, writable: child.stdin } as unknown as Duplex);
        child.on("error", (error) => stream.destroy(error));
        socket = new WebSocket("ws://localhost/", { createConnection: () => stream as never });
      } else socket = new WebSocket(`ws+unix://${path}:/`);
      ws = socket;
      let reason = "connection closed";
      socket.on("error", (error) => { reason = error.message; });
      socket.on("message", (data) => {
        let message: unknown;
        try { message = JSON.parse(data.toString()); } catch { return; }
        if (!message || typeof message !== "object") return;
        const msg = message as Record<string, unknown>;
        if (typeof msg.id === "number" && !msg.method && pending.has(msg.id)) {
          const call = pending.get(msg.id)!;
          pending.delete(msg.id);
          clearTimeout(call.timer);
          if (msg.error) call.reject(new Error(JSON.stringify(msg.error)));
          else call.resolve(msg.result);
          return;
        }
        if (msg.method === "thread/closed" && msg.params && typeof msg.params === "object") {
          const id = (msg.params as Record<string, unknown>).threadId;
          if (typeof id === "string") {
            resumed.delete(id);
            if (resuming.has(id)) closedDuringResume.add(id);
          }
        }
        if (msg.method === "thread/started" && msg.params && typeof msg.params === "object") {
          const thread = (msg.params as Record<string, unknown>).thread;
          if (thread && typeof thread === "object") {
            const id = (thread as Record<string, unknown>).id;
            if (typeof id === "string") void resume(id);
          }
        }
        const params = msg.params && typeof msg.params === "object" ? msg.params as Record<string, unknown> : undefined;
        const threadId = params?.threadId;
        if (typeof threadId === "string" && resuming.has(threadId) && msg.method !== "thread/closed") {
          const queued = duringResume.get(threadId) ?? [];
          queued.push(message);
          duringResume.set(threadId, queued);
        } else deliver(message);
        // Server requests are observed only. The TUI answers them.
      });
      socket.on("close", () => {
        if (ws !== socket) return;
        ws = undefined;
        proxyChild?.kill();
        proxyChild = undefined;
        connected = false;
        resumed.clear();
        resuming.clear();
        closedDuringResume.clear();
        duringResume.clear();
        for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error("connection closed")); }
        pending.clear();
        if (poll) clearInterval(poll);
        if (!stopped) {
          transition(false, reason);
          retry ??= setTimeout(() => void connect(), opts.retryMs ?? 5000);
        }
      });
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      await rpc("initialize", { clientInfo: { name: "agentarium", version: "0.1.0" } });
      socket.send(JSON.stringify({ jsonrpc: "2.0", method: "initialized" }));
      transition(true);
      await discover();
      if (connected && !stopped) poll = setInterval(() => void discover(), opts.pollMs ?? 2000);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (!stopped) transition(false, reason);
      ws?.terminate();
      if (!ws) { proxyChild?.kill(); proxyChild = undefined; }
      if (!ws && !stopped) retry ??= setTimeout(() => void connect(), opts.retryMs ?? 5000);
    }
  };
  void connect();
  return {
    connected: () => connected,
    async close() {
      stopped = true;
      if (retry) clearTimeout(retry);
      if (poll) clearInterval(poll);
      ws?.terminate();
      proxyChild?.kill();
      for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error("connection closed")); }
      pending.clear();
      if (shortPath) await shortPath.catch(() => undefined);
      if (tempDir) await rm(tempDir, { recursive: true, force: true });
    },
  };
}
