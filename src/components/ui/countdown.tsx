import {Snowflake} from "./knit/knit-motif";
import {STITCH_CELL, StitchedText} from "./knit/stitched-text";

/**
 * Home's countdown: the number of days stitched between two snowflakes, then what it counts to and
 * when and where. On gift day the number becomes a stitched TODAY.
 */
export function Countdown({days, unit, line, today = "TODAY", knit = false}: {
  days: number;
  /** "days to gift day" (or "day to gift day"), already translated. */
  unit: string;
  /** "Thursday, Dec 24 · 7 pm · Ana's house" */
  line?: string;
  /** The word stitched on the day itself. */
  today?: string;
  knit?: boolean;
}) {
  const isToday = days <= 0;
  return (
    <div className="flex flex-col items-center pt-1 text-center text-snow-white" data-countdown={isToday ? "today" : days}>
      <div className="flex max-w-full items-center gap-[22px]">
        <Snowflake cell={5.5} />
        <StitchedText text={isToday ? today : String(days)} cell={isToday ? STITCH_CELL.today : STITCH_CELL.homeCountdown}
          knit={knit} stepMs={5} className="min-w-0 [&>svg]:h-auto [&>svg]:max-w-full" />
        <Snowflake cell={5.5} />
      </div>
      {!isToday && <p className="pt-2.5 text-card-title font-bold">{unit}</p>}
      {line && <p className={isToday ? "pt-2.5 text-body" : "pt-0.5 text-body"}>{line}</p>}
    </div>
  );
}
