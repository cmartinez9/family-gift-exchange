/**
 * What a phone would feel, where it can. iPhone Safari has no web vibration, so a haptic is only ever an
 * enhancement, never the only signal.
 *
 * tick: a PIN digit, a size chip, a suggestion, each row of yarn pulled
 * error: a refused or mismatched PIN
 * success: PIN made, Face ID on, all set, your person revealed, names drawn, question sent, key sent
 * firm: "I'm getting this"
 * soft: a sheet put away, a back swipe finished, a tab change
 * light: a small confirmation (pasted, opened, a notice arrived)
 */
export type HapticKind = "tick" | "error" | "success" | "firm" | "soft" | "light";

export const HAPTIC_PATTERNS: Readonly<Record<HapticKind, number | readonly number[]>> = {
  tick: 5,
  soft: 6,
  light: 8,
  firm: 14,
  success: [10, 60, 18],
  error: [24, 40, 24],
};

/** Vibrates where `navigator.vibrate` exists; does nothing anywhere else. Never throws. */
export function haptic(kind: HapticKind): boolean {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return false;
  try {
    const pattern = HAPTIC_PATTERNS[kind];
    return navigator.vibrate(typeof pattern === "number" ? pattern : [...pattern]);
  } catch {
    return false;
  }
}
