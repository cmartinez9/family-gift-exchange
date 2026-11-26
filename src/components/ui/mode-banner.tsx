import type {ReactNode} from "react";
import {Icon, type IconName} from "./icon";

/**
 * One banner for every mode — helping someone, the practice family, preview as: ink, under the status
 * bar, an icon, the words and a 48px button to leave.
 */
export function ModeBanner({icon, children, action, label}: {
  icon: IconName; children: ReactNode; action: ReactNode;
  /** Names the banner as a region for screen readers: "Mode". */
  label?: string;
}) {
  return (
    <div role={label ? "region" : undefined} aria-label={label}
      className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 bg-ink py-1 pr-2 pl-edge text-snow-white" data-mode-banner="">
      <Icon name={icon} size={22} className="text-gold" />
      {/* the words wrap, and at the largest text size the button moves under them, rather than cutting a name off */}
      <p className="min-w-[6em] flex-1 py-2.5 text-body-strong">{children}</p>
      {action}
    </div>
  );
}

/** The banner's way out, a 48px pill on 14% white. */
export const modeActionClass = "fge-press inline-flex h-12 shrink-0 cursor-pointer items-center rounded-pill bg-white/14 px-[18px] text-body-strong text-snow-white";
