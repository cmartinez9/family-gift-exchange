import {randomBytes, randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {loadEnvFile} from "node:process";
import {defineConfig, devices} from "@playwright/test";
import {generateVAPIDKeys} from "web-push";

if (existsSync(".env.local")) loadEnvFile(".env.local");

const port = process.env.E2E_PORT || "3100";
const origin = `https://localhost:${port}`;
const vapid = generateVAPIDKeys();
// The design gallery is development only, so its tests run against `next dev` (Next keeps dev output apart from the build).
const designPort = process.env.E2E_DESIGN_PORT || "3101";
const designOrigin = `http://localhost:${designPort}`;
const design = /design\.spec\.ts$/;
const phone = {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true};
process.env.E2E_AUTH_SECRET ??= randomBytes(32).toString("base64url");
process.env.E2E_ORGANIZER_INVITE_CODE ??= randomBytes(24).toString("base64url");
process.env.E2E_CRON_SECRET ??= process.env.CRON_SECRET || randomBytes(32).toString("base64url");
const drawKey = randomBytes(32).toString("base64");

export default defineConfig({
  testDir: "./tests/e2e",
  forbidOnly: Boolean(process.env.CI),
  use: {baseURL: origin, locale: "en-US", ignoreHTTPSErrors: true, trace: "retain-on-failure"},
  projects: [
    {name: "mobile-chromium", testIgnore: design, use: {
      ...devices["Pixel 7"],
      // Chromium's service-worker fetch uses its own certificate checks for the local test server.
      launchOptions: {args: ["--ignore-certificate-errors"]},
    }},
    {name: "mobile-webkit", testIgnore: design, use: {...devices["iPhone 13"]}},
    {name: "design-chromium", testMatch: design, use: {...devices["Pixel 7"], ...phone, baseURL: designOrigin}},
    {name: "design-webkit", testMatch: design, use: {...devices["iPhone 13"], ...phone, baseURL: designOrigin}},
  ],
  webServer: [{
    env: {
      E2E_PORT: port,
      AUTH_ORIGIN: origin,
      AUTH_SECRET: process.env.E2E_AUTH_SECRET,
      ORGANIZER_INVITE_CODE: process.env.E2E_ORGANIZER_INVITE_CODE,
      CRON_SECRET: process.env.E2E_CRON_SECRET,
      VERCEL_ENV: "preview",
      VAPID_SUBJECT: origin,
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      LIST_PHOTO_DIR: process.env.LIST_PHOTO_DIR || join(tmpdir(), `fge-playwright-photos-${randomUUID()}`),
      DRAW_DATABASE_URL: process.env.E2E_DRAW_DATABASE_URL ?? process.env.DATABASE_URL ?? "",
      ASSIGNMENT_ENCRYPTION_KEY: drawKey,
    },
    command: "pnpm build && node --import tsx scripts/playwright-server.ts",
    url: origin + "/en",
    ignoreHTTPSErrors: true,
    timeout: 120_000,
  }, {
    command: `pnpm exec next dev --port ${designPort}`,
    url: designOrigin + "/dev/design",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  }],
});
