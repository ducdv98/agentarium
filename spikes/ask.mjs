// Spike helper: a blocking line prompt that never opens process.stdin. On Windows a stdin stream (even a
// closed readline) keeps a console read pending, and a child that inherits the console then never gets
// its keystrokes, so interactive CLIs spawned after it look frozen.
import { readSync } from "node:fs";

export function ask(question) {
  process.stdout.write(question);
  const buf = Buffer.alloc(1);
  let line = "";
  for (;;) {
    let n;
    try { n = readSync(0, buf, 0, 1, null); } catch (err) {
      if (err.code === "EAGAIN") continue;
      if (err.code === "EOF") break;
      throw err;
    }
    if (n === 0) break;
    const c = buf.toString("utf8");
    if (c === "\n") break;
    if (c !== "\r") line += c;
  }
  return line.trim();
}
