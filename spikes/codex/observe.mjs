#!/usr/bin/env node
// Spike: join the shared app-server daemon's control socket (JSON-RPC over WebSocket) as a
// second client, rejoin every loaded thread, and print what an observer receives.
// Never answers approval requests. Socket paths over 108 bytes need a shorter symlink.
// Usage: node observe.mjs <app-server-control.sock> <seconds>
import { createRequire } from "node:module";

const { WebSocket } = createRequire(new URL("../../packages/server/package.json", import.meta.url))("ws");
const [sock, secs] = process.argv.slice(2);
const ws = new WebSocket(`ws+unix://${sock}:/`);
let id = 0;
const pending = new Map();
const call = (method, params) =>
  new Promise((r) => {
    const n = ++id;
    pending.set(n, r);
    ws.send(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }));
  });
ws.on("message", (d) => {
  const m = JSON.parse(d.toString());
  if (m.id !== undefined && !m.method && pending.has(m.id)) pending.get(m.id)(m);
  else console.log(JSON.stringify({ at: Date.now(), ...m }));
});
ws.on("error", (e) => console.error(e.message));
ws.on("open", async () => {
  await call("initialize", { clientInfo: { name: "agentarium-spike", version: "0" } });
  ws.send(JSON.stringify({ jsonrpc: "2.0", method: "initialized" }));
  const loaded = await call("thread/loaded/list", {});
  for (const threadId of loaded.result?.data ?? []) await call("thread/resume", { threadId, excludeTurns: true });
  setTimeout(() => process.exit(0), Number(secs) * 1000);
});
