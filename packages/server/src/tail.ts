import { closeSync, fstatSync, openSync, readSync } from "node:fs";

/** Complete lines from the last `maxBytes` of a regular file, oldest first; a cut first line is dropped. Never throws. */
export function readTailLines(path: string, maxBytes = 256 * 1024): string[] {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const stat = fstatSync(fd);
    if (!stat.isFile()) return [];
    const size = stat.size;
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    const count = readSync(fd, buffer, 0, length, size - length);
    let text = buffer.toString("utf8", 0, count);
    if (size > length) text = text.slice(text.indexOf("\n") + 1 || text.length);
    return text.split("\n").filter((line) => line.trim());
  } catch { return []; }
  finally { if (fd !== undefined) try { closeSync(fd); } catch { /* Reader never throws. */ } }
}
