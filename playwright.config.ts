import {defineConfig, devices} from "@playwright/test";

const origin = "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./tests/e2e",
  forbidOnly: Boolean(process.env.CI),
  use: {baseURL: origin, locale: "en-US", trace: "retain-on-failure"},
  projects: [
    {name: "mobile-chromium", use: {...devices["Pixel 7"]}},
    {name: "mobile-webkit", use: {...devices["iPhone 13"]}},
  ],
  webServer: {
    command: "pnpm build && pnpm start --hostname 127.0.0.1 --port 3100",
    url: origin + "/en",
    timeout: 120_000,
  },
});
