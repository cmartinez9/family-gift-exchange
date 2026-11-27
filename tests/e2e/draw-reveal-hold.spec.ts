import {expect, test} from "@playwright/test";
import {eq} from "drizzle-orm";
import {connectDatabase} from "../../src/server/db/database";
import {families} from "../../src/server/db/schema";
import {practiceFamilies} from "../../src/server/draw/schema";

for (const recipient of ["Starbloom", "Snowquill"]) {
test(`holding, releasing and resuming reveals the complete name ${recipient}`, async ({page}, info) => {
  test.setTimeout(90_000);
  let familyId: string | undefined;
  try {
    await page.goto("/en/start");
    await page.getByLabel("Organizer invitation code").fill(process.env.E2E_ORGANIZER_INVITE_CODE!);
    await page.getByLabel("Family or exchange name").fill("Winter Hold Rehearsal");
    await page.getByLabel("Your name or nickname").fill("Organizer");
    await page.getByLabel("4-digit PIN").fill("4268");
    await page.getByLabel("Type the PIN again").fill("4268");
    await page.getByRole("button", {name: "Create my family"}).click();
    await page.getByRole("link", {name: "Not now"}).click();
    await expect(page.getByRole("heading", {name: "What should we call it?"})).toBeVisible();
    familyId = (await page.context().cookies()).find(({name}) => name === "__Host-fge-session")!.value.split(".")[0];
    await page.goto("/en/exchanges/practice");
    await page.getByRole("button", {name: "Start practice"}).click();
    await page.getByRole("button", {name: "Draw names", exact: true}).click();
    const pairing = await page.getByRole("listitem").filter({hasText: new RegExp(` gives to ${recipient}$`)}).innerText();
    const giver = pairing.replace(` gives to ${recipient}`, "");
    await page.getByRole("link", {name: giver, exact: true}).click();

    const gift = page.getByRole("button", {name: /^The knitted gift/});
    const progress = page.getByRole("progressbar", {name: "Unravelling"});
    await gift.focus();
    await page.keyboard.down("Space");
    await expect.poll(async () => Number(await progress.getAttribute("aria-valuenow"))).toBeGreaterThan(15);
    await page.keyboard.up("Space");
    await expect(page.getByText("Let go any time. Hold to keep pulling.", {exact: true})).toBeVisible();
    const paused = Number(await progress.getAttribute("aria-valuenow"));
    expect(paused).toBeLessThan(100);
    await page.waitForTimeout(250);
    await expect(progress).toHaveAttribute("aria-valuenow", String(paused));
    await expect(page.getByRole("heading", {level: 1})).toHaveText("Keep holding");
    await page.screenshot({path: info.outputPath("gift-hold-paused.png"), fullPage: true});

    await gift.focus();
    await page.keyboard.down("Space");
    await expect(progress).toHaveAttribute("aria-valuenow", "100", {timeout: 15_000});
    await page.keyboard.up("Space");
    await expect(page.getByRole("heading", {level: 1})).toHaveText(`You’re giving to ${recipient}`, {timeout: 15_000});
    await page.getByRole("button", {name: `See ${recipient}’s page`, exact: true}).click({trial: true});
    await page.screenshot({path: info.outputPath("gift-hold-resumed-and-revealed.png"), fullPage: true});
    const nameGraphic = page.locator("svg").filter({has: page.locator("path.fge-nm")})
      .or(page.getByText(recipient, {exact: true}));
    const viewport = page.viewportSize()!;
    for (const width of [viewport.width, 320]) {
      await page.setViewportSize({...viewport, width});
      const bounds = await nameGraphic.evaluate((element) => {
        if (element instanceof SVGSVGElement) return [element.getBoundingClientRect().toJSON()];
        const range = document.createRange();
        range.selectNodeContents(element);
        return Array.from(range.getClientRects(), (rect) => rect.toJSON());
      });
      await info.attach(`revealed-name-bounds-${width}`, {
        body: JSON.stringify({recipient, bounds, viewportWidth: width}), contentType: "application/json",
      });
      expect(bounds.length).toBeGreaterThan(0);
      for (const rect of bounds) {
        expect.soft(rect.x, "The complete recipient name fits on the phone").toBeGreaterThanOrEqual(0);
        expect.soft(rect.right, "The complete recipient name fits on the phone").toBeLessThanOrEqual(width);
      }
      await page.screenshot({path: info.outputPath(`gift-revealed-${width}.png`), fullPage: true});
    }
    await page.getByRole("button", {name: `See ${recipient}’s page`, exact: true}).click();
    await expect(page.getByRole("heading", {level: 1})).toHaveText(`You’re giving to ${recipient}`);
  } finally {
    if (familyId) {
      const db = connectDatabase((process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL)!);
      try {
        const practice = await db.db.select().from(practiceFamilies).where(eq(practiceFamilies.familyId, familyId));
        await db.db.delete(families).where(eq(families.id, familyId));
        for (const row of practice) await db.db.delete(families).where(eq(families.id, row.practiceFamilyId));
      } finally { await db.close(); }
    }
  }
});
}
