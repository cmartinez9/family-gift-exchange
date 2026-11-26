import type {CSSProperties} from "react";
import {MOTIFS, type MotifName, type StitchColors} from "./knit";
import {KnitSvg, KnittingSvg} from "./knit-svg";

const DEFAULT_COLORS: StitchColors = {"#": "var(--color-yarn-white)", o: "var(--color-gold)"};

/**
 * A seasonal picture knitted on the chart: snowflake, gift (with a gold ribbon), lock (gold body), tree,
 * star, check and dot. Decorative unless given a label.
 */
export function KnitMotif({name, cell, colors = DEFAULT_COLORS, label, knit = false, stepMs = 9, className, style}: {
  name: MotifName; cell: number; colors?: StitchColors; label?: string; knit?: boolean; stepMs?: number;
  className?: string; style?: CSSProperties;
}) {
  const svg = knit
    ? <KnittingSvg bitmap={MOTIFS[name]} cell={cell} colors={colors} className="fge-knit"
      style={{"--knit-step": `${stepMs}ms`, "--knit-delay": "0ms", ...style} as CSSProperties} />
    : <KnitSvg bitmap={MOTIFS[name]} cell={cell} colors={colors} style={style} />;
  if (!label) return <span className={className} data-motif={name}>{svg}</span>;
  return <span role="img" aria-label={label} className={className} data-motif={name}>{svg}</span>;
}

export function Snowflake({cell = 5, color = "var(--color-yarn-white)", className}: {cell?: number; color?: string; className?: string}) {
  return <KnitMotif name="flake" cell={cell} colors={{"#": color}} className={className} />;
}
