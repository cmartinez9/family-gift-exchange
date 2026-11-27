import {execFile} from "node:child_process";
import {randomUUID} from "node:crypto";
import {promisify} from "node:util";
import {devices, expect, test, type Page} from "@playwright/test";
import {eq} from "drizzle-orm";
import en from "../../messages/en.json" with {type: "json"};
import es from "../../messages/es.json" with {type: "json"};
import {connectDatabase, runForFamily} from "../../src/server/db/database";
import {claims, exchanges, families, items, outbox, people} from "../../src/server/db/schema";
import {tomorrowInExchangeCalendar} from "../../src/server/messages/calendar";
import {openKey, skipFaceId} from "../helpers/pin-pad";
import {openFamilyAfterDetails} from "../helpers/family-setup";

const execute = promisify(execFile);
const pin = "4268";

async function capture(page: Page, name: string) {
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({path, fullPage: true});
  await test.info().attach(name, {path, contentType: "image/png"});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

for (const language of ["en", "es"] as const) {
  test(`ordinary wishlist and budget mutations notify privately, and reminders and helper inboxes work in ${language}`, async ({page, browser, browserName, request}) => {
    test.setTimeout(120_000);
    const {auth, helping, lists, notify, getIn} = language === "en" ? en : es;
    const {db, close} = connectDatabase(process.env.DATABASE_URL!);
    const guest = await browser.newContext({
      ...devices[browserName === "chromium" ? "Pixel 7" : "iPhone 13"], ignoreHTTPSErrors: true,
    });
    let familyId: string | undefined;
    try {
      await page.goto(`/${language}/start`);
      await page.getByLabel(auth.organizerInvite).fill(process.env.E2E_ORGANIZER_INVITE_CODE!);
      await page.getByLabel(auth.familyName).fill(`Notification ${randomUUID().slice(0, 6)}`);
      await page.getByLabel(auth.yourName).fill("Holly");
      await page.getByLabel(auth.pin, {exact: true}).fill(pin);
      await page.getByLabel(auth.confirmPin).fill(pin);
      await page.getByRole("button", {name: auth.createFamily}).click();
      await expect(page.getByRole("heading", {name: getIn.face.title})).toBeVisible();
      await page.getByRole("link", {name: auth.notNow}).click();
      await openFamilyAfterDetails(page, language);
      familyId = (await page.context().cookies()).find(({name}) => name === "__Host-fge-session")!.value.split(".")[0];
      const scoped = <T,>(fn: Parameters<typeof runForFamily<T>>[2]) => runForFamily(db, familyId!, fn);

      for (const name of ["Noel", "Cedar"]) {
        await page.locator("summary").filter({hasText: new RegExp(`^${auth.addMember}$`)}).click();
        const form = page.locator("form").filter({has: page.getByRole("button", {name: auth.addMember, exact: true})});
        await form.getByLabel(auth.name).fill(name);
        await form.getByLabel(auth.language).selectOption(language);
        if (name === "Cedar") await form.getByLabel(auth.helper).selectOption({label: "Noel"});
        await form.getByRole("button", {name: auth.addMember, exact: true}).click();
        await expect(page.getByRole("heading", {name, exact: true})).toBeVisible();
        await page.reload();
      }
      await page.getByRole("link", {name: auth.sendKeys}).click();
      await page.getByRole("button", {name: auth.prepareKey, exact: true}).click();
      const message = page.getByText(language === "en" ? /^Hi Noel! This is your private key/ : /^¡Hola, Noel!/);
      const url = (await message.innerText()).split(" ").at(-1)!;
      const buyer = await guest.newPage();
      const markAsRead = buyer.getByRole("button", {name: notify.inbox.markRead, exact: true});
      await openKey(buyer, url, pin, language);
      await skipFaceId(buyer, language);

      const roster = await scoped((tx) => tx.select().from(people));
      const ownerId = roster.find(({displayName}) => displayName === "Holly")!.id;
      const buyerId = roster.find(({displayName}) => displayName === "Noel")!.id;
      const dependentId = roster.find(({displayName}) => displayName === "Cedar")!.id;
      await page.goto(`/${language}/lists/${ownerId}`);
      await page.getByRole("link", {name: lists.newNote}).click();
      await page.getByLabel(lists.title).fill("Private winter puzzle");
      await page.getByRole("textbox", {name: lists.note, exact: true}).fill("Blue box");
      await page.getByRole("button", {name: lists.saveItem}).click();
      const card = page.getByRole("article", {name: "Private winter puzzle"});
      await expect(card).toBeVisible();
      await buyer.goto(`/${language}/lists/${ownerId}`);
      await buyer.getByRole("button", {name: lists.claim, exact: true}).click();
      await expect(buyer.getByText(lists.mine, {exact: true})).toBeVisible();
      const [claim] = await scoped((tx) => tx.select().from(claims));
      expect(claim.exchangeId).toBeNull();
      await page.reload();
      await expect(card.getByText(lists.someone, {exact: true})).toHaveCount(0);
      await card.getByRole("link", {name: lists.editNamedItem.replace("{title}", "Private winter puzzle")}).click();
      await page.getByRole("button", {name: lists.saveItem}).click();
      await expect(card).toBeVisible();
      expect(await scoped((tx) => tx.select().from(outbox))).toEqual([]);
      await card.getByRole("link", {name: lists.editNamedItem.replace("{title}", "Private winter puzzle")}).click();
      await page.getByRole("textbox", {name: lists.note, exact: true}).fill("Red box instead");
      await page.getByRole("button", {name: lists.saveItem}).click();
      await expect(card.getByText("Red box instead", {exact: true})).toBeVisible();
      await card.getByText(lists.deleteItem, {exact: true}).click();
      await card.getByRole("button", {name: lists.confirmDeleteButton}).click();
      await expect(card).toHaveCount(0);
      expect(await scoped((tx) => tx.select().from(claims))).toEqual([]);
      expect(await scoped((tx) => tx.select().from(items))).toMatchObject([{id: claim.itemId, archivedAt: expect.any(Date)}]);

      await page.goto(`/${language}/notifications?personId=${buyerId}`);
      await expect(page.getByText(notify.inbox.empty, {exact: true})).toBeVisible();
      await buyer.goto(`/${language}/notifications`);
      await expect(buyer.getByRole("heading", {name: notify.templates["claimed-item-changed"].title, exact: true})).toHaveCount(2);
      await expect(buyer.getByText("Private winter puzzle", {exact: false})).toHaveCount(0);
      const itemRows = await scoped((tx) => tx.select().from(outbox));
      expect(itemRows).toMatchObject(Array.from({length: 2}, () => ({
        personId: buyerId, language, template: "claimed-item-changed", requesterName: null,
      })));
      for (const privateValue of [claim.id, claim.itemId, "Private winter puzzle", "Blue box", "Red box instead"]) {
        expect(JSON.stringify(itemRows)).not.toContain(privateValue);
      }
      await capture(buyer, `claimed-item-notices-${language}`);
      // Replay another person's valid native form with the organizer's session.
      // The action must authorize the current viewer rather than trust its bound notice ID.
      const readForm = buyer.locator("form").filter({has: markAsRead}).first();
      const forgedForm = await readForm.evaluate((form: HTMLFormElement) => Object.fromEntries(new FormData(form)) as Record<string, string>);
      const replay = await page.request.post(`/${language}/notifications`, {
        form: forgedForm, headers: {origin: new URL(page.url()).origin},
      });
      expect(replay.status()).toBe(200);
      expect((await scoped((tx) => tx.select().from(outbox))).every(({readAt}) => readAt === null)).toBe(true);
      await markAsRead.first().click();
      await expect(markAsRead).toHaveCount(1);
      await buyer.goto(`/${language}/account`);
      await expect(buyer.getByRole("link", {name: new RegExp(`^${getIn.you.notices}.*${language === "en" ? "1 new" : "1 nuevo"}`)})).toBeVisible();
      await buyer.goto(`/${language}/notifications`);
      await markAsRead.click();
      await expect(markAsRead).toHaveCount(0);
      await buyer.reload();
      await expect(markAsRead).toHaveCount(0);

      const [exchange] = await scoped((tx) => tx.select().from(exchanges));
      await scoped((tx) => tx.update(exchanges).set({status: "drawn"}).where(eq(exchanges.id, exchange.id)));
      // Exercise the real draw notification hooks; the draw UI belongs to the next phase.
      await execute(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `
        import {registerHooks} from 'node:module';
        // Match Next's server-side resolution of this import-boundary sentinel.
        registerHooks({resolve(specifier, context, next) {
          return specifier === 'server-only'
            ? {url: new URL('./node_modules/server-only/empty.js', import.meta.url).href, shortCircuit: true}
            : next(specifier, context);
        }});
        const {drawEvents} = await import('./src/server/messages/events.ts');
        await drawEvents.namesDrawn({familyId: process.argv[1], exchangeId: process.argv[2]});
        await drawEvents.plansChanged({familyId: process.argv[1], exchangeId: process.argv[2], personIds: [process.argv[3]]});
      `, familyId, exchange.id, buyerId], {env: {...process.env, VERCEL_ENV: "preview"}});
      await page.goto(`/${language}/notifications`);
      await expect(page.getByRole("heading", {name: notify.templates["names-drawn"].title, exact: true})).toBeVisible();
      await expect(page.getByRole("heading", {name: notify.templates["plans-changed"].title, exact: true})).toHaveCount(0);
      await buyer.goto(`/${language}/notifications`);
      await expect(buyer.getByRole("heading", {name: notify.templates["plans-changed"].title, exact: true})).toBeVisible();
      await capture(buyer, `draw-and-change-notices-${language}`);

      await page.goto(`/${language}/lists`);
      await page.getByText(lists.budget, {exact: true}).first().click();
      await page.getByLabel(lists.budget, {exact: true}).fill("45");
      const saveBudget = page.getByRole("button", {name: lists.saveBudget, exact: true});
      await saveBudget.click();
      await expect.poll(async () => (await scoped((tx) => tx.select().from(outbox))).filter(({template}) => template === "budget-changed").length).toBe(3);
      await saveBudget.click();
      await expect(saveBudget).toBeEnabled();
      const budgetRows = (await scoped((tx) => tx.select().from(outbox))).filter(({template}) => template === "budget-changed");
      expect(budgetRows.map(({personId}) => personId).sort()).toEqual([ownerId, buyerId, dependentId].sort());

      await scoped((tx) => tx.update(exchanges).set({
        listDeadline: tomorrowInExchangeCalendar(new Date()), giftDay: tomorrowInExchangeCalendar(new Date()),
      }).where(eq(exchanges.id, exchange.id)));
      const countBeforeCron = (await scoped((tx) => tx.select().from(outbox))).length;
      expect((await request.get("/api/cron/notifications")).status()).toBe(401);
      expect((await request.get("/api/cron/notifications", {headers: {authorization: "Bearer invalid"}})).status()).toBe(401);
      expect((await scoped((tx) => tx.select().from(outbox))).length).toBe(countBeforeCron);
      for (let index = 0; index < 2; index++) {
        expect((await request.get("/api/cron/notifications", {headers: {authorization: `Bearer ${process.env.E2E_CRON_SECRET}`}})).status()).toBe(204);
      }
      const finalRows = await scoped((tx) => tx.select().from(outbox));
      for (const template of ["list-reminder", "gift-day-reminder"]) {
        expect(finalRows.filter((row) => row.template === template).map(({personId}) => personId).sort())
          .toEqual([ownerId, buyerId, dependentId].sort());
      }
      await buyer.goto(`/${language}/notifications`);
      await expect(buyer.getByRole("heading", {name: notify.templates["list-reminder"].title, exact: true})).toBeVisible();
      await expect(buyer.getByRole("heading", {name: notify.templates["gift-day-reminder"].title, exact: true})).toBeVisible();
      await capture(buyer, `budget-and-reminders-${language}`);

      await buyer.goto(`/${language}/account`);
      await buyer.getByRole("button", {name: auth.helpAs.replace("{name}", "Cedar"), exact: true}).click();
      // The shared banner can render before helping redirects to Cedar's list.
      await expect(buyer).toHaveURL(`/${language}/lists/${dependentId}`);
      await expect(buyer.getByRole("region", {name: helping.label})).toContainText(helping.banner.replace("{name}", "Cedar"));
      await buyer.goto(`/${language}/notifications`);
      await expect(buyer.getByRole("heading", {name: notify.templates["names-drawn"].title, exact: true})).toBeVisible();
      await expect(buyer.getByRole("heading", {name: notify.templates["claimed-item-changed"].title, exact: true})).toHaveCount(0);
      await expect(buyer.getByRole("heading", {name: notify.templates["plans-changed"].title, exact: true})).toHaveCount(0);
      const helperUnreadCount = await markAsRead.count();
      await markAsRead.first().click();
      await expect(markAsRead).toHaveCount(helperUnreadCount - 1);
      await capture(buyer, `helper-inbox-${language}`);
      const dependentRows = (await scoped((tx) => tx.select().from(outbox))).filter(({personId}) => personId === dependentId);
      expect(dependentRows.filter(({readAt}) => readAt !== null)).toHaveLength(1);
      expect(finalRows.filter(({personId, readAt}) => personId === ownerId && readAt !== null)).toEqual([]);
      await test.info().attach(`notification-state-${language}`, {body: JSON.stringify({
        claimWithoutExchange: claim.exchangeId === null,
        events: finalRows.map(({personId, template, language, status, readAt}) => ({
          recipient: roster.find(({id}) => id === personId)!.displayName, template, language, status, readAt,
        })),
        unauthorizedCron: 401, authorizedCron: 204, repeatedCronAddedDuplicates: false,
        organizerReadActionReplayChangedRecipientState: false,
      }, null, 2), contentType: "application/json"});
    } finally {
      await guest.close();
      if (familyId) await runForFamily(db, familyId, (tx) => tx.delete(families).where(eq(families.id, familyId!)).execute());
      await close();
    }
  });
}
