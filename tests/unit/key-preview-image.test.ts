import sharp from "sharp";
import {expect, it, vi} from "vitest";
import {MOTIFS, textBitmap} from "../../src/components/ui/knit/knit";
import {PREVIEW_SIZE, previewPieces, previewSvg} from "../../src/server/auth/key-preview-svg";
import {keyPreviewPng} from "../../src/server/auth/key-preview-image";

vi.mock("server-only", () => ({}));

it("stitches a short name between two snowflakes at the design's size", () => {
  const [left, name, right] = previewPieces("Rosa");
  expect(left.bitmap).toBe(MOTIFS.flake);
  expect(right.bitmap).toBe(MOTIFS.flake);
  expect(name).toMatchObject({bitmap: textBitmap("Rosa"), cell: 24});
});

it("lets a long name take the whole tile, and falls back to the first name", () => {
  const long = previewPieces("Christian");
  expect(long).toHaveLength(1);
  expect(long[0].bitmap).toEqual(textBitmap("Christian"));
  expect(long[0].cell).toBeGreaterThanOrEqual(12);
  expect(previewPieces("Rosa Ramirez")[1].bitmap).toEqual(textBitmap("Rosa"));
});

it("knits the gift when there is no name or the alphabet can't draw it", () => {
  for (const name of [null, "Güero", "Pépé", "", "   "]) {
    expect(previewPieces(name).map(({bitmap}) => bitmap)).toEqual([MOTIFS.flake, MOTIFS.gift, MOTIFS.flake]);
  }
});

it("draws only stitches inside the tile: no words, no fonts, nothing from outside", () => {
  for (const name of ["Rosa", "Christian", null]) {
    const svg = previewSvg(name);
    expect(svg).not.toMatch(/<text|<image|href|font|<script/i);
    const xs = [...svg.matchAll(/[MQ](-?[\d.]+) (-?[\d.]+)/g)].map(([, x, y]) => [Number(x), Number(y)]);
    for (const [x, y] of xs) {
      expect(x).toBeGreaterThanOrEqual(-2);
      expect(x).toBeLessThanOrEqual(PREVIEW_SIZE.width + 2);
      expect(y).toBeGreaterThanOrEqual(-2);
      expect(y).toBeLessThanOrEqual(PREVIEW_SIZE.height + 2);
    }
  }
});

it("renders a 1200 by 630 PNG", async () => {
  const meta = await sharp(await keyPreviewPng("Rosa")).metadata();
  expect(meta).toMatchObject({format: "png", width: 1200, height: 630});
});
