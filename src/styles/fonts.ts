import localFont from "next/font/local";

/**
 * Rubik, self-hosted: the variable font (weights 400 to 800) for the Latin subset, which covers English
 * and Spanish. Licensed under the SIL Open Font License 1.1; see ./fonts/OFL.txt.
 */
export const rubik = localFont({
  src: "./fonts/rubik-latin.woff2",
  weight: "400 800",
  style: "normal",
  display: "swap",
  variable: "--font-rubik",
  fallback: ["system-ui", "sans-serif"],
});
