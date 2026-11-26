import {randomBytes} from "node:crypto";
import {existsSync} from "node:fs";
import {loadEnvFile} from "node:process";
import {defineConfig, devices} from "@playwright/test";

if (existsSync(".env.local")) loadEnvFile(".env.local");

const origin = "https://localhost:3100";
process.env.E2E_ORGANIZER_INVITE_CODE ??= randomBytes(24).toString("base64url");

export default defineConfig({
  testDir: "./tests/e2e",
  forbidOnly: Boolean(process.env.CI),
  use: {baseURL: origin, locale: "en-US", ignoreHTTPSErrors: true, trace: "retain-on-failure"},
  projects: [
    {name: "mobile-chromium", use: {...devices["Pixel 7"]}},
    {name: "mobile-webkit", use: {...devices["iPhone 13"]}},
  ],
  webServer: {
    env: {
      AUTH_ORIGIN: origin,
      AUTH_SECRET: randomBytes(32).toString("base64url"),
      ORGANIZER_INVITE_CODE: process.env.E2E_ORGANIZER_INVITE_CODE,
    },
    command: "pnpm build && node --import tsx scripts/playwright-server.ts",
    url: origin + "/en",
    ignoreHTTPSErrors: true,
    timeout: 120_000,
  },
});
