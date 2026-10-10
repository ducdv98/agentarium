// Spike helper: a JSON-RPC session over `codex app-server` stdio.
import { spawn } from "node:child_process";

/**
 * Starts `codex app-server` with `env` merged over process.env. Server requests go to
 * `onRequest(msg)`, whose return value is sent back as the result; notifications go to `onNotify(msg)`.
 */
export async function rpcSession(env, { onNotify = () => {}, onRequest = () => null } = {}) {
  const p = spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, ...env } });
  let buf = "";
  let id = 0;
  const pending = new Map();
  const write = (m) => p.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
  p.stdout.on("data", async (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const m = JSON.parse(line);
      if (m.method && m.id !== undefined) write({ id: m.id, result: await onRequest(m) });
      else if (m.method) onNotify(m);
      else if (pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
      }
    }
  });
  const call = (method, params) =>
    new Promise((r) => {
      const n = ++id;
      pending.set(n, r);
      write({ id: n, method, params });
    });
  await call("initialize", { clientInfo: { name: "agentarium-spike", version: "0" } });
  write({ method: "initialized" });
  return { call, close: () => p.kill() };
}
