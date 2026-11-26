/** Joins class names, skipping empty ones. */
export function cn(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}
