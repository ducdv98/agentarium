#!/usr/bin/env node
// Spike: an OTLP/HTTP sink that appends each request (path, headers, JSON or base64 body) to a JSONL file.
// Usage: node otel-sink.mjs <port> <out.jsonl>
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const [port, out] = process.argv.slice(2);
createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const raw = Buffer.concat(chunks);
    let body;
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      body = { base64: raw.toString("base64") };
    }
    appendFileSync(out, `${JSON.stringify({ at: Date.now(), path: req.url, type: req.headers["content-type"], body })}\n`);
    res.writeHead(200, { "content-type": "application/json" }).end("{}");
  });
}).listen(Number(port), "127.0.0.1");
