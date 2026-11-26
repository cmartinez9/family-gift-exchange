// The knit renderer, ported from the round-3 generator (knit.mjs) unchanged:
// every chart cell is a V stitch of two lens-shaped leaves, pointed at both ends,
// touching at the bottom with a gap at the top.

export type Bitmap = readonly string[];
export type StitchColors = Readonly<Record<string, string>>;

const r1 = (n: number) => Math.round(n * 10) / 10;

/** A stitch is a little shorter than it is wide. */
export function stitchHeight(cell: number): number {
  return Math.round(cell * 0.92 * 10) / 10;
}

/** The SVG path of one V stitch in the cell at (x, y). */
export function leafPair(x: number, y: number, w: number, h: number): string {
  const leaf = (tx: number, ty: number, bx: number, by: number, bulge: number) => {
    const mx = (tx + bx) / 2, my = (ty + by) / 2, dx = bx - tx, dy = by - ty, length = Math.hypot(dx, dy);
    const nx = -dy / length, ny = dx / length;
    return `M${r1(tx)} ${r1(ty)}Q${r1(mx + nx * bulge)} ${r1(my + ny * bulge)} ${r1(bx)} ${r1(by)}`
      + `Q${r1(mx - nx * bulge)} ${r1(my - ny * bulge)} ${r1(tx)} ${r1(ty)}Z`;
  };
  const bulge = 0.3 * w;
  return leaf(x + 0.04 * w, y - 0.02 * h, x + 0.47 * w, y + 1.08 * h, bulge)
    + leaf(x + 0.96 * w, y - 0.02 * h, x + 0.53 * w, y + 1.08 * h, bulge);
}

/**
 * The stitched alphabet: a knit chart 6 cells wide and 9 rows tall (I is 4, the exclamation mark 2;
 * M and W are 7), one empty column between letters. Glyphs exist for 0 to 9, A B C D E H I K L M N O R S T W Y and !.
 */
export const STITCHED_ALPHABET: Readonly<Record<string, Bitmap>> = {
  0: [".####.", "##..##", "##..##", "##..##", "##..##", "##..##", "##..##", "##..##", ".####."],
  1: ["..##..", ".###..", "####..", "..##..", "..##..", "..##..", "..##..", "..##..", "######"],
  2: [".####.", "##..##", "....##", "....##", "...##.", "..##..", ".##...", "##....", "######"],
  3: [".####.", "##..##", "....##", "...##.", "..###.", "....##", "....##", "##..##", ".####."],
  4: ["...##.", "..###.", ".####.", "##.##.", "##.##.", "######", "...##.", "...##.", "...##."],
  5: ["######", "##....", "##....", "#####.", "....##", "....##", "....##", "##..##", ".####."],
  6: ["..###.", ".##...", "##....", "#####.", "##..##", "##..##", "##..##", "##..##", ".####."],
  7: ["######", "....##", "....##", "...##.", "...##.", "..##..", "..##..", "..##..", "..##.."],
  8: [".####.", "##..##", "##..##", ".####.", "##..##", "##..##", "##..##", "##..##", ".####."],
  9: [".####.", "##..##", "##..##", "##..##", ".#####", "....##", "....##", "...##.", ".###.."],
  A: [".####.", "##..##", "##..##", "##..##", "######", "##..##", "##..##", "##..##", "##..##"],
  B: ["#####.", "##..##", "##..##", "#####.", "##..##", "##..##", "##..##", "##..##", "#####."],
  C: [".####.", "##..##", "##....", "##....", "##....", "##....", "##....", "##..##", ".####."],
  D: ["####..", "##.##.", "##..##", "##..##", "##..##", "##..##", "##..##", "##.##.", "####.."],
  E: ["######", "##....", "##....", "#####.", "##....", "##....", "##....", "##....", "######"],
  H: ["##..##", "##..##", "##..##", "##..##", "######", "##..##", "##..##", "##..##", "##..##"],
  I: ["####", ".##.", ".##.", ".##.", ".##.", ".##.", ".##.", ".##.", "####"],
  K: ["##..##", "##.##.", "####..", "###...", "####..", "##.##.", "##..##", "##..##", "##..##"],
  L: ["##....", "##....", "##....", "##....", "##....", "##....", "##....", "##....", "######"],
  M: ["##...##", "###.###", "#######", "##.#.##", "##.#.##", "##...##", "##...##", "##...##", "##...##"],
  N: ["##..##", "###.##", "######", "##.###", "##..##", "##..##", "##..##", "##..##", "##..##"],
  O: [".####.", "##..##", "##..##", "##..##", "##..##", "##..##", "##..##", "##..##", ".####."],
  R: ["#####.", "##..##", "##..##", "##..##", "#####.", "##.##.", "##..##", "##..##", "##..##"],
  S: [".#####", "##....", "##....", ".####.", "....##", "....##", "....##", "##..##", ".####."],
  T: ["######", "..##..", "..##..", "..##..", "..##..", "..##..", "..##..", "..##..", "..##.."],
  W: ["##...##", "##...##", "##...##", "##.#.##", "##.#.##", "#######", "###.###", "##...##", "#.....#"],
  Y: ["##..##", "##..##", "##..##", ".####.", "..##..", "..##..", "..##..", "..##..", "..##.."],
  "!": ["##", "##", "##", "##", "##", "##", "..", "##", "##"],
  " ": ["...", "...", "...", "...", "...", "...", "...", "...", "..."],
};

/** Upper-cases a word the way it is stitched. */
export function stitchable(text: string): string {
  return text.toLocaleUpperCase("en-US");
}

/** True when every character of the word has a drawn glyph. Other letters must be drawn on the same grid first. */
export function canStitch(text: string): boolean {
  const word = stitchable(text);
  return word.trim().length > 0 && [...word].every((character) => character in STITCHED_ALPHABET);
}

/** The knit chart of a word: rows of "#" (stitch) and "." (empty), one empty column between letters. */
export function textBitmap(text: string, gap = 1): string[] {
  const glyphs = [...stitchable(text)].map((character) => STITCHED_ALPHABET[character] ?? STITCHED_ALPHABET[" "]);
  if (glyphs.length === 0) return [];
  const rows = glyphs[0].length;
  return Array.from({length: rows}, (_, row) => glyphs.map((glyph) => glyph[row]).join(".".repeat(gap)));
}

/** The seasonal pictures. "#" is the main yarn; "o" the second (the gift's gold ribbon, the lock's gold body). */
export const MOTIFS = {
  flake: ["....#....", "..#.#.#..", "...###...", ".#..#..#.", "####.####", ".#..#..#.", "...###...", "..#.#.#..", "....#...."],
  tree: ["....#....", "...###...", "..#####..", "...###...", "..#####..", ".#######.", "..#####..", ".#######.", "#########", "....o....", "....o...."],
  star: ["....#....", "....#....", "...###...", "#########", ".#######.", "..#####..", "..##.##..", ".##...##.", ".#.....#."],
  check: ["......##", ".....##.", "#...##..", "##.##...", ".###....", "..#....."],
  dot: [".#.", "###", ".#."],
  lock: [
    "....#####....", "...##...##...", "..##.....##..", "..##.....##..", "..##.....##..", "ooooooooooooo", "ooooooooooooo",
    "oooooo#oooooo", "ooooo###ooooo", "ooooo###ooooo", "oooooo#oooooo", "oooooo#oooooo", "ooooooooooooo", "ooooooooooooo",
  ],
  gift: [
    "...oo.......oo...",
    "..o..o.....o..o..",
    "..o...o...o...o..",
    "...o...o.o...o...",
    "....ooo.o.ooo....",
    "########o########",
    "########o########",
    ".#######o#######.",
    ".#######o#######.",
    ".#######o#######.",
    ".#######o#######.",
    ".#######o#######.",
    ".#######o#######.",
    ".#######o#######.",
    ".#######o#######.",
    ".#######o#######.",
  ],
} as const satisfies Record<string, Bitmap>;

export type MotifName = keyof typeof MOTIFS;
export type BandKind = "zig" | "flake" | "trees";

/** A Fair Isle band, repeated to a number of columns. */
export function band(kind: BandKind, widthColumns: number): string[] {
  const repeat = (unit: string) => unit.repeat(Math.ceil(widthColumns / unit.length) + 1).slice(0, widthColumns);
  const solid = repeat("#"), dots = repeat(".#"), pin = repeat("#...");
  if (kind === "zig") {
    return [solid, dots, repeat("#......."), repeat(".#.....#"), repeat("..#...#."), repeat("...#.#.."), repeat("....#..."), dots, solid];
  }
  if (kind === "flake") {
    const flake = MOTIFS.flake;
    return [solid, dots, ...flake.map((row, index) => repeat(row + (index === 4 ? ".#." : "..."))), dots, solid];
  }
  const tree = ["...#...", "..###..", ".#####.", "..###..", ".#####.", "#######", "...#..."];
  return [solid, pin, ...tree.map((row) => repeat(row + "..")), pin, solid];
}

/** The repeat unit of a band, in columns. */
export const BAND_UNIT: Readonly<Record<BandKind, number>> = {zig: 8, flake: 12, trees: 9};

/** Runs of one chart character per row: [row, first column, length]. */
export function runs(bitmap: Bitmap, character: string): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  bitmap.forEach((row, rowIndex) => {
    let start = -1;
    for (let column = 0; column <= row.length; column++) {
      const on = row[column] === character;
      if (on && start < 0) start = column;
      if (!on && start >= 0) {
        out.push([rowIndex, start, column - start]);
        start = -1;
      }
    }
  });
  return out;
}

export type Stitch = {d: string; fill: string; row: number};

/**
 * Every stitch as its own path, in the order knitting grows: bottom row first, alternating direction.
 * Used only where stitches animate; static knitting uses one pattern tile per colour instead.
 */
export function knitOrder(bitmap: Bitmap, cell: number, colors: StitchColors): Stitch[] {
  const h = stitchHeight(cell);
  const out: Stitch[] = [];
  for (let row = bitmap.length - 1, pass = 0; row >= 0; row--, pass++) {
    const cells = [...bitmap[row]].map((character, column) => [character, column] as const).filter(([character]) => colors[character]);
    if (pass % 2) cells.reverse();
    for (const [character, column] of cells) out.push({d: leafPair(column * cell, row * h, cell, h), fill: colors[character], row});
  }
  return out;
}

export function bitmapSize(bitmap: Bitmap, cell: number): {width: number; height: number} {
  const columns = bitmap.length ? Math.max(...bitmap.map((row) => row.length)) : 0;
  return {width: r1(columns * cell), height: r1(bitmap.length * stitchHeight(cell))};
}

/** Two decimals, for SVG attributes. */
export const round2 = (n: number) => Math.round(n * 100) / 100;
