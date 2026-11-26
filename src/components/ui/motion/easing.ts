// The motion values the Web Animations API needs in script. They mirror the --motion-* and --ease-* tokens.
export const EASE = {
  interface: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  back: "cubic-bezier(0.4, 0, 0.6, 1)",
  sheetClose: "cubic-bezier(0.4, 0, 1, 1)",
  pill: "cubic-bezier(0.3, 1.25, 0.5, 1)",
  pop: "cubic-bezier(0.3, 1.6, 0.5, 1)",
  unravel: "cubic-bezier(0.55, 0, 0.8, 0.35)",
  pine: "cubic-bezier(0.4, 0, 0.2, 1)",
  swing: "cubic-bezier(0.25, 0.8, 0.3, 1)",
  lift: "cubic-bezier(0.5, 0, 0.75, 0)",
} as const;

export const DURATION = {
  push: 380,
  back: 300,
  backSwipeFinish: 220,
  backSwipeCancel: 240,
  tab: 220,
  tabPill: 340,
  sheet: 420,
  sheetScrim: 300,
  sheetClose: 260,
  sheetSettle: 300,
  press: 120,
  arrive: 340,
  toast: 280,
  toastStay: 2600,
  toastStayUndo: 5000,
  knitWordStep: 6,
  knitStep: 14,
  unravelRow: 300,
  unravelPerGift: 1700,
  unravelTap: 1100,
  knitNameStep: 7.5,
  groundToPine: 700,
  claimDye: 440,
  tagSwing: 1000,
  tagSwingDelay: 180,
  tagLift: 320,
  reduced: 160,
} as const;

/** Past this share of its height, or on a flick, a dragged sheet closes. */
export const SHEET_DISMISS_FRACTION = 0.3;
/** A back swipe finishes past this distance from the edge, or on a flick. */
export const BACK_SWIPE_DISTANCE = 120;
/** Pixels per millisecond that count as a flick. */
export const FLICK_VELOCITY = 0.6;
/** Only a drag that starts this close to the left edge is a back swipe. */
export const EDGE_WIDTH = 22;
