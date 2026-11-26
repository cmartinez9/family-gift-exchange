import {defineConfig, globalIgnores} from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig(
  nextVitals,
  nextTypescript,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/server/draw/**"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          regex: "(^|/)draw/schema(?:\\.[cm]?ts)?$",
          message: "Access to pairing tables belongs inside src/server/draw.",
        }],
      }],
    },
  },
  globalIgnores([".next/**", "next-env.d.ts", "playwright-report/**", "test-results/**", "coverage/**"]),
);
