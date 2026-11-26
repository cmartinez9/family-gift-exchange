import {useId, type CSSProperties} from "react";
import {
  BAND_UNIT, band, bitmapSize, knitOrder, leafPair, round2, stitchHeight,
  type BandKind, type Bitmap, type StitchColors,
} from "./knit";
import {cn} from "../cn";

/** One combined path per colour: a static chart (a word or a motif) drawn as crisp V stitches. */
export function KnitSvg({bitmap, cell, colors, className, style}: {
  bitmap: Bitmap; cell: number; colors: StitchColors; className?: string; style?: CSSProperties;
}) {
  const {width, height} = bitmapSize(bitmap, cell);
  const h = stitchHeight(cell);
  const byColor = new Map<string, string[]>();
  bitmap.forEach((row, rowIndex) => [...row].forEach((character, column) => {
    const fill = colors[character];
    if (!fill) return;
    const list = byColor.get(fill) ?? [];
    list.push(leafPair(column * cell, rowIndex * h, cell, h));
    byColor.set(fill, list);
  }));
  return (
    <svg aria-hidden="true" focusable="false" width={width} height={height} viewBox={`0 0 ${width} ${height}`}
      className={cn("block shrink-0", className)} style={style}>
      {[...byColor].map(([fill, paths]) => <path key={fill} d={paths.join("")} style={{fill}} />)}
    </svg>
  );
}

/**
 * Every stitch as its own path, ordered the way knitting grows, so CSS can knit them in one by one.
 * `--i` on each stitch is its place in the order; the CSS reads it for the stagger.
 */
export function KnittingSvg({bitmap, cell, colors, className, style, stitchClassName = "fge-st"}: {
  bitmap: Bitmap; cell: number; colors: StitchColors; className?: string; style?: CSSProperties; stitchClassName?: string;
}) {
  const {width, height} = bitmapSize(bitmap, cell);
  const stitches = knitOrder(bitmap, cell, colors);
  return (
    <svg aria-hidden="true" focusable="false" width={width} height={height} viewBox={`0 0 ${width} ${height}`}
      className={cn("block shrink-0 overflow-visible", className)} style={style} data-stitches={stitches.length}>
      {stitches.map((stitch, index) => (
        <path key={index} className={stitchClassName} d={stitch.d} style={{fill: stitch.fill, "--i": index} as CSSProperties} />
      ))}
    </svg>
  );
}

/** A tile of one stitch, for patterns. */
function StitchPattern({id, cell, fill, x = 0, y = 0}: {id: string; cell: number; fill: string; x?: number | string; y?: number}) {
  const h = stitchHeight(cell);
  return (
    <pattern id={id} x={x} y={y} width={cell} height={h} patternUnits="userSpaceOnUse">
      <path d={leafPair(0, 0, cell, h)} style={{fill}} />
    </pattern>
  );
}

/**
 * Tone-on-tone knit that fills its box: the missing-picture tile, the loading tile, the claim tag
 * and the draw's knitted panel. Never put text on it.
 */
export function KnitField({base, stitch, cell = 10, className, style}: {
  base?: string; stitch: string; cell?: number; className?: string; style?: CSSProperties;
}) {
  const id = useId();
  return (
    <svg aria-hidden="true" focusable="false" width="100%" height="100%" className={cn("block", className)} style={style}>
      <defs><StitchPattern id={id} cell={cell} fill={stitch} /></defs>
      {base && <rect width="100%" height="100%" style={{fill: base}} />}
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/** A Fair Isle band: full bleed, its repeat unit as one pattern tile, centred on the screen. Never carries text. */
export function FairIsleBand({kind, cell, color = "var(--color-yarn-white)", className}: {
  kind: BandKind; cell: number; color?: string; className?: string;
}) {
  const id = useId();
  const unitColumns = BAND_UNIT[kind];
  const unit = band(kind, unitColumns * 3).map((row) => row.slice(0, unitColumns));
  const h = stitchHeight(cell);
  const tileWidth = round2(unitColumns * cell), tileHeight = round2(unit.length * h);
  let tile = "";
  unit.forEach((row, rowIndex) => [...row].forEach((character, column) => {
    if (character === "#") tile += leafPair(column * cell, rowIndex * h, cell, h);
  }));
  return (
    <svg aria-hidden="true" focusable="false" width="100%" height={tileHeight} className={cn("block w-full", className)} data-band={kind}>
      <defs>
        <pattern id={id} x="50%" width={tileWidth} height={tileHeight} patternUnits="userSpaceOnUse">
          <path d={tile} style={{fill: color}} />
        </pattern>
      </defs>
      <rect width="100%" height={tileHeight} fill={`url(#${id})`} />
    </svg>
  );
}
