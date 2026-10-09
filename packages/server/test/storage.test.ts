import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { e } from "../../core/test/builders";
import { jsonlLog } from "../src/storage";

describe("jsonlLog", () => {
  it("round-trips events per room and lists rooms", async () => {
    const log = jsonlLog(mkdtempSync(join(tmpdir(), "agentarium-log-")));
    await log.append("c:/repo_a", e.sessionStart(1));
    await log.append("c:/repo%a", e.prompt(2));
    await log.append("c:/repo_a", e.prompt(3));
    expect(await log.read("c:/repo_a")).toEqual([e.sessionStart(1), e.prompt(3)]);
    expect(await log.read("c:/repo%a")).toEqual([e.prompt(2)]);
    expect(await log.read("missing")).toEqual([]);
    expect((await log.rooms()).sort()).toEqual(["c:/repo%a", "c:/repo_a"]);
  });

  it("skips a torn line", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentarium-log-"));
    const log = jsonlLog(dir);
    await log.append("r", e.sessionStart(1));
    const file = (await import("node:fs")).readdirSync(dir)[0]!;
    appendFileSync(join(dir, file), '{"schema_ver');
    expect(await log.read("r")).toEqual([e.sessionStart(1)]);
  });
});
