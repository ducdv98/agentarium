import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { extname, join, normalize, sep } from "node:path";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { createClaudeCodeAdapter, createCodexAdapter, createCodexLiveMapper, createOutcomeGate, type AdapterOutput } from "@agentarium/adapters";
import {
  DEFAULT_TIMEOUTS,
  SCHEMA_VERSION,
  agentKey,
  diffWorld,
  emptyWorld,
  reduce,
  replay,
  type AgentEvent,
  type AgentRef,
  type ClientMessage,
  type RoomSummary,
  type RoomsMessage,
  type NewEvent,
  type ServerMessage,
  type Timeouts,
  type WorldState,
} from "@agentarium/core";
import { WebSocket, WebSocketServer } from "ws";
import { parseIngest } from "./ingest";
import { UNASSIGNED_ROOM, resolveRoom } from "./rooms";
import { jsonlLog, type EventLog } from "./storage";
import { DAEMON_VERSION, DEFAULT_PORT } from "./version";
import { startCodexLive } from "./codex-live";
import { readCodexSessionMeta, findCodexRollout } from "./codex-rollouts";
import { codexOtelOutcomes } from "./codex-otel";

export interface DaemonOptions {
  port?: number;
  /** Directory for the default JSON-lines log. Ignored when `storage` is given. */
  dataDir?: string;
  storage?: EventLog;
  token?: string;
  version?: string;
  /** Directory of a built UI to serve at `/`. */
  staticDir?: string;
  /** Extra browser origins allowed besides the daemon's own (e.g. a dev server). */
  allowedOrigins?: string[];
  /** Machine id stamped on agent identities (default: the host name). */
  machine?: string;
  /** Interval for idle/lost timeout ticks; 0 disables. */
  tickMs?: number;
  /** Patch coalescing window. */
  flushMs?: number;
  timeouts?: Timeouts;
  clock?: () => number;
  /** Client socket buffer size above which patches are skipped in favour of a later snapshot. */
  maxBufferedBytes?: number;
  codexControlSocket?: string;
  codexHome?: string;
  log?: (message: string) => void;
}

export interface Daemon {
  port: number;
  token: string;
  /** Current world for a room (for tests and diagnostics). */
  world(room: string): WorldState;
  close(): Promise<void>;
}

export class VersionMismatchError extends Error {
  constructor(
    readonly running: string,
    readonly wanted: string,
  ) {
    super(
      `An agentarium daemon v${running} is already running on this port (this is v${wanted}). Run "agentarium stop" first.`,
    );
    this.name = "VersionMismatchError";
  }
}

export class AlreadyRunningError extends Error {
  constructor(readonly version: string) {
    super(`An agentarium daemon v${version} is already running on this port.`);
    this.name = "AlreadyRunningError";
  }
}

const MAX_BODY = 1_000_000;

interface Client {
  ws: WebSocket;
  room: Room;
  /** Missed a patch because of backpressure; owed a fresh snapshot. */
  stale: boolean;
}

interface Room {
  id: string;
  world: WorldState;
  /** What clients have been sent so far; patches are diffs against this. */
  sent: WorldState;
  seq: number;
  dirty: boolean;
  lastActive: number;
  clients: Set<Client>;
}

export async function startDaemon(opts: DaemonOptions = {}): Promise<Daemon> {
  const version = opts.version ?? DAEMON_VERSION;
  const token = opts.token ?? randomBytes(24).toString("hex");
  const storage = opts.storage ?? jsonlLog(requireDir(opts.dataDir));
  const timeouts = opts.timeouts ?? DEFAULT_TIMEOUTS;
  const clock = opts.clock ?? Date.now;
  const flushMs = opts.flushMs ?? 50;
  const tickMs = opts.tickMs ?? 5_000;
  const maxBuffered = opts.maxBufferedBytes ?? 1_000_000;

  const claudeCode = createClaudeCodeAdapter({ machine: opts.machine ?? hostname() });
  const codexHome = opts.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex");
  const codex = createCodexAdapter({ machine: opts.machine ?? hostname(), lineage: (id, path) => {
    const atPath = path ? readCodexSessionMeta(path) : null;
    return atPath?.threadId === id ? atPath : findCodexRollout(codexHome, id);
  } });
  const outcomeGate = createOutcomeGate();
  const threads = new Map<string, { agent: AgentRef; roomId?: string; cwd?: string }>();

  const rooms = new Map<string, Room>();
  const getRoom = (id: string): Room => {
    let room = rooms.get(id);
    if (!room) {
      room = {
        id,
        world: emptyWorld(),
        sent: emptyWorld(),
        seq: 0,
        dirty: false,
        lastActive: 0,
        clients: new Set(),
      };
      rooms.set(id, room);
    }
    return room;
  };
  const defaultRoom = (): Room => {
    let best: Room | undefined;
    for (const r of rooms.values()) if (!best || r.lastActive > best.lastActive) best = r;
    return best ?? getRoom(UNASSIGNED_ROOM);
  };

  for (const id of await storage.rooms()) {
    const room = getRoom(id);
    const events = await storage.read(id);
    room.world = room.sent = replay(events, timeouts);
    for (const event of events) if ("agent" in event && event.agent.provider === "codex") {
      const threadId = event.agent.agent === "root" ? event.agent.session : event.agent.agent;
      threads.set(threadId, { agent: event.agent, roomId: id });
    }
    room.lastActive = room.world.now;
  }

  // Appends are chained so the log order always matches the order events were reduced.
  let appendQueue: Promise<unknown> = Promise.resolve();
  const enqueueAppend = (room: string, event: AgentEvent): Promise<unknown> =>
    (appendQueue = appendQueue.then(() => storage.append(room, event)));

  const send = (c: Client, msg: ServerMessage | RoomsMessage): void => {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
  };
  const snapshot = (room: Room): ServerMessage => ({
    type: "snapshot",
    room: room.id,
    seq: room.seq,
    world: room.sent,
  });

  const allClients = new Set<Client>();
  const summaries = (): RoomSummary[] =>
    [...rooms.values()]
      .map((r) => {
        const live = Object.values(r.world.agents).filter((a) => a.status !== "lost");
        return {
          id: r.id,
          agents: live.length,
          waiting: live.filter((a) => a.status === "waiting").length,
          lastActive: r.lastActive,
        };
      })
      .filter((r) => r.agents > 0)
      .sort((a, b) => b.lastActive - a.lastActive);
  const roomsMessage = (): RoomsMessage => ({ type: "rooms", rooms: summaries() });
  /** lastActive changes on every event, so it is left out when deciding whether anything is news. */
  const roomsKey = (m: RoomsMessage): string =>
    JSON.stringify(m.rooms.map(({ lastActive: _l, ...rest }) => rest));
  let lastRoomsKey = "";

  let flushTimer: NodeJS.Timeout | null = null;
  const flush = (): void => {
    flushTimer = null;
    for (const room of rooms.values()) {
      if (!room.dirty) continue;
      room.dirty = false;
      const patch = diffWorld(room.sent, room.world);
      if (patch.upserts.length === 0 && patch.removed.length === 0) continue;
      room.sent = room.world;
      room.seq += 1;
      const msg: ServerMessage = { type: "patch", room: room.id, seq: room.seq, patch };
      for (const c of room.clients) {
        if (c.ws.bufferedAmount > maxBuffered) {
          c.stale = true;
        } else if (c.stale) {
          c.stale = false;
          send(c, snapshot(room));
        } else {
          send(c, msg);
        }
      }
    }
    const announce = roomsMessage();
    const key = roomsKey(announce);
    if (key !== lastRoomsKey) {
      lastRoomsKey = key;
      for (const c of allClients) send(c, announce);
    }
  };
  const markDirty = (room: Room): void => {
    room.dirty = true;
    flushTimer ??= setTimeout(flush, flushMs);
  };

  const tickTimer =
    tickMs > 0
      ? setInterval(() => {
          const ts = clock();
          for (const room of rooms.values()) {
            const next = reduce(room.world, { schema_version: SCHEMA_VERSION, kind: "tick", ts }, timeouts);
            if (diffWorld(room.world, next).upserts.length > 0) {
              room.world = next;
              markDirty(room);
            }
          }
        }, tickMs)
      : null;

  const server = createServer();
  const wss = new WebSocketServer({ noServer: true });
  let boundPort = 0;

  const hostOk = (req: IncomingMessage): boolean => {
    const allowed = [`127.0.0.1:${boundPort}`, `localhost:${boundPort}`];
    const host = req.headers.host;
    if (!host || !allowed.includes(host.toLowerCase())) return false;
    const origin = req.headers.origin;
    if (origin === undefined) return true;
    const o = origin.toLowerCase();
    return allowed.some((h) => o === `http://${h}`) || (opts.allowedOrigins ?? []).includes(o);
  };
  const tokenOk = (given: string | undefined): boolean => {
    if (!given) return false;
    const a = Buffer.from(given);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const headerToken = (req: IncomingMessage): string | undefined => {
    const auth = req.headers.authorization;
    const x = req.headers["x-agentarium-token"];
    return auth?.startsWith("Bearer ") ? auth.slice(7) : Array.isArray(x) ? x[0] : x;
  };
  const reply = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  };

  /** Stamps, reduces and logs one event; returns the room it landed in. */
  async function ingest(cwd: string | undefined, newEvent: NewEvent, roomId?: string): Promise<Room> {
    const event = { ...newEvent, ts: clock() } as AgentEvent;
    const room = getRoom(roomId ?? resolveRoom(cwd));
    room.world = reduce(room.world, event, timeouts);
    room.lastActive = event.ts;
    markDirty(room);
    await enqueueAppend(room.id, event);
    return room;
  }

  const codexLive = opts.codexControlSocket ? startCodexLive({
    socketPath: opts.codexControlSocket,
    mapper: createCodexLiveMapper({ machine: opts.machine ?? hostname(),
      onThread: (id, agent, cwd) => threads.set(id, { agent, cwd }),
      onUnknownOutcome: (id, status) => (opts.log ?? console.log)(`codex live: unknown outcome ${id}: ${String(status)}`) }),
    onEvents: async ({ cwd, events }) => {
      for (const event of events) if (outcomeGate("live", event)) await ingest(cwd, event);
    },
    log: opts.log ?? console.log,
  }) : undefined;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!hostOk(req)) return reply(res, 403, { error: "forbidden host or origin" });
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/health") {
      return reply(res, 200, { app: "agentarium", version, pid: process.pid, codexLive: codexLive?.connected() ?? false });
    }
    if (req.method === "POST" && url.pathname === "/events") {
      if (!tokenOk(headerToken(req))) return reply(res, 401, { error: "unauthorized" });
      const raw = await readBody(req);
      if (raw === null) return reply(res, 413, { error: "body too large" });
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        return reply(res, 400, { error: "invalid JSON" });
      }
      const parsed = parseIngest(body);
      if (typeof parsed === "string") return reply(res, 400, { error: parsed });
      const room = await ingest(parsed.cwd, parsed.event);
      return reply(res, 202, { room: room.id });
    }
    if (req.method === "POST" && url.pathname === "/otel/v1/logs") {
      if (!tokenOk(req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : undefined))
        return reply(res, 401, { error: "unauthorized" });
      if (!/^application\/json(?:\s*;|\s*$)/i.test(req.headers["content-type"] ?? ""))
        return reply(res, 415, { error: "JSON required" });
      const raw = await readBody(req);
      if (raw === null) return reply(res, 413, { error: "body too large" });
      let body: unknown;
      try { body = JSON.parse(raw); } catch { return reply(res, 400, { error: "invalid JSON" }); }
      for (const event of codexOtelOutcomes(body, (id) => threads.get(id)?.agent)) {
        const location = threads.get(event.agent.agent === "root" ? event.agent.session : event.agent.agent);
        // OTel is batched and can land after the turn ended; a failure only matters while the call is still open.
        const room = getRoom(location?.roomId ?? resolveRoom(location?.cwd));
        if (event.kind !== "tool_end" || !room.world.agents[agentKey(event.agent)]?.pending[event.tool_use_id]) continue;
        if (outcomeGate("otel", event)) await ingest(location?.cwd, event, room.id);
      }
      return reply(res, 200, {});
    }
    if (req.method === "POST" && (url.pathname === "/hooks/claude-code" || url.pathname === "/hooks/codex")) {
      if (!tokenOk(headerToken(req))) return reply(res, 401, { error: "unauthorized" });
      const raw = await readBody(req);
      // Hooks must never disturb the agent: answer 204 whatever the payload turns out to be.
      let payload: unknown;
      try {
        payload = raw === null ? null : JSON.parse(raw);
      } catch {
        payload = null;
      }
      const adapter: { map(payload: unknown): AdapterOutput } = url.pathname === "/hooks/codex" ? codex : claudeCode;
      const { cwd, events } = adapter.map(payload);
      if (url.pathname === "/hooks/codex" && payload && typeof payload === "object") {
        const p = payload as Record<string, unknown>;
        if (typeof p.session_id === "string") {
          const id = typeof p.agent_id === "string" ? p.agent_id : p.session_id;
          threads.set(id, { agent: { machine: opts.machine ?? hostname(), provider: "codex", session: p.session_id,
            agent: id === p.session_id ? "root" : id }, cwd });
        }
      }
      for (const event of events) if (url.pathname !== "/hooks/codex" || outcomeGate("hook", event)) await ingest(cwd, event);
      res.writeHead(204).end();
      return;
    }
    if (req.method === "GET" && opts.staticDir && (await serveStatic(opts.staticDir, url.pathname, res))) return;
    return reply(res, 404, { error: "not found" });
  }

  server.on("request", (req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) reply(res, 500, { error: "internal error" });
      else res.end();
    });
  });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const refuse = (status: string): void => {
      socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    };
    if (url.pathname !== "/ws") return refuse("404 Not Found");
    if (!hostOk(req)) return refuse("403 Forbidden");
    if (!tokenOk(url.searchParams.get("token") ?? headerToken(req))) return refuse("401 Unauthorized");
    wss.handleUpgrade(req, socket, head, (ws) => {
      const requested = url.searchParams.get("room");
      const room = (requested ? rooms.get(requested) : undefined) ?? defaultRoom();
      const client: Client = { ws, room, stale: false };
      room.clients.add(client);
      allClients.add(client);
      const leave = (): void => {
        client.room.clients.delete(client);
        allClients.delete(client);
      };
      ws.on("close", leave);
      ws.on("error", leave);
      ws.on("message", (data) => {
        let msg: ClientMessage | undefined;
        try {
          msg = JSON.parse(data.toString()) as ClientMessage;
        } catch {
          return;
        }
        if (msg?.type === "resync") {
          send(client, snapshot(client.room));
        } else if (msg?.type === "join") {
          const target = rooms.get(msg.room);
          if (!target) return;
          client.room.clients.delete(client);
          client.room = target;
          client.stale = false;
          target.clients.add(client);
          send(client, snapshot(target));
        }
      });
      send(client, snapshot(room));
      send(client, roomsMessage());
    });
  });

  boundPort = await listen(server, opts.port ?? DEFAULT_PORT, version);

  return {
    port: boundPort,
    token,
    world: (room) => getRoom(room).world,
    async close() {
      await codexLive?.close();
      if (tickTimer) clearInterval(tickTimer);
      if (flushTimer) clearTimeout(flushTimer);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await appendQueue;
    },
  };
}

function requireDir(dir: string | undefined): string {
  if (!dir) throw new Error("startDaemon needs `dataDir` or `storage`");
  return dir;
}

/** Resolves to the body text, or null when it exceeds the size limit. */
function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooBig = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) tooBig = true;
      else chunks.push(chunk);
    });
    req.on("end", () => resolve(tooBig ? null : Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Listens on 127.0.0.1 only. On a busy port, probes /health to say who is there. */
async function listen(server: Server, port: number, version: string): Promise<number> {
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
    const running = await probe(port);
    if (running === null) throw err;
    if (running !== version) throw new VersionMismatchError(running, version);
    throw new AlreadyRunningError(running);
  }
  const addr = server.address();
  return typeof addr === "object" && addr ? addr.port : port;
}

async function probe(port: number): Promise<string | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1_000) });
    const body = (await res.json()) as { app?: unknown; version?: unknown };
    return body.app === "agentarium" && typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  }
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

/** Serves a file under `root`; extensionless paths fall back to index.html (SPA). Returns false when nothing matched. */
async function serveStatic(root: string, pathname: string, res: ServerResponse): Promise<boolean> {
  let rel: string;
  try {
    rel = normalize(decodeURIComponent(pathname));
  } catch {
    return false;
  }
  if (rel.split(sep).includes("..")) return false;
  const wanted = rel === sep || rel === "/" ? "index.html" : rel;
  const candidates = extname(wanted) ? [wanted] : ["index.html"];
  for (const c of candidates) {
    try {
      const body = await readFile(join(root, c));
      res.writeHead(200, { "content-type": MIME[extname(c)] ?? "application/octet-stream" }).end(body);
      return true;
    } catch {
      // try next
    }
  }
  return false;
}
