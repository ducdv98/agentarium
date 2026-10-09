import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UNASSIGNED_ROOM, resolveRoom } from "../src/rooms";

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), "agentarium-rooms-")));

describe("resolveRoom", () => {
  it("sends missing, relative and non-git cwd to unassigned", () => {
    expect(resolveRoom(undefined)).toBe(UNASSIGNED_ROOM);
    expect(resolveRoom("relative/path")).toBe(UNASSIGNED_ROOM);
    expect(resolveRoom(join(tmp(), "nope"))).toBe(UNASSIGNED_ROOM);
  });

  it("maps any subdirectory of a repo to the same room", () => {
    const repo = tmp();
    mkdirSync(join(repo, ".git"));
    mkdirSync(join(repo, "a", "b"), { recursive: true });
    expect(resolveRoom(repo)).toBe(resolveRoom(join(repo, "a", "b")));
    expect(resolveRoom(repo)).not.toBe(UNASSIGNED_ROOM);
  });

  it("shares a room between a worktree and its main checkout", () => {
    const root = tmp();
    const main = join(root, "main");
    const wt = join(root, "wt");
    const wtGit = join(main, ".git", "worktrees", "wt");
    mkdirSync(wtGit, { recursive: true });
    mkdirSync(wt);
    writeFileSync(join(wtGit, "commondir"), "../..\n");
    writeFileSync(join(wt, ".git"), `gitdir: ${wtGit}\n`);
    expect(resolveRoom(wt)).toBe(resolveRoom(main));
  });

  it("gives different repos different rooms", () => {
    const a = tmp();
    const b = tmp();
    mkdirSync(join(a, ".git"));
    mkdirSync(join(b, ".git"));
    expect(resolveRoom(a)).not.toBe(resolveRoom(b));
  });
});
