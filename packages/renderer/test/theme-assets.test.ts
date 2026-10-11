import { describe, expect, it } from "vitest";
import { dotGrid, themeAssetFiles, type Theme } from "../src";

const theme: Theme = {
  ...dotGrid,
  renderers: { "2d": { atlases: ["atlases/worker.json", "atlases/room.json"], room: "src/room/layout.json", states: {}, categories: {} } },
};

describe("themeAssetFiles", () => {
  it("needs no files for a theme without art", () => {
    expect(themeAssetFiles(dotGrid, () => { throw new Error("unexpected read"); })).toEqual([]);
  });

  it("includes atlas JSON, relative images and the room, without duplicates", () => {
    const read: string[] = [];
    expect(themeAssetFiles(theme, (path) => {
      read.push(path);
      return { meta: { image: "../images/shared.png" } };
    })).toEqual(["atlases/worker.json", "images/shared.png", "atlases/room.json", "src/room/layout.json"]);
    expect(read).toEqual(theme.renderers!["2d"]!.atlases);
  });

  it("rejects an atlas without an image", () => {
    expect(() => themeAssetFiles(theme, () => ({}))).toThrow("meta.image");
  });

  it.each(["../../escape.png", "/absolute.png", "C:\\escape.png"])("rejects images outside assets: %s", (image) => {
    expect(() => themeAssetFiles(theme, () => ({ meta: { image } }))).toThrow();
  });
});
