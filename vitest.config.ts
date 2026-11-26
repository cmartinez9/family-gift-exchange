import {existsSync} from "node:fs";
import {loadEnvFile} from "node:process";
import {defineConfig} from "vitest/config";

if (existsSync(".env.local")) {
  loadEnvFile(".env.local");
}

export default defineConfig({
  test: {
    projects: [
      {test: {name: "unit", include: ["tests/unit/**/*.test.ts"]}},
      {test: {name: "integration", include: ["tests/integration/**/*.test.ts"]}},
    ],
  },
});
