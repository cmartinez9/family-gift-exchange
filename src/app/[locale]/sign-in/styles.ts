export const inputClass = "block min-h-12 w-full rounded border border-current px-3 py-2";
export const buttonClass = "inline-flex min-h-12 min-w-12 cursor-pointer items-center justify-center rounded bg-foreground px-4 py-2 text-background disabled:opacity-60";
export const linkClass = "inline-flex min-h-12 min-w-12 cursor-pointer items-center py-2 underline underline-offset-4";
export const sectionClass = "mx-auto max-w-xl space-y-5 px-5 py-6 text-lg";
export const activityDateFormat = {
  month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  timeZone: "America/Chicago", timeZoneName: "short",
} as const;
