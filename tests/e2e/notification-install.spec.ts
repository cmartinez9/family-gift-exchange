import AxeBuilder from "@axe-core/playwright";
import {expect, test} from "@playwright/test";

for (const locale of ["en", "es"] as const) {
  test(`shows the installation steps and serves an installable app in ${locale}`, async ({page, request, browserName}) => {
    await page.goto(`/${locale}`);
    const helper = page.getByText(locale === "en"
      ? "Put this on your home screen? Show me how"
      : "¿Quieres poner la aplicación en tu pantalla de inicio? Ver cómo");
    await helper.click();
    // The steps start with the phone in hand, and the other phone's steps are one tap away.
    const iphone = page.getByRole("heading", {name: locale === "en" ? "On your iPhone" : "En tu iPhone"});
    const android = page.getByRole("heading", {name: locale === "en" ? "On your Android phone" : "En tu teléfono Android"});
    const [own, other] = browserName === "chromium" ? [android, iphone] : [iphone, android];
    await expect(own).toBeVisible();
    const guideIcon = page.getByRole("dialog").locator("ol img");
    await expect(guideIcon).toBeVisible();
    await expect.poll(() => guideIcon.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(192);
    const guideIconSource = await guideIcon.getAttribute("src");
    const findIcon = locale === "en" ? "Look for the gift on a green background." : "Busca el regalo sobre fondo verde.";
    await expect(page.getByRole("dialog")).toContainText(findIcon);
    expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
    await page.getByRole("button", {name: locale === "en" ? /^I have an (iPhone|Android phone)$/ : /^Tengo un (iPhone|teléfono Android)$/}).click();
    await expect(other).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText(findIcon);
    await page.getByRole("button", {name: locale === "en" ? "Got it" : "Entendido"}).click();
    await expect(page.getByRole("dialog")).toBeHidden();

    const manifestPaths = await page.locator('link[rel="manifest"]').evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    expect([...new Set(manifestPaths)]).toEqual([`/${locale}/install.webmanifest`]);
    const response = await request.get(manifestPaths[0]!);
    expect(response.headers()["content-type"]).toBe("application/manifest+json");
    const manifest = await response.json();
    expect(manifest).toMatchObject({id: "/", start_url: `/${locale}`, scope: "/", display: "standalone", lang: locale});
    expect(guideIconSource).toBe(manifest.icons.find((entry: {sizes: string}) => entry.sizes === "192x192").src);
    const icon = await request.get(manifest.icons.find((entry: {sizes: string}) => entry.sizes === "512x512").src);
    expect(icon.headers()["content-type"]).toBe("image/png");
    await expect.poll(() => page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return registration?.active?.scriptURL;
    })).toMatch(/\/sw\.js$/);
  });
}
