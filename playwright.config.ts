import {randomBytes, randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {loadEnvFile} from "node:process";
import {defineConfig, devices} from "@playwright/test";

if (existsSync(".env.local")) loadEnvFile(".env.local");

const port = process.env.E2E_PORT || "3100";
const origin = `https://localhost:${port}`;
process.env.E2E_AUTH_SECRET ??= randomBytes(32).toString("base64url");
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
      E2E_PORT: port,
      AUTH_ORIGIN: origin,
      AUTH_SECRET: process.env.E2E_AUTH_SECRET,
      ORGANIZER_INVITE_CODE: process.env.E2E_ORGANIZER_INVITE_CODE,
      LIST_PHOTO_DIR: process.env.LIST_PHOTO_DIR || join(tmpdir(), `fge-playwright-photos-${randomUUID()}`),
    },
    command: "pnpm build && node --import tsx scripts/playwright-server.ts",
    url: origin + "/en",
    ignoreHTTPSErrors: true,
    timeout: 120_000,
  },
});
