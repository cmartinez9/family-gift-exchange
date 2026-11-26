import type {CSSProperties, ElementType} from "react";
import {canStitch, stitchHeight, textBitmap} from "./knit";
import {KnitSvg, KnittingSvg} from "./knit-svg";
import {cn} from "../cn";

/** Cell sizes the design uses for stitched words. */
export const STITCH_CELL = {
  homeCountdown: 10.5,
  greeting: 10,
  revealedName: 11.5,
  personPage: 7.5,
  pass: 6.4,
  today: 8.5,
} as const;

export type StitchedTextProps = {
  /** The word. It is upper-cased for stitching; screen readers get it as written. */
  text: string;
  cell: number;
  /** Yarn white on red or pine only. Never ink, never on a yarn-white or gold card. */
  color?: string;
  /** Knit the word in, one stitch every `stepMs`, bottom row first, alternating direction. */
  knit?: boolean;
  stepMs?: number;
  delayMs?: number;
  as?: ElementType;
  className?: string;
  id?: string;
};

/**
 * A stitched word: names, numbers and moments only. The SVG is hidden from assistive technology and
 * the real text sits beside it, visually hidden, so the word reads, copies and finds like text.
 * A word with a letter the alphabet has not drawn yet falls back to plain heavy Rubik at the same height.
 */
export function StitchedText({
  text, cell, color = "var(--color-yarn-white)", knit = false, stepMs = 6, delayMs = 0, as: Tag = "span", className, id,
}: StitchedTextProps) {
  if (!canStitch(text)) {
    const height = 9 * stitchHeight(cell);
    return (
      <Tag id={id} className={cn("fge-stitched-fallback block font-extrabold uppercase", className)}
        style={{fontSize: height * 0.86, lineHeight: `${height}px`, color, letterSpacing: "0.06em"}} data-stitched="fallback">
        {text}
      </Tag>
    );
  }
  const bitmap = textBitmap(text);
  const colors = {"#": color};
  return (
    <Tag id={id} className={cn("fge-stitched inline-block", className)} data-stitched={knit ? "knit" : "static"}>
      <span className="sr-only">{text}</span>
      {knit
        ? <KnittingSvg bitmap={bitmap} cell={cell} colors={colors} className="fge-knit"
          style={{"--knit-step": `${stepMs}ms`, "--knit-delay": `${delayMs}ms`} as CSSProperties} />
        : <KnitSvg bitmap={bitmap} cell={cell} colors={colors} />}
    </Tag>
  );
}
