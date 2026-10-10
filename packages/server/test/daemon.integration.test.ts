import { mkdirSync, mkdtempSync, realpathSync, readFileSync, writeFileSync } from "node:fs";
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
  const roomLists: { id: string }[][] = [];
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString()) as ServerMessage | { type: "rooms"; rooms: { id: string }[] };
    if (msg.type === "rooms") roomLists.push(msg.rooms);
    else messages.push(msg);
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
  return { ws, messages, roomLists, waitFor, opened };
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
    const room = ((await (await post(d1, { event: ev("tool_start", { tool_use_id: "t", tool: "Bash", category: "exec", permission_mode: "plan" }) })).json()) as { room: string }).room;
    const before = d1.world(room);
    expect(before.agents["m1:claude-code:s1:root"]?.permissionMode).toBe("plan");
    await d1.close();
    const d2 = await start(dataDir);
    expect(d2.world(room).agents).toEqual(before.agents);
    expect(d2.world(room).now).toBeGreaterThanOrEqual(before.now);
  });

  it("times out a stale pending call during restart replay", async () => {
    const dataDir = tmp("agentarium-aged-restart-");
    let now = 1_000;
    const options = { clock: () => now, timeouts: { idleMs: 10, lostMs: 100, waitingLostMs: 200 } };
    const d1 = await start(dataDir, options);
    const room = ((await (await post(d1, { event: ev("tool_start", {
      tool_use_id: "old", tool: "Bash", category: "exec",
    }) })).json()) as { room: string }).room;
    await d1.close();
    daemons.splice(daemons.indexOf(d1), 1);
    now = 1_500;
    const d2 = await start(dataDir, options);
    expect(Object.values(d2.world(room).agents)[0]).toMatchObject({ status: "lost", pending: {} });
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
    const payload = { session_id: "s9", hook_event_name: "UserPromptSubmit", cwd, permission_mode: "dontAsk" };
    expect((await hook(JSON.stringify(payload))).status).toBe(204);
    expect((await hook("not json")).status).toBe(204);
    expect((await hook("{}")).status).toBe(204);
    expect((await hook(JSON.stringify(payload), "bad")).status).toBe(401);
    expect(Object.keys(d.world("unassigned").agents)).toHaveLength(1);
    expect(Object.values(d.world("unassigned").agents)[0]?.permissionMode).toBe("dontAsk");
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

describe("rooms announcements and join", () => {
  it("announces new rooms to connected clients and lets a client join one", async () => {
    const d = await start();
    const a = tmp("agentarium-roomA-");
    const b = tmp("agentarium-roomB-");
    mkdirSync(join(a, ".git"));
    mkdirSync(join(b, ".git"));
    const client = connect(d); // connects before any room exists
    await client.opened;
    await client.waitFor(() => client.messages.length >= 1 && client.roomLists.length >= 1);

    const roomB = ((await (await post(d, { cwd: b, event: ev("prompt", {}, agent("root", "sB")) })).json()) as { room: string }).room;
    await client.waitFor(() => client.roomLists.some((l) => l.some((r) => r.id === roomB)));

    client.ws.send(JSON.stringify({ type: "join", room: roomB }));
    await client.waitFor(() => client.messages.some((m) => m.type === "snapshot" && m.room === roomB));
    client.ws.send(JSON.stringify({ type: "join", room: "nope" })); // unknown rooms are ignored
    await post(d, { cwd: a, event: ev("prompt", {}, agent("root", "sA")) });
    await sleep(60);
    const last = client.messages.filter((m) => m.type === "snapshot").at(-1);
    expect(last).toMatchObject({ room: roomB });
    client.ws.close();
  });
});


describe("Codex hooks", () => {
  it("ingests fixture payloads into a codex agent", async () => {
    const d = await start();
    const fx = JSON.parse(readFileSync(join(__dirname, "../../../spikes/fixtures/codex/exec-fail.json"), "utf8")) as { hooks: Record<string, unknown>[] };
    for (const payload of fx.hooks.slice(0, 3)) {
      const res = await fetch(`http://127.0.0.1:${d.port}/hooks/codex`, {
        method: "POST", headers: { authorization: `Bearer ${d.token}` }, body: JSON.stringify(payload),
      });
      expect(res.status).toBe(204);
    }
    const room = d.world("unassigned");
    expect(Object.values(room.agents).some((a) => a.ref.provider === "codex" && a.category === "exec")).toBe(true);
  });
  it("correlates OTel failures to hook calls and rejects unauthenticated or non-JSON logs", async () => {
    const d = await start();
    const fx = JSON.parse(readFileSync(join(__dirname, "../../../spikes/fixtures/codex/otel.json"), "utf8")) as { hooks: Record<string, unknown>[]; otel: unknown[] };
    const hook = (body: unknown) => fetch(`http://127.0.0.1:${d.port}/hooks/codex`, {
      method: "POST", headers: { authorization: `Bearer ${d.token}` }, body: JSON.stringify(body),
    });
    const otel = (body: unknown, headers: Record<string, string> = {}) => fetch(`http://127.0.0.1:${d.port}/otel/v1/logs`, {
      method: "POST", headers: { authorization: `Bearer ${d.token}`, "content-type": "application/json", ...headers }, body: JSON.stringify(body),
    });
    expect((await otel({}, { authorization: "Bearer wrong" })).status).toBe(401);
    expect((await otel({}, { "content-type": "text/plain" })).status).toBe(415);
    for (const payload of fx.hooks.filter((h) => h.hook_event_name !== "Stop" && h.hook_event_name !== "SessionEnd"))
      expect((await hook(payload)).status).toBe(204);
    const before = d.world("unassigned");
    const root = () => Object.values(d.world("unassigned").agents)[0]!;
    expect(root().pending).toHaveProperty("exec-8f253fe4-c052-431c-82a5-0a88ccd383a4");
    for (const body of fx.otel) expect((await otel(body)).status).toBe(200);
    expect(root().status).toBe("blocked");
    expect(root().category).toBe("error");
    expect(root().pending).not.toHaveProperty("exec-8f253fe4-c052-431c-82a5-0a88ccd383a4");
    expect(before.agents[root().key]?.status).toBe("working");
    const after = d.world("unassigned");
    for (const body of fx.otel) await otel(body);
    expect(d.world("unassigned")).toEqual(after);
    await hook(fx.hooks.find((h) => h.hook_event_name === "Stop"));
    expect(root().status).toBe("idle");
  });
  it("ignores an OTel failure that arrives after the call was cleared", async () => {
    const d = await start();
    const fx = JSON.parse(readFileSync(join(__dirname, "../../../spikes/fixtures/codex/otel.json"), "utf8")) as { hooks: Record<string, unknown>[]; otel: unknown[] };
    for (const payload of fx.hooks.filter((h) => h.hook_event_name !== "SessionEnd")) {
      await fetch(`http://127.0.0.1:${d.port}/hooks/codex`, { method: "POST", headers: { authorization: `Bearer ${d.token}` }, body: JSON.stringify(payload) });
    }
    const idle = d.world("unassigned");
    expect(Object.values(idle.agents)[0]?.status).toBe("idle");
    for (const body of fx.otel) {
      await fetch(`http://127.0.0.1:${d.port}/otel/v1/logs`, {
        method: "POST", headers: { authorization: `Bearer ${d.token}`, "content-type": "application/json" }, body: JSON.stringify(body),
      });
    }
    expect(d.world("unassigned")).toEqual(idle);
  });
  it("restores Codex identity and activity exactly from the event log", async () => {
    const dir = tmp("codex-restart-");
    const d = await start(dir, { machine: "m" });
    const fx = JSON.parse(readFileSync(join(__dirname, "../../../spikes/fixtures/codex/subagents.json"), "utf8")) as { hooks: Record<string, unknown>[] };
    for (const payload of fx.hooks.slice(0, 10)) await fetch(`http://127.0.0.1:${d.port}/hooks/codex`, {
      method: "POST", headers: { authorization: `Bearer ${d.token}` }, body: JSON.stringify(payload),
    });
    const prior = d.world("unassigned");
    await d.close();
    daemons.splice(daemons.indexOf(d), 1);
    const restarted = await start(dir, { machine: "m" });
    expect(restarted.world("unassigned").agents).toEqual(prior.agents);
    expect(restarted.world("unassigned").now).toBeGreaterThanOrEqual(prior.now);
    expect(Object.values(prior.agents).some((a) => a.ref.provider === "codex" && a.ref.agent !== "root")).toBe(true);
  });
  it("ends a restored Codex sub-agent on the root SessionEnd hook", async () => {
    const dir = tmp("codex-child-restart-");
    const d1 = await start(dir, { machine: "m" });
    const child = { machine: "m", provider: "codex", session: "s", agent: "child" };
    await post(d1, { event: { schema_version: SCHEMA_VERSION, kind: "spawn", agent: child,
      parent: { ...child, agent: "root" }, provenance: "inferred" } });
    await d1.close();
    daemons.splice(daemons.indexOf(d1), 1);
    const d2 = await start(dir, { machine: "m" });
    const response = await fetch(`http://127.0.0.1:${d2.port}/hooks/codex`, {
      method: "POST", headers: { authorization: `Bearer ${d2.token}` },
      body: JSON.stringify({ session_id: "s", hook_event_name: "SessionEnd" }),
    });
    expect(response.status).toBe(204);
    expect(Object.values(d2.world("unassigned").agents).find((agent) => agent.ref.agent === "child")?.status).toBe("done");
  });
  it("keeps a replayed thread room when a later hook has no cwd", async () => {
    const dir = tmp("codex-thread-room-");
    const project = join(dir, "project");
    mkdirSync(project);
    mkdirSync(join(project, ".git"));
    const d1 = await start(join(dir, "data"), { machine: "m" });
    const codexRoot = { machine: "m", provider: "codex", session: "s", agent: "root" };
    const room = ((await (await post(d1, { cwd: project, event: ev("tool_start", {
      tool_use_id: "t", tool: "Bash", category: "exec",
    }, codexRoot) })).json()) as { room: string }).room;
    await d1.close();
    daemons.splice(daemons.indexOf(d1), 1);
    const d2 = await start(join(dir, "data"), { machine: "m" });
    await fetch(`http://127.0.0.1:${d2.port}/hooks/codex`, {
      method: "POST", headers: { authorization: `Bearer ${d2.token}` },
      body: JSON.stringify({ session_id: "s", hook_event_name: "PreCompact" }),
    });
    const attr = (key: string, value: string) => ({ key, value: { stringValue: value } });
    const outcome = { resourceLogs: [{ scopeLogs: [{ logRecords: [{ attributes: [
      attr("event.name", "codex.tool_result"), attr("conversation.id", "s"),
      attr("call_id", "t"), attr("success", "false"),
    ] }] }] }] };
    const response = await fetch(`http://127.0.0.1:${d2.port}/otel/v1/logs`, {
      method: "POST", headers: { authorization: `Bearer ${d2.token}`, "content-type": "application/json" },
      body: JSON.stringify(outcome),
    });
    expect(response.status).toBe(200);
    expect(Object.values(d2.world(room).agents)[0]?.status).toBe("blocked");
  });
});
