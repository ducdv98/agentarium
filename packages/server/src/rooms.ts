import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";

export const UNASSIGNED_ROOM = "unassigned";

/**
 * Room id for a working directory: the repository root resolved through the git common
 * directory, so worktrees share a room with the main checkout. Reads the filesystem
 * only (no git subprocess). Unknown or non-git directories go to "unassigned".
 */
export function resolveRoom(cwd?: string): string {
  if (!cwd || !isAbsolute(cwd)) return UNASSIGNED_ROOM;
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    const common = commonDirAt(dir);
    if (common) return roomId(common);
    if (dirname(dir) === dir) return UNASSIGNED_ROOM;
  }
}

function commonDirAt(dir: string): string | null {
  const dotGit = join(dir, ".git");
  if (!existsSync(dotGit)) return null;
  try {
    if (statSync(dotGit).isDirectory()) return dotGit;
    const gitdir = readFileSync(dotGit, "utf8").match(/^gitdir:\s*(.+?)\s*$/m)?.[1];
    if (!gitdir) return null;
    const worktreeDir = resolve(dir, gitdir);
    const commondir = readFileSync(join(worktreeDir, "commondir"), "utf8").trim();
    return resolve(worktreeDir, commondir);
  } catch {
    return null;
  }
}

function roomId(commonDir: string): string {
  // Repository root: the parent of the common `.git` directory (bare repos keep their own path).
  const n = normalize(commonDir);
  const root = n.endsWith(`${normalize("/.git")}`) ? dirname(n) : n;
  const posix = root.replaceAll("\\", "/").replace(/\/+$/, "");
  return process.platform === "win32" ? posix.toLowerCase() : posix;
}
