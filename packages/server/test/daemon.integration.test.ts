import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { SCHEMA_VERSION, createPatchClient, type ServerMessage } from "@agentarium/core";
import { startDaemon, VersionMismatchError, type Daemon } from "../src";

const tmp = (p: string) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const agent = (id = "root", session = "s1") => ({ machine: "m1", provider: "claude-code", session, agent: id });
const ev = (kind: string, extra: object = {}, a = agent()) => ({ schema_version: SCHEMA_VERSION, kind, agent: a, ...extra });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const daemons: Daemon[] = [];
afterEach(async () => {
  await Promise.all(daemons.splice(0).map((d) => d.close()));
});

async function start(dataDir = tmp("agentarium-data-"), extra: Parameters<typeof startDaemon>[0] = {}) {
  const d = await startDaemon({ port: 0, dataDir, flushMs: 10, tickMs: 0, ...extra });
  daemons.push(d);
  return d;
}

const post = (d: Daemon, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`http://127.0.0.1:${d.port}/events`, {
    method: "POST",
    headers: { authorization: `Bearer ${d.token}`, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

/** Raw request so we can set Host, which fetch forbids overriding. */
function rawRequest(port: number, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: "/health", headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
}

function connect(d: Daemon, room?: string) {
  const url = `ws://127.0.0.1:${d.port}/ws?token=${d.token}${room ? `&room=${encodeURIComponent(room)}` : ""}`;
  const ws = new WebSocket(url);
  const messages: ServerMessage[] = [];
  const listeners: (() => void)[] = [];
  ws.on("message", (data) => {
    messages.push(JSON.parse(data.toString()) as ServerMessage);
    listeners.forEach((l) => l());
  });
  const waitFor = (pred: () => boolean, ms = 2000) =>
    new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), ms);
      const check = () => {
        if (pred()) {
          clearTimeout(t);
          resolve();
        }
      };
      listeners.push(check);
      check();
    });
  const opened = new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
    ws.once("unexpected-response", (_req, res) => reject(new Error(`status ${res.statusCode}`)));
  });
  return { ws, messages, waitFor, opened };
}

describe("ingest", () => {
  it("rejects bad token, bad host, bad origin and bad bodies", async () => {
    const d = await start();
    expect((await post(d, { event: ev("prompt") }, { authorization: "Bearer nope" })).status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${d.port}/events`, { method: "POST", body: "{}" })).status).toBe(401);
    expect(await rawRequest(d.port, { host: "evil.example" })).toBe(403);
    expect(await rawRequest(d.port, { host: `127.0.0.1:${d.port}`, origin: "http://evil.example" })).toBe(403);
    expect(await rawRequest(d.port, { host: `localhost:${d.port}` })).toBe(200);
    expect((await post(d, { event: ev("bogus") })).status).toBe(400);
    expect((await post(d, { event: { ...ev("prompt"), schema_version: 99 } })).status).toBe(400);
    expect((await post(d, { event: ev("tool_start", { tool_use_id: "t", tool: "x", category: "nope" }) })).status).toBe(400);
  });

  it("refuses a WebSocket without a valid token", async () => {
    const d = await start();
    const ws = new WebSocket(`ws://127.0.0.1:${d.port}/ws?token=wrong`);
    const status = await new Promise<number>((resolve) => {
      ws.on("unexpected-response", (_r, res) => resolve(res.statusCode ?? 0));
      ws.on("error", () => {});
    });
    expect(status).toBe(401);
  });
});

describe("rooms", () => {
  it("puts a worktree in its main checkout's room and non-git cwd in unassigned", async () => {
    const d = await start();
    const root = tmp("agentarium-repo-");
    const main = join(root, "main");
    const wt = join(root, "wt");
    const wtGit = join(main, ".git", "worktrees", "wt");
    mkdirSync(wtGit, { recursive: true });
    mkdirSync(wt);
    writeFileSync(join(wtGit, "commondir"), "../..\n");
    writeFileSync(join(wt, ".git"), `gitdir: ${wtGit}\n`);

    const a = await (await post(d, { cwd: main, event: ev("session_start") })).json();
    const b = await (await post(d, { cwd: wt, event: ev("session_start", {}, agent("root", "s2")) })).json();
    const c = await (await post(d, { cwd: tmp("agentarium-plain-"), event: ev("session_start", {}, agent("root", "s3")) })).json();
    expect(a.room).toBe(b.room);
    expect(c.room).toBe("unassigned");
    expect(Object.keys(d.world(a.room).agents)).toHaveLength(2);
  });
});

describe("websocket", () => {
  it("sends a snapshot, then coalesced sequenced patches that converge to the daemon's world", async () => {
    const d = await start(undefined, { flushMs: 30 });
    const first = await (await post(d, { event: ev("session_start") })).json();
    const room = first.room as string;
    await sleep(40); // let the first event's patch flush before any client connects
    const client = connect(d, room);
    await client.opened;
    await client.waitFor(() => client.messages.length >= 1);
    expect(client.messages[0]?.type).toBe("snapshot");

    // A burst inside one flush window must coalesce into a single patch.
    await Promise.all([
      post(d, { event: ev("prompt") }),
      post(d, { event: ev("tool_start", { tool_use_id: "t1", tool: "Read", category: "read" }) }),
      post(d, { event: ev("tool_start", { tool_use_id: "t2", tool: "Grep", category: "search" }, agent("sub")) }),
    ]);
    await client.waitFor(() => client.messages.length >= 2);
    await sleep(60);
    expect(client.messages.filter((m) => m.type === "patch")).toHaveLength(1);

    const pc = createPatchClient();
    for (const m of client.messages) expect(pc.handle(m)).toBe("ok");
    expect(pc.world.agents).toEqual(d.world(room).agents);
    client.ws.close();
  });

  it("detects a gap, resyncs and converges", async () => {
    const d = await start();
    const room = ((await (await post(d, { event: ev("session_start") })).json()) as { room: string }).room;
    const client = connect(d, room);
    await client.opened;
    await client.waitFor(() => client.messages.length >= 1);

    const pc = createPatchClient();
    let handled = 0;
    let gaps = 0;
    const drain = () => {
      while (handled < client.messages.length) {
        const m = client.messages[handled++]!;
        if (m.type === "patch" && m.seq === 2) continue; // simulate a lost patch
        if (pc.handle(m) === "gap") {
          gaps++;
          client.ws.send(JSON.stringify({ type: "resync" }));
        }
      }
    };

    drain();
    for (const [i, kind] of (["prompt", "stop", "prompt"] as const).entries()) {
      await post(d, { event: ev(kind) });
      await sleep(40);
      drain();
      expect(i).toBeGreaterThanOrEqual(0);
    }
    await client.waitFor(() => {
      drain();
      return gaps > 0 && pc.seq === client.messages.at(-1)?.seq;
    });
    expect(gaps).toBeGreaterThan(0);
    expect(pc.world.agents).toEqual(d.world(room).agents);
    client.ws.close();
  });
});

describe("lifecycle", () => {
  it("rebuilds state from the log after a restart", async () => {
    const dataDir = tmp("agentarium-restart-");
    const d1 = await start(dataDir);
    const room = ((await (await post(d1, { event: ev("tool_start", { tool_use_id: "t", tool: "Bash", category: "exec" }) })).json()) as { room: string }).room;
    const before = d1.world(room);
    await d1.close();
    const d2 = await start(dataDir);
    expect(d2.world(room)).toEqual(before);
  });

  it("refuses to start next to a daemon of a different version", async () => {
    const d = await start(undefined, { version: "1.0.0" });
    await expect(startDaemon({ port: d.port, dataDir: tmp("agentarium-data-"), version: "2.0.0" })).rejects.toBeInstanceOf(
      VersionMismatchError,
    );
    await expect(startDaemon({ port: d.port, dataDir: tmp("agentarium-data-"), version: "2.0.0" })).rejects.toThrow(/agentarium stop/);
  });
});

describe("claude code hook endpoint", () => {
  it("accepts raw hook payloads and always answers 204", async () => {
    const d = await start();
    const hook = (body: string, token = d.token) =>
      fetch(`http://127.0.0.1:${d.port}/hooks/claude-code`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body,
      });
    const cwd = tmp("agentarium-hook-");
    const payload = { session_id: "s9", hook_event_name: "UserPromptSubmit", cwd };
    expect((await hook(JSON.stringify(payload))).status).toBe(204);
    expect((await hook("not json")).status).toBe(204);
    expect((await hook("{}")).status).toBe(204);
    expect((await hook(JSON.stringify(payload), "bad")).status).toBe(401);
    expect(Object.keys(d.world("unassigned").agents)).toHaveLength(1);
  });
});

describe("static UI hosting", () => {
  it("serves files and index fallback, refuses traversal, honours extra origins", async () => {
    const ui = tmp("agentarium-ui-");
    writeFileSync(join(ui, "index.html"), "<h1>hi</h1>");
    writeFileSync(join(ui, "app.js"), "1");
    const d = await start(undefined, { staticDir: ui, allowedOrigins: ["http://localhost:5173"] });
    const base = `http://127.0.0.1:${d.port}`;
    expect(await (await fetch(`${base}/`)).text()).toBe("<h1>hi</h1>");
    expect((await fetch(`${base}/app.js`)).headers.get("content-type")).toMatch(/javascript/);
    expect(await (await fetch(`${base}/some/route`)).text()).toBe("<h1>hi</h1>");
    expect((await fetch(`${base}/missing.png`)).status).toBe(404);
    expect(await rawRequest(d.port, { host: `127.0.0.1:${d.port}`, origin: "http://localhost:5173" })).toBe(200);
    expect(await rawRequest(d.port, { host: `127.0.0.1:${d.port}`, origin: "http://evil.example" })).toBe(403);
  });
});
