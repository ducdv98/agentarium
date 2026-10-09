import { describe, expect, it } from "vitest";
import { pickRoom } from "../src/follow";

const r = (id: string, waiting = 0, lastActive = 0) => ({ id, agents: 1, waiting, lastActive });

describe("pickRoom", () => {
  it("returns null with no rooms", () => {
    expect(pickRoom([], "a", null)).toBeNull();
  });
  it("moves off an empty/absent room to the most recent one", () => {
    expect(pickRoom([r("a", 0, 1), r("b", 0, 5)], "unassigned", null)).toBe("b");
  });
  it("keeps the current room while nothing is more urgent", () => {
    expect(pickRoom([r("a", 0, 1), r("b", 0, 5)], "a", null)).toBe("a");
  });
  it("jumps to a room that needs the user when the current one does not", () => {
    expect(pickRoom([r("a", 0, 9), r("b", 2, 1)], "a", null)).toBe("b");
    expect(pickRoom([r("a", 1, 1), r("b", 3, 9)], "a", null)).toBe("a");
  });
  it("honours a manual choice while that room exists", () => {
    expect(pickRoom([r("a", 0, 1), r("b", 5, 5)], "a", "a")).toBe("a");
    expect(pickRoom([r("b", 5, 5)], "a", "gone")).toBe("b");
  });
});
