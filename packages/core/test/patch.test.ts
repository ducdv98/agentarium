import { describe, expect, it } from "vitest";
import { applyPatch, createPatchClient, diffWorld, emptyWorld, reduce, replay } from "../src";
import { e, ref } from "./builders";

const w1 = replay([e.sessionStart(1), e.prompt(2), e.toolStart(3, "t1", "read")]);
const w2 = reduce(w1, e.toolEnd(4, "t1"));

describe("diffWorld / applyPatch", () => {
  it("round-trips", () => {
    expect(applyPatch(w1, diffWorld(w1, w2))).toEqual(w2);
    expect(applyPatch(emptyWorld(), diffWorld(emptyWorld(), w2))).toEqual(w2);
  });

  it("is empty when nothing changed", () => {
    const p = diffWorld(w2, w2);
    expect(p.upserts).toEqual([]);
    expect(p.removed).toEqual([]);
  });

  it("only upserts changed agents and reports removals", () => {
    const other = reduce(w2, e.sessionStart(5, ref("a2")));
    expect(diffWorld(w2, other).upserts).toHaveLength(1);
    const p = diffWorld(other, w2);
    expect(p.removed).toHaveLength(1);
    expect(applyPatch(other, p)).toEqual(w2);
  });
});

describe("createPatchClient", () => {
  const snap = { type: "snapshot", room: "r", seq: 5, world: w1 } as const;
  const patch = (seq: number) => ({ type: "patch", room: "r", seq, patch: diffWorld(w1, w2) }) as const;

  it("applies a snapshot then in-order patches", () => {
    const c = createPatchClient();
    expect(c.handle(snap)).toBe("ok");
    expect(c.handle(patch(6))).toBe("ok");
    expect(c.world).toEqual(w2);
    expect(c.seq).toBe(6);
  });

  it("reports a gap and does not apply the patch", () => {
    const c = createPatchClient();
    c.handle(snap);
    expect(c.handle(patch(7))).toBe("gap");
    expect(c.world).toEqual(w1);
  });

  it("reports a gap for a patch before any snapshot", () => {
    expect(createPatchClient().handle(patch(1))).toBe("gap");
  });
});
