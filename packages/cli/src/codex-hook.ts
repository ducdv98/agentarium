import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";

const MAX_BODY = 1_000_000;

export async function forwardCodexHook(opts: { home: string; port: number; stdin?: Readable }): Promise<void> {
  try {
    const token = readFileSync(join(opts.home, "token"), "utf8").trim();
    if (!token || !Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) return;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of opts.stdin ?? process.stdin) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_BODY) return;
      chunks.push(bytes);
    }
    await fetch(`http://127.0.0.1:${opts.port}/hooks/codex`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: Buffer.concat(chunks),
      signal: AbortSignal.timeout(1_000),
    });
  } catch {
    // A hook must never affect Codex's decision or output.
  }
}
