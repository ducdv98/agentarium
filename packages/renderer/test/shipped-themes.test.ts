import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkAtlases, shippedThemes, validateTheme } from "../src";

const assets = join(__dirname, "../../../assets");
const readAtlas = (path: string): unknown => {
  const file = join(assets, path);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
};

/** The CI gate for themes we ship: a theme with a 2D section must be complete and match its committed atlases. */
describe("shipped themes", () => {
  for (const theme of shippedThemes) {
    it(`${theme.id} is valid`, () => {
      expect(validateTheme(theme)).toEqual([]);
      const r2d = theme.renderers?.["2d"];
      if (!r2d) return;
      expect(validateTheme(theme, { strict: true })).toEqual([]);
      expect(checkAtlases(r2d, Object.fromEntries(r2d.atlases.map((path) => [path, readAtlas(path)])))).toEqual([]);
    });
  }
});
