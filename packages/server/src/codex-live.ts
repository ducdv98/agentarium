import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import type { AdapterOutput } from "@agentarium/adapters";

interface Mapper {
  thread(thread: unknown): void;
  map(message: unknown): AdapterOutput;
}

export function startCodexLive(opts: {
  socketPath: string;
  mapper: Mapper;
  onEvents(output: AdapterOutput): void | Promise<void>;
  log: (message: string) => void;
  retryMs?: number;
  pollMs?: number;
}): { connected(): boolean; close(): Promise<void> } {
  let stopped = false;
  let connected = false;
  let announced: boolean | undefined;
  let ws: WebSocket | undefined;
  let retry: NodeJS.Timeout | undefined;
  let poll: NodeJS.Timeout | undefined;
  const tempDirs = new Set<string>();
  let nextId = 1;
  const pending = new Map<number, { resolve(value: unknown): void; reject(reason: Error): void }>();
  const resumed = new Set<string>();
  const resuming = new Set<string>();
  const duringResume = new Map<string, unknown[]>();
  const transition = (available: boolean, reason = "connection closed") => {
    connected = available;
    if (announced === available) return;
    announced = available;
    opts.log(available ? `codex live: connected to ${opts.socketPath}` :
      `codex live: unavailable (${reason}); Codex sessions use hooks only`);
  };
  const rpc = (method: string, params: object): Promise<unknown> => new Promise((resolve, reject) => {
    if (ws?.readyState !== WebSocket.OPEN) { reject(new Error("connection closed")); return; }
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }), (error) => {
      if (error) { pending.delete(id); reject(error); }
    });
  });
  const resume = async (id: string) => {
    if (resumed.has(id) || resuming.has(id) || !connected) return;
    resuming.add(id);
    try {
      const result = await rpc("thread/resume", { threadId: id, excludeTurns: true });
      if (!result || typeof result !== "object" || !("thread" in result)) return;
      opts.mapper.thread(result.thread);
      resumed.add(id);
      for (const message of duringResume.get(id) ?? []) deliver(message);
    } catch { /* Retry at the next poll. */ }
    finally { duringResume.delete(id); resuming.delete(id); }
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
      if (Buffer.byteLength(path) > 100) {
        const dir = await mkdtemp(join(tmpdir(), "agentarium-codex-"));
        tempDirs.add(dir);
        path = join(dir, "socket");
        await symlink(opts.socketPath, path);
      }
      if (stopped) {
        await Promise.all([...tempDirs].map((dir) => rm(dir, { recursive: true, force: true })));
        tempDirs.clear();
        return;
      }
      const socket = new WebSocket(`ws+unix://${path}:/`);
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
          if (msg.error) call.reject(new Error(JSON.stringify(msg.error)));
          else call.resolve(msg.result);
          return;
        }
        if (msg.method === "thread/closed" && msg.params && typeof msg.params === "object") {
          const id = (msg.params as Record<string, unknown>).threadId;
          if (typeof id === "string") resumed.delete(id);
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
        if (typeof threadId === "string" && resuming.has(threadId)) {
          const queued = duringResume.get(threadId) ?? [];
          queued.push(message);
          duringResume.set(threadId, queued);
        } else deliver(message);
        // Server requests are observed only. The TUI answers them.
      });
      socket.on("close", () => {
        if (ws !== socket) return;
        ws = undefined;
        connected = false;
        resumed.clear();
        resuming.clear();
        duringResume.clear();
        for (const call of pending.values()) call.reject(new Error("connection closed"));
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
      for (const call of pending.values()) call.reject(new Error("connection closed"));
      pending.clear();
      await Promise.all([...tempDirs].map((dir) => rm(dir, { recursive: true, force: true })));
      tempDirs.clear();
    },
  };
}
