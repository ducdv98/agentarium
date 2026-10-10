import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readClaudeRejections } from "../src/claude-transcripts";

const DENY = "42c9c30e-7b25-4c0c-8370-718f63881d94";
const ESC = "689e7300-daec-468f-aac3-1dff4c9f4946";
const IDLE = "c88a8a39-4956-4191-8b99-22dde3948e20";
const ASK = "3234779c-62d0-4009-8051-676b9428e69e";
const source = (session: string) => join(__dirname, "../../../spikes/fixtures/claude-code/transcripts", `${session}.jsonl`);
/** Claude keeps transcripts at <config>/projects/<project-slug>/<session>.jsonl. */
const project = () => {
  const dir = join(mkdtempSync(join(tmpdir(), "claude-config-")), "projects", "C--repo");
  mkdirSync(dir, { recursive: true });
  return dir;
};
const fixture = (session: string) => {
  const path = join(project(), `${session}.jsonl`);
  copyFileSync(source(session), path);
  return path;
};

describe("Claude transcript rejections", () => {
  it("finds a TUI deny and an Esc for the asked ids only", () => {
    expect(readClaudeRejections(fixture(DENY), ["toolu_017AH4utxYTzhoBKo1LgnvXJ"])).toEqual(["toolu_017AH4utxYTzhoBKo1LgnvXJ"]);
    expect(readClaudeRejections(fixture(DENY), ["toolu_other"])).toEqual([]);
    expect(readClaudeRejections(fixture(ESC), ["toolu_012uMb4JxZobf73wFNRsjNNd"])).toEqual(["toolu_012uMb4JxZobf73wFNRsjNNd"]);
  });

  it("does not mistake an approved call or an answered question for a rejection", () => {
    expect(readClaudeRejections(fixture(IDLE), ["toolu_01E6hmXsAD3xjX1LouQXJ2YV", "toolu_01QNEZYAmCZ9atkwNgyeQ6KP"])).toEqual(["toolu_01E6hmXsAD3xjX1LouQXJ2YV"]);
    expect(readClaudeRejections(fixture(ASK), ["toolu_01KWTNFnY5trjDXcRooyJXFk"])).toEqual([]);
  });

  it("reads only session transcripts in a projects folder, only a bounded tail, and never throws", () => {
    const id = ["toolu_017AH4utxYTzhoBKo1LgnvXJ"];
    const outside = join(mkdtempSync(join(tmpdir(), "claude-other-")), `${DENY}.jsonl`);
    copyFileSync(source(DENY), outside);
    expect(readClaudeRejections(outside, id)).toEqual([]);
    const dir = project();
    copyFileSync(source(DENY), join(dir, "notes.jsonl"));
    expect(readClaudeRejections(join(dir, "notes.jsonl"), id)).toEqual([]);
    const padded = join(dir, `${DENY}.jsonl`);
    writeFileSync(padded, `${readFileSync(source(DENY), "utf8")}${JSON.stringify({ type: "user", pad: "x".repeat(400_000) })}\n`);
    expect(readClaudeRejections(padded, id)).toEqual([]);
    expect(readClaudeRejections(join(dir, `${ASK}.jsonl`), ["x"])).toEqual([]);
    mkdirSync(join(dir, `${ESC}.jsonl`));
    expect(readClaudeRejections(join(dir, `${ESC}.jsonl`), ["x"])).toEqual([]);
  });
});
