import { describe, expect, it } from "vitest";
import { dotGrid, office } from "@agentarium/renderer";
import { initialRenderer, RENDERERS } from "../src/renderers";

describe("renderer choice", () => {
  it("defaults to the office isometric view", () => {
    expect(initialRenderer("")).toBe("isometric");
    expect(RENDERERS.isometric.theme).toBe(office);
    expect(RENDERERS["dot-grid"].theme).toBe(dotGrid);
  });

  it("prefers a valid query choice over the remembered choice", () => {
    expect(initialRenderer("?renderer=dot-grid", "isometric")).toBe("dot-grid");
    expect(initialRenderer("?renderer=isometric", "dot-grid")).toBe("isometric");
  });

  it("uses a remembered choice or the default for invalid choices", () => {
    expect(initialRenderer("?renderer=unknown", "dot-grid")).toBe("dot-grid");
    expect(initialRenderer("", "unknown")).toBe("isometric");
  });
});
