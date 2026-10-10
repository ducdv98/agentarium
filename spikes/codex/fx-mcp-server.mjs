#!/usr/bin/env node
// Spike: minimal stdio MCP server with one tool that succeeds and one that returns isError.
import { createInterface } from "node:readline";

const tools = [
  { name: "fx_ok", description: "Returns ok.", inputSchema: { type: "object", properties: {} } },
  { name: "fx_fail", description: "Always fails with isError.", inputSchema: { type: "object", properties: {} } },
];
const send = (m) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.id === undefined) return;
  switch (m.method) {
    case "initialize":
      return send({ id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fx", version: "0" } } });
    case "tools/list":
      return send({ id: m.id, result: { tools } });
    case "tools/call": {
      const fail = m.params.name === "fx_fail";
      return send({ id: m.id, result: { content: [{ type: "text", text: fail ? "fx failure" : "fx ok" }], isError: fail } });
    }
    default:
      return send({ id: m.id, error: { code: -32601, message: "method not found" } });
  }
});
