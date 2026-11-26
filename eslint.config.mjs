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
          regex: "(^|/)draw/(?!index(?:\\.[cm]?ts)?$)",
          message: "Import the draw module through src/server/draw/index.",
        }],
      }],
    },
  },
  globalIgnores([".next/**", "next-env.d.ts", "playwright-report/**", "test-results/**", "coverage/**"]),
);
