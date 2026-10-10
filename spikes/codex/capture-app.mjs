#!/usr/bin/env node
// Spike: run one turn through `codex app-server` (the client owns the connection, so it sees
// approval requests) and save hook payloads plus every app-server message as
// <raw-dir>/<scenario>.{hooks,app}.jsonl.
// `answer` is the reply to every approval request: accept | decline | cancel, or
// `interrupt` to send turn/interrupt once the first command starts.
// `thread-params` is optional JSON merged into thread/start, e.g. {"approvalsReviewer":"auto_review"}.
// Usage: node capture-app.mjs <codex-home> <workdir> <payloads.jsonl> <raw-dir> <scenario> <answer> <approval-policy> <sandbox> <prompt> [thread-params]
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { rpcSession } from "./rpc.mjs";

const [home, work, payloads, rawDir, scenario, answer, approvalPolicy, sandbox, prompt, threadParams] = process.argv.slice(2);
if (!prompt) {
  console.error("usage: capture-app.mjs <codex-home> <workdir> <payloads.jsonl> <raw-dir> <scenario> <answer> <approval-policy> <sandbox> <prompt>");
  process.exit(1);
}
mkdirSync(rawDir, { recursive: true });
rmSync(payloads, { force: true });
const appLog = join(rawDir, `${scenario}.app.jsonl`);
rmSync(appLog, { force: true });
const record = (dir, m) => appendFileSync(appLog, `${JSON.stringify({ at: Date.now(), dir, ...m })}\n`);

let done;
const finished = new Promise((r) => (done = r));
let interrupted = false;
let threadId;
const rpc = await rpcSession(
  { CODEX_HOME: resolve(home) },
  {
    onNotify: (m) => {
      record("notify", m);
      if (m.method === "turn/completed") done();
      if (answer === "interrupt" && !interrupted && m.method === "item/started" && m.params?.item?.type === "commandExecution") {
        interrupted = true;
        setTimeout(() => rpc.call("turn/interrupt", { threadId, turnId: m.params.turnId }).then((r) => record("reply", r)), 2_000);
      }
    },
    onRequest: (m) => {
      record("request", m);
      const decision = answer === "interrupt" ? "accept" : answer;
      if (m.method === "item/tool/requestUserInput") {
        return { answers: Object.fromEntries((m.params.questions ?? []).map((q) => [q.id, [q.options?.[0]?.label ?? "fixture answer"]])) };
      }
      if (m.method === "mcpServer/elicitation/request") {
        return decision === "decline" || decision === "cancel"
          ? { action: "decline" }
          : { action: "accept", content: { answer: "fixture answer" } };
      }
      if (m.method === "item/permissions/requestApproval") {
        return decision === "decline" || decision === "cancel"
          ? { permissions: null }
          : { permissions: m.params.permissions };
      }
      return { decision };
    },
  },
);
const started = await rpc.call("thread/start", { cwd: resolve(work), approvalPolicy, sandbox, ...JSON.parse(threadParams ?? "{}") });
record("reply", started);
threadId = started.result.thread.id;
record("reply", await rpc.call("turn/start", { threadId, input: [{ type: "text", text: prompt }] }));
const timer = setTimeout(done, 240_000);
await finished;
clearTimeout(timer);
// Give hooks fired at turn end (Stop) time to land before closing the server.
await new Promise((r) => setTimeout(r, 2_000));
rpc.close();
await new Promise((r) => setTimeout(r, 1_000));
if (existsSync(payloads)) renameSync(payloads, join(rawDir, `${scenario}.hooks.jsonl`));
console.log(`${scenario}: done`);
