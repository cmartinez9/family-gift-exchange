import {bitmapSize, canStitch, leafPair, MOTIFS, round2, stitchHeight, textBitmap, type Bitmap, type StitchColors} from "@/components/ui/knit/knit";

/**
 * The key's link preview picture (1.1): the name stitched in yarn white on the sweater red, between two
 * snowflakes, so a key forwarded to the wrong chat looks wrong before anyone taps it. The generic preview,
 * and a name the stitched alphabet cannot draw, knit a gift there instead.
 */
export const PREVIEW_SIZE = {width: 1200, height: 630} as const;

const RED = "#C8202F";
const YARN = "#FFF8EF";
const GOLD = "#EDB43E";
/** The design's tile, scaled 286 to 1200: 6px name stitches, 5px snowflake stitches, 18px apart. */
const NAME_CELL = 24;
const FLAKE_CELL = 18;
const GAP = 56;
const EDGE = 40;
/** Below these the stitches stop reading as knitting in a chat bubble. */
const BESIDE_FLAKES_MIN = 16;
const ALONE_MIN = 12;

type Piece = {bitmap: Bitmap; cell: number; colors: StitchColors; text?: string};

const flake: Piece = {bitmap: MOTIFS.flake, cell: FLAKE_CELL, colors: {"#": YARN}};
const gift: Piece = {bitmap: MOTIFS.gift, cell: FLAKE_CELL, colors: {"#": YARN, o: GOLD}};

const columns = (bitmap: Bitmap) => Math.max(...bitmap.map((row) => row.length));

/** The largest cell, up to the design's, that keeps a word inside `width`. */
const fit = (bitmap: Bitmap, width: number) => Math.min(NAME_CELL, Math.floor((width / columns(bitmap)) * 10) / 10);

/** What sits on the tile, left to right: the name between snowflakes, the name alone when long, or the gift. */
export function previewPieces(name: string | null): Piece[] {
  const words = name ? [name.trim(), name.trim().split(/\s+/)[0]] : [];
  const beside = PREVIEW_SIZE.width - 2 * EDGE - 2 * GAP - 2 * columns(flake.bitmap) * FLAKE_CELL;
  const alone = PREVIEW_SIZE.width - 2 * EDGE;
  for (const word of words) {
    if (!canStitch(word)) continue;
    const bitmap = textBitmap(word);
    const cell = fit(bitmap, beside);
    if (cell >= BESIDE_FLAKES_MIN) return [flake, {bitmap, cell, colors: {"#": YARN}, text: word}, flake];
  }
  for (const word of words) {
    if (!canStitch(word)) continue;
    const bitmap = textBitmap(word);
    const cell = fit(bitmap, alone);
    if (cell >= ALONE_MIN) return [{bitmap, cell, colors: {"#": YARN}, text: word}];
  }
  return [flake, gift, flake];
}

function knit({bitmap, cell, colors}: Piece, left: number, top: number) {
  const h = stitchHeight(cell);
  const byColor = new Map<string, string[]>();
  bitmap.forEach((row, y) => [...row].forEach((character, x) => {
    const fill = colors[character];
    if (!fill) return;
    byColor.set(fill, [...(byColor.get(fill) ?? []), leafPair(left + x * cell, top + y * h, cell, h)]);
  }));
  return [...byColor].map(([fill, d]) => `<path fill="${fill}" d="${d.join("")}"/>`).join("");
}

/** Render stitches as SVG paths so the image needs no fonts, text shaping or translation. */
export function previewSvg(name: string | null) {
  const pieces = previewPieces(name);
  const sizes = pieces.map(({bitmap, cell}) => bitmapSize(bitmap, cell));
  const total = sizes.reduce((sum, {width}) => sum + width, 0) + GAP * (pieces.length - 1);
  let left = (PREVIEW_SIZE.width - total) / 2;
  const body = pieces.map((piece, index) => {
    const {width, height} = sizes[index];
    const out = knit(piece, round2(left), round2((PREVIEW_SIZE.height - height) / 2));
    left += width + GAP;
    return out;
  }).join("");
  const {width, height} = PREVIEW_SIZE;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<rect width="${width}" height="${height}" fill="${RED}"/>${body}</svg>`;
}
