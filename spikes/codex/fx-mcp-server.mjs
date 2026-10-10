#!/usr/bin/env node
// Spike: minimal stdio MCP server with one tool that succeeds and one that returns isError.
import { createInterface } from "node:readline";

const tools = [
  { name: "fx_ok", description: "Returns ok.", inputSchema: { type: "object", properties: {} } },
  { name: "fx_fail", description: "Always fails with isError.", inputSchema: { type: "object", properties: {} } },
  { name: "fx_elicit", description: "Requests one answer from the user, then returns ok.", inputSchema: { type: "object", properties: {} } },
];
const send = (m) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
let elicitation;
createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.id === undefined) return;
  if (elicitation && m.id === elicitation.id) {
    const accepted = m.result?.action === "accept";
    const text = accepted ? `fx elicited: ${m.result?.content?.answer ?? "answer"}` : "fx elicitation declined";
    const callId = elicitation.callId;
    elicitation = undefined;
    return send({ id: callId, result: { content: [{ type: "text", text }], isError: !accepted } });
  }
  switch (m.method) {
    case "initialize":
      return send({ id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {}, elicitation: {} }, serverInfo: { name: "fx", version: "0" } } });
    case "tools/list":
      return send({ id: m.id, result: { tools } });
    case "tools/call": {
      if (m.params.name === "fx_elicit") {
        elicitation = { id: `elicit-${Date.now()}`, callId: m.id };
        send({ id: elicitation.id, method: "elicitation/create", params: { message: "Provide a short answer for the fixture.", requestedSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] } } });
        return;
      }
      const fail = m.params.name === "fx_fail";
      return send({ id: m.id, result: { content: [{ type: "text", text: fail ? "fx failure" : "fx ok" }], isError: fail } });
    }
    default:
      return send({ id: m.id, error: { code: -32601, message: "method not found" } });
  }
});
