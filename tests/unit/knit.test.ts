import fc from "fast-check";
import {describe, expect, it} from "vitest";
import {
  BAND_UNIT, MOTIFS, STITCHED_ALPHABET, band, bitmapSize, canStitch, knitOrder, leafPair, runs, stitchHeight, textBitmap,
} from "../../src/components/ui/knit/knit";

const drawable = Object.keys(STITCHED_ALPHABET).filter((character) => character !== " ");

describe("the stitched alphabet", () => {
  it("draws every glyph on nine rows of equal width", () => {
    for (const [character, glyph] of Object.entries(STITCHED_ALPHABET)) {
      expect(glyph, character).toHaveLength(9);
      expect(new Set(glyph.map((row) => row.length)).size, character).toBe(1);
    }
  });

  it("has the glyphs the design lists, and no others", () => {
    expect(drawable.sort()).toEqual([..."0123456789ABCDEHIKLMNORSTWY!"].sort());
  });

  it("knows which words it can stitch", () => {
    expect(canStitch("Beto")).toBe(true);
    expect(canStitch("HI ROSA!")).toBe(true);
    expect(canStitch("24")).toBe(true);
    expect(canStitch("José")).toBe(false);
    expect(canStitch("Juan")).toBe(false);
    expect(canStitch("   ")).toBe(false);
  });

  it("lays letters side by side with one empty column between them", () => {
    const rows = textBitmap("HI");
    expect(rows).toHaveLength(9);
    expect(rows[0]).toBe("##..##" + "." + "####");
    expect(textBitmap("")).toEqual([]);
  });

  it("keeps every row of a stitched word the same width", () => {
    fc.assert(fc.property(fc.array(fc.constantFrom(...drawable, " "), {minLength: 1, maxLength: 12}), (characters) => {
      const rows = textBitmap(characters.join(""));
      expect(new Set(rows.map((row) => row.length)).size).toBe(1);
    }));
  });
});

describe("the knit renderer", () => {
  it("draws a stitch as two closed leaves", () => {
    const path = leafPair(0, 0, 10, 9.2);
    expect(path.match(/M/g)).toHaveLength(2);
    expect(path.match(/Z/g)).toHaveLength(2);
    expect(stitchHeight(10)).toBe(9.2);
    expect(stitchHeight(6.4)).toBe(5.9);
  });

  it("knits from the bottom row up, alternating direction", () => {
    const order = knitOrder(["##", "##"], 10, {"#": "white"});
    expect(order.map((stitch) => stitch.row)).toEqual([1, 1, 0, 0]);
    const bottom = knitOrder(["#.#", "#.#"], 10, {"#": "white"});
    // bottom row left to right, then the top row right to left
    expect(bottom[0].d.startsWith("M0.4")).toBe(true);
    expect(bottom[2].d.startsWith("M20.4")).toBe(true);
  });

  it("measures charts and finds runs", () => {
    expect(bitmapSize(MOTIFS.gift, 13)).toEqual({width: 221, height: 192});
    expect(runs(["##.#"], "#")).toEqual([[0, 0, 2], [0, 3, 1]]);
  });

  it("repeats Fair Isle bands to any width", () => {
    for (const kind of ["zig", "flake", "trees"] as const) {
      const rows = band(kind, 50);
      expect(rows.every((row) => row.length === 50), kind).toBe(true);
      expect(BAND_UNIT[kind]).toBeGreaterThan(0);
    }
    expect(band("zig", 10)).toHaveLength(9);
    expect(band("flake", 10)).toHaveLength(13);
  });
});
