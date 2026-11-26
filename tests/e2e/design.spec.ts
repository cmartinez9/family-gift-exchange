import AxeBuilder from "@axe-core/playwright";
import {expect, test, type Page} from "@playwright/test";

// The design gallery runs under `next dev` (see playwright.config.ts): it is development only.

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function axe(page: Page) {
  const results = await new AxeBuilder({page}).analyze();
  return results.violations.map(({id, impact, nodes}) => ({id, impact, targets: nodes.map((node) => node.target.join(" "))}));
}

async function open(page: Page) {
  await page.goto("/dev/design");
  await expect(page.getByRole("heading", {level: 1, name: "The design system"})).toBeVisible();
}

test.describe("the design gallery", () => {
  test("renders every component and state with no accessibility violations", async ({page}) => {
    const errors = collectErrors(page);
    await open(page);
    for (const section of ["Colour", "Type", "Stitched lettering", "Knit", "Yarn blocks", "Gift items", "Buttons", "Navigation",
      "Inputs", "PIN", "Step bar", "Countdown", "Empty, loading and error", "Sheets", "Toasts", "Motion", "Haptics", "Icons"]) {
      await expect(page.getByRole("heading", {level: 2, name: section, exact: true})).toBeAttached();
    }
    // stitched words carry real text
    await expect(page.locator("[data-countdown='24']")).toContainText("24");
    await expect(page.locator("[data-pass]").first()).toContainText("BETO");
    // the floating tab bar from the shared host, with this tab current
    await expect(page.getByRole("navigation", {name: "Tabs", exact: true}).getByRole("link", {name: "Home"})).toHaveAttribute("aria-current", "page");
    expect(await axe(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("honours reduced motion: words appear without knitting and the gift opens at once", async ({page}) => {
    await page.emulateMedia({reducedMotion: "reduce"});
    await open(page);
    const running = await page.locator(".fge-knit .fge-st").evaluateAll((stitches) =>
      stitches.reduce((count, stitch) => count + stitch.getAnimations().length, 0));
    expect(running).toBe(0);
    const reveal = page.locator("[data-demo='reveal']");
    await reveal.getByRole("button", {name: "Or tap here to open it"}).click();
    await expect(reveal.locator("[data-reveal]")).toHaveAttribute("data-reveal", "revealed");
    await expect(reveal.getByRole("progressbar", {name: "Unravelling"})).toHaveAttribute("aria-valuenow", "100");
    await expect(reveal.getByRole("button", {name: "See Beto's list"})).toBeVisible();
    await expect(reveal.locator("[data-reveal-next]")).toHaveCSS("opacity", "1");
    expect(await axe(page)).toEqual([]);
  });

  test("the reveal unravels while the gift is held and keeps pulled rows when let go", async ({page}) => {
    await open(page);
    const reveal = page.locator("[data-demo='reveal']");
    const gift = reveal.getByRole("button", {name: /The knitted gift/});
    await gift.scrollIntoViewIfNeeded();
    const box = (await gift.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(reveal.getByRole("heading", {name: "Keep holding"})).toBeVisible();
    await page.waitForTimeout(600);
    await page.mouse.up();
    const pulled = await reveal.locator(".fge-kr[data-gone='true']").count();
    expect(pulled).toBeGreaterThan(0);
    expect(pulled).toBeLessThan(16);
    await expect(reveal.getByRole("progressbar", {name: "Unravelling"})).not.toHaveAttribute("aria-valuenow", "0");
    await page.waitForTimeout(300);
    expect(await reveal.locator(".fge-kr[data-gone='true']").count()).toBe(pulled);
    await page.mouse.down();
    await expect(reveal.locator("[data-reveal]")).toHaveAttribute("data-reveal", /watching|revealed/, {timeout: 4000});
    await page.mouse.up();
    await expect(reveal.locator("[data-reveal]")).toHaveAttribute("data-reveal", "revealed", {timeout: 5000});
    await expect(reveal.getByRole("progressbar", {name: "Unravelling"})).toHaveAttribute("aria-valuenow", "100");
    await expect(reveal.getByRole("button", {name: "See Beto's list"})).toBeVisible();
  });

  test("the reveal has a tap path and works from the keyboard", async ({page}) => {
    await open(page);
    const reveal = page.locator("[data-demo='reveal']");
    await reveal.getByRole("button", {name: "Or tap here to open it"}).click();
    await expect(reveal.locator("[data-reveal]")).toHaveAttribute("data-reveal", "revealed", {timeout: 5000});

    await page.getByRole("button", {name: "Wrap the gift again"}).click();
    const gift = reveal.getByRole("button", {name: /The knitted gift/});
    await gift.focus();
    await page.keyboard.down("Space");
    await expect(reveal.locator("[data-reveal]")).toHaveAttribute("data-reveal", /watching|revealed/, {timeout: 4000});
    await page.keyboard.up("Space");
    await expect(reveal.locator("[data-reveal]")).toHaveAttribute("data-reveal", "revealed", {timeout: 5000});
  });

  test("sheets close from Escape, the scrim, the close disc and a drag", async ({page}) => {
    await open(page);
    const add = page.getByRole("button", {name: "Add something"});
    const sheet = page.getByRole("dialog", {name: "Add something"});

    await add.click();
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("button", {name: "Close"})).toBeFocused();
    expect(await axe(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    await add.click();
    await expect(sheet).toBeVisible();
    await page.mouse.click(195, 40);
    await expect(sheet).toBeHidden();

    await add.click();
    await sheet.getByRole("button", {name: "Close"}).click();
    await expect(sheet).toBeHidden();

    await add.click();
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(500);
    const grabber = (await sheet.locator("[data-grabber]").boundingBox())!;
    await page.mouse.move(grabber.x + grabber.width / 2, grabber.y + grabber.height / 2);
    await page.mouse.down();
    await page.mouse.move(grabber.x + grabber.width / 2, grabber.y + 260, {steps: 12});
    await page.mouse.up();
    await expect(sheet).toBeHidden();
  });

  test("a toast offers Undo, and a claim dyes the card and hangs the tag", async ({page}) => {
    await open(page);
    await page.getByRole("button", {name: "Toast with Undo"}).click();
    const status = page.getByRole("status").filter({hasText: "Took off the crosswords"});
    await expect(status).toBeVisible();
    await status.getByRole("button", {name: "Undo"}).click();
    await expect(page.getByRole("status").filter({hasText: "Back on your list"})).toBeVisible();

    const claim = page.locator("[data-claimed]");
    await claim.getByRole("button", {name: "I'm getting this"}).click();
    await expect(claim).toHaveAttribute("data-claimed", "true");
    await expect(claim.locator("[data-claim-tag]")).toHaveCSS("opacity", "1", {timeout: 3000});
    await page.getByRole("status").filter({hasText: "Only you know it was you"}).getByRole("button", {name: "Undo"}).click();
    await expect(claim).toHaveAttribute("data-claimed", "false");
  });

  test("a refused PIN says why, and a good one is made", async ({page}) => {
    await open(page);
    const pin = page.locator("#pin");
    for (const digit of "1958") await pin.getByRole("button", {name: digit, exact: true}).click();
    await expect(pin.getByRole("alert")).toContainText("1958 looks like a date or year");
    for (const digit of "2580") await pin.getByRole("button", {name: digit, exact: true}).click();
    await expect(pin.getByRole("alert")).toContainText("That one is easy to guess");
    for (const digit of "4268") await pin.getByRole("button", {name: digit, exact: true}).click();
    await expect(pin.getByText("PIN made")).toBeVisible();
  });

  test("pages push and go back, and the tab bar moves between tabs", async ({page}) => {
    await open(page);
    await page.getByRole("link", {name: "Open a pushed page"}).click();
    await expect(page).toHaveURL(/\/dev\/design\/push$/);
    await expect(page.getByRole("heading", {name: "A pushed page"})).toBeVisible();
    await expect(page).toHaveTitle("A pushed page · Design system");
    expect(await axe(page)).toEqual([]);
    await page.getByRole("link", {name: "Back to Design system"}).click();
    await expect(page).toHaveURL(/\/dev\/design$/);

    const tabs = page.getByRole("navigation", {name: "Tabs", exact: true});
    await tabs.getByRole("link", {name: "Family"}).click();
    await expect(page).toHaveURL(/tab=family/);
    await expect(tabs.getByRole("link", {name: "Family"})).toHaveAttribute("aria-current", "page");
  });

  test("a cancelled edge swipe past the back threshold settles without navigating", async ({page}) => {
    await page.goto("/dev/design/push");
    const surface = page.locator("[data-edge-swipe]");
    await expect(page.getByRole("heading", {name: "A pushed page"})).toBeVisible();
    const box = (await surface.boundingBox())!;
    const pointer = surface.evaluate((element) => new Promise<number>((resolve) => {
      element.addEventListener("pointerdown", (event) => resolve((event as PointerEvent).pointerId), {once: true});
    }));
    await page.mouse.move(box.x + 5, 400);
    await page.mouse.down();
    const pointerId = await pointer;
    await page.mouse.move(box.x + 175, 400, {steps: 10});
    await expect(surface).toHaveCSS("transform", "matrix(1, 0, 0, 1, 170, 0)");
    await surface.dispatchEvent("pointercancel", {pointerId});
    await page.mouse.up();
    await expect(surface).toHaveCSS("transform", "none");
    await expect(surface.locator("..").locator(":scope > [aria-hidden='true']")).toBeHidden();
    await expect(page).toHaveURL(/\/dev\/design\/push$/);
  });

  test("short slow swipes settle, and releasing past the threshold goes back", async ({page}) => {
    await page.goto("/dev/design/push");
    const surface = page.locator("[data-edge-swipe]");
    await expect(page.getByRole("heading", {name: "A pushed page"})).toBeVisible();
    const box = (await surface.boundingBox())!;
    await page.mouse.move(box.x + 5, 400);
    await page.mouse.down();
    await page.mouse.move(box.x + 65, 400, {steps: 8});
    await page.waitForTimeout(400);
    await page.mouse.up();
    await expect(surface).toHaveCSS("transform", "none");
    await expect(page).toHaveURL(/\/dev\/design\/push$/);

    await page.mouse.move(box.x + 5, 400);
    await page.mouse.down();
    await page.mouse.move(box.x + 175, 400, {steps: 10});
    await page.waitForTimeout(400);
    await page.mouse.up();
    await expect(page).toHaveURL(/\/dev\/design$/);
    await expect(page.getByRole("heading", {level: 1, name: "The design system"})).toBeVisible();
  });

  for (const width of [320, 390]) {
    test(`keeps the gallery within a ${width}px phone viewport`, async ({page}) => {
      await page.setViewportSize({width, height: 844});
      await open(page);
      await page.evaluate(() => document.fonts.ready);
      const viewport = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
      }));
      expect(viewport.content).toBeLessThanOrEqual(viewport.width);

      // Check the components too: clipping an overflowing child must not hide a regression.
      const overflow = await page.locator(
        "[data-countdown], [data-claimed], [data-item], [data-budget], [data-pass], #inputs fieldset, [data-step-bar], #steps button",
      ).evaluateAll((elements) => elements
        .filter((element) => element.scrollWidth > element.clientWidth + 1)
        .map((element) => ({text: element.textContent, width: element.clientWidth, content: element.scrollWidth})));
      expect(overflow).toEqual([]);

      const inputs = page.locator("#inputs");
      await inputs.getByText("2XL", {exact: true}).click();
      await expect(inputs.getByRole("radio", {name: "2XL", exact: true})).toBeChecked();
      const claim = page.locator("[data-claimed]");
      await claim.getByRole("button", {name: "I'm getting this"}).click();
      await expect(claim).toHaveAttribute("data-claimed", "true");
      await claim.getByRole("button", {name: "Undo", exact: true}).click();
      await expect(claim).toHaveAttribute("data-claimed", "false");
    });
  }
});
