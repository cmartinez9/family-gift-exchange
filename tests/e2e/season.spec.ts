import {randomUUID} from "node:crypto";
import {devices, expect, test, type BrowserContext, type Page} from "@playwright/test";
import {and, eq} from "drizzle-orm";
import en from "../../messages/en.json" with {type: "json"};
import es from "../../messages/es.json" with {type: "json"};
import {connectDatabase, runForFamily} from "../../src/server/db/database";
import {families, outbox, people} from "../../src/server/db/schema";
import {openKey} from "../helpers/pin-pad";

const organizer = "Holly";
const guests = ["Cedar", "Juniper", "Maple", "Spruce"];
const roster = [organizer, ...guests];
const pin = "4268";
const gift = "Winter lantern";
const question = "¿Azul o verde?";
const answer = "Verde esmeralda fosforescente";
const lastGuest = guests.at(-1)!;
type TrialNotice = "names-drawn" | "plans-changed" | "budget-changed" | "claimed-item-changed" | "question-answered";

test.use({actionTimeout: 15_000});

function summary(page: Page, label: string) {
  return page.locator("summary").and(page.getByText(label, {exact: true}));
}

for (const language of ["en", "es"] as const) {
  test(`plays a private gift exchange season in ${language}`, async ({page, browser, browserName}, info) => {
    test.setTimeout(120_000);
    const {auth, draw, getIn, lists, notify} = language === "en" ? en : es;
    const path = (pathname = "") => `/${language}${pathname}`;
    const trialFamily = `Practice ${randomUUID().slice(0, 8)}`;
    const {db, close} = connectDatabase(process.env.DATABASE_URL!);
    const device = devices[browserName === "chromium" ? "Pixel 7" : "iPhone 13"];
    const contexts: BrowserContext[] = [];
    const memberPages = new Map([[organizer, page]]);
    const captured = new Set<string>();
    let familyId: string | undefined;

    async function notices(stage: string, template?: TrialNotice, destinations: string[] = [], cancelled: string[] = []) {
      const rows = await runForFamily(db, familyId!, (tx) => tx.select({
        id: outbox.id, person: people.displayName, language: outbox.language,
        template: outbox.template, requesterName: outbox.requesterName, status: outbox.status,
      }).from(outbox).innerJoin(people, and(eq(outbox.familyId, people.familyId), eq(outbox.personId, people.id))));
      const fresh = rows.filter(({id}) => !captured.has(id));
      expect(fresh.map(({person}) => person).sort()).toEqual([...destinations, ...cancelled].sort());
      for (const row of fresh) {
        expect(row).toMatchObject({
          template: cancelled.includes(row.person) ? "participation-cancelled" : template,
          language, requesterName: null, status: "captured",
        });
        captured.add(row.id);
      }
      await info.attach(stage, {contentType: "application/json", body: JSON.stringify(fresh.map(({person, template: sentTemplate}) => ({
        person, language, template: sentTemplate, ...notify.templates[sentTemplate as keyof typeof notify.templates],
      })), null, 2)});
    }

    async function addItem(member: Page, ownerId: string, title: string) {
      await member.goto(path(`/lists/${ownerId}/items/new?kind=note`));
      await member.getByLabel(lists.title).fill(title);
      await member.getByLabel(lists.price).fill("32");
      await member.getByRole("button", {name: lists.saveItem, exact: true}).click();
      await expect(member.getByRole("article", {name: title, exact: true})).toBeVisible();
    }

    async function join(name: string, keyUrl: string) {
      const context = await browser.newContext({...device, ignoreHTTPSErrors: true, locale: language});
      contexts.push(context);
      const member = await context.newPage();
      await openKey(member, keyUrl, pin, language);
      await member.getByRole("link", {name: auth.notNow}).click();
      memberPages.set(name, member);
      return member;
    }

    async function visibleRecipient(member: Page) {
      const reveal = member.getByRole("status").filter({hasText: /.+/});
      await expect(reveal).toBeVisible();
      const revealed = await reveal.innerText();
      const recipient = roster.find((candidate) => revealed === draw.givingTo.replace("{name}", candidate));
      expect(recipient).toBeDefined();
      return recipient!;
    }

    try {
      await page.goto(path("/start"));
      await page.getByLabel(auth.organizerInvite).fill(process.env.E2E_ORGANIZER_INVITE_CODE!);
      await page.getByLabel(auth.familyName).fill(trialFamily);
      await page.getByLabel(auth.yourName).fill(organizer);
      await page.getByLabel(auth.pin, {exact: true}).fill(pin);
      await page.getByLabel(auth.confirmPin).fill(pin);
      await page.getByRole("button", {name: auth.createFamily}).click();
      await page.getByRole("link", {name: auth.notNow}).click();
      await expect(page.getByRole("heading", {name: trialFamily})).toBeVisible();
      familyId = (await page.context().cookies()).find(({name}) => name === "__Host-fge-session")!.value.split(".")[0];

      for (const name of guests) {
        await page.goto(path("/family"));
        await summary(page, auth.addMember).click();
        const add = page.locator("details[open]").filter({
          has: page.getByRole("button", {name: auth.addMember, exact: true}),
        });
        await add.getByRole("textbox", {name: auth.name}).fill(name);
        await add.getByRole("button", {name: auth.addMember, exact: true}).click();
        await expect(page.getByRole("heading", {name, exact: true})).toBeVisible();
      }

      await page.getByRole("link", {name: auth.sendKeys}).click();
      let lastKey = "";
      for (const name of guests) {
        const row = page.getByRole("listitem").filter({has: page.getByRole("heading", {name, exact: true})});
        await row.getByRole("button", {name: auth.prepareKey}).click();
        const message = row.getByText(auth.keyMessage.split("{url}")[0].replace("{name}", name).trim(), {exact: false});
        const keyUrl = (await message.innerText()).split(" ").at(-1)!;
        await row.getByRole("button", {name: auth.markSent}).click();
        await expect(row.getByText(auth.feedback.sent)).toBeVisible();

        if (name === lastGuest) {
          lastKey = keyUrl;
        } else {
          const member = await join(name, keyUrl);
          await expect(member.getByRole("heading", {name: getIn.sizes.title})).toBeVisible();
        }
      }
      await notices("keys and joins");
      const members = await runForFamily(db, familyId, (tx) => tx.select({
        id: people.id, name: people.displayName,
      }).from(people));
      const ids = new Map(members.map(({id, name}) => [name, id]));
      const listPath = (name: string) => path(`/lists/${ids.get(name)}`);
      const [owner, buyer] = guests.map((name) => memberPages.get(name)!);
      for (const [name, member] of memberPages) {
        await addItem(member, ids.get(name)!, name === guests[0] ? gift : `${name} puzzle`);
      }
      await buyer.goto(path("/lists"));
      const listMemberLinks = buyer.locator("main li a");
      const before = await listMemberLinks.allTextContents();
      expect(before).toEqual([...roster].sort());
      await expect(buyer.getByRole("heading", {name: lists.otherLists})).toHaveCount(0);
      await buyer.goto(listPath(guests[0]));
      const buyerItem = buyer.getByRole("article", {name: gift});
      await buyerItem.getByRole("button", {name: lists.claim, exact: true}).click();
      await expect(buyerItem.getByText(lists.mine)).toBeVisible();
      await notices("claim");

      const ownerResponse = await owner.goto(listPath(guests[0]));
      const ownerItem = owner.getByRole("article", {name: gift});
      await expect(ownerItem.getByText(lists.someone)).toHaveCount(0);
      await expect(ownerItem.getByText(lists.mine)).toHaveCount(0);
      await expect(ownerItem.getByRole("button", {name: lists.claim, exact: true})).toHaveCount(0);
      const ownerPayload = (await ownerResponse!.text()).replaceAll('\\"', '"');
      expect(/"claimerId"\s*:|"claim"\s*:\s*"(?:mine|someone)"/.test(ownerPayload)).toBe(false);
      await ownerItem.getByRole("link", {name: lists.editNamedItem.replace("{title}", gift)}).click();
      await owner.getByRole("textbox", {name: lists.note, exact: true}).fill("Warm white only");
      await owner.getByRole("button", {name: lists.saveItem, exact: true}).click();
      await expect(ownerItem.getByText("Warm white only")).toBeVisible();
      await notices("claimed item edited", "claimed-item-changed", [guests[1]]);
      await ownerItem.getByText(lists.deleteItem, {exact: true}).click();
      await ownerItem.getByRole("button", {name: lists.confirmDeleteButton}).click();
      await expect(ownerItem).toHaveCount(0);
      await notices("claimed item deleted", "claimed-item-changed", [guests[1]]);

      const managementResponses: Promise<string>[] = [];
      page.on("response", (response) => {
        const url = new URL(response.url());
        if (response.ok() && url.pathname.includes("/exchanges/") &&
            (url.pathname.endsWith("/manage") || url.pathname.includes("/preview/"))) {
          managementResponses.push(response.text());
        }
      });
      await page.goto(path("/exchanges"));
      await page.getByRole("link", {name: trialFamily, exact: true}).click();
      await expect(page).toHaveURL(/\/manage$/);
      const manageUrl = page.url();
      const memberUrl = manageUrl.replace(/\/manage$/, "");
      await summary(page, draw.roster).click();
      for (const name of roster) await page.getByRole("checkbox", {name, exact: true}).check();
      await page.getByRole("button", {name: draw.saveRoster}).click();
      await expect(page.getByText(draw.ready, {exact: true})).toBeVisible();
      await summary(page, draw.drawNames).click();
      await page.getByRole("button", {name: draw.confirmDraw}).click();
      const openedCount = (seen: number, total: number) => draw.seen.replace("{seen}", String(seen)).replace("{total}", String(total));
      await expect(page.getByText(openedCount(0, 5))).toBeVisible();
      await notices("draw", "names-drawn", roster);

      const after = new Map<string, string>();
      const newcomer = await join(lastGuest, lastKey);
      await expect(newcomer.getByRole("heading", {name: draw.yourPerson})).toBeVisible();
      for (const candidate of roster) {
        await expect(newcomer.getByText(draw.givingTo.replace("{name}", candidate), {exact: true})).toHaveCount(0);
      }
      await newcomer.getByRole("button", {name: draw.reveal}).click();
      const newcomerRecipient = await visibleRecipient(newcomer);
      after.set(lastGuest, newcomerRecipient);
      await newcomer.getByRole("link", {name: getIn.sizes.title}).click();
      await expect(newcomer.getByRole("heading", {name: getIn.sizes.title})).toBeVisible();
      await newcomer.goto(path("/welcome/done"));
      await expect(newcomer.getByText(lists.givingTo.replace("{name}", newcomerRecipient), {exact: true})).toBeVisible();
      await addItem(newcomer, ids.get(lastGuest)!, `${lastGuest} puzzle`);

      for (const name of guests.slice(1, -1)) {
        const member = memberPages.get(name)!;
        await member.goto(path());
        await member.getByRole("link", {name: draw.reveal}).click();
        await expect(member).toHaveURL(memberUrl);
        await member.getByRole("button", {name: draw.reveal}).click();
        after.set(name, await visibleRecipient(member));
      }
      const [giver, recipient] = [...after].find(([, name]) => name !== organizer && name !== guests[0])!;
      const giverPage = memberPages.get(giver)!;
      const recipientPage = memberPages.get(recipient)!;
      const givingTo = lists.givingTo.replace("{name}", recipient);
      for (const route of [path(), path("/lists")]) {
        await giverPage.goto(route);
        const match = giverPage.getByRole("region", {name: givingTo});
        await expect(match).toBeVisible();
        await expect(match.getByRole("link", {name: lists.openList})).toHaveAttribute("href", listPath(recipient));
        const otherHeading = giverPage.getByRole("heading", {name: lists.otherLists});
        await expect(otherHeading).toBeVisible();
        expect(await match.evaluate((section, selector) => {
          const other = [...document.querySelectorAll("h2")].find((heading) => heading.textContent === selector);
          return Boolean(other && (section.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING));
        }, lists.otherLists)).toBe(true);
      }
      await giverPage.goto(listPath(recipient));
      await expect(giverPage.getByText(lists.yourPerson, {exact: true})).toBeVisible();
      await recipientPage.goto(listPath(recipient));
      await expect(recipientPage.getByText(lists.yourPerson, {exact: true})).toHaveCount(0);

      await giverPage.goto(memberUrl);
      await giverPage.getByLabel(draw.askLabel).fill(question);
      await giverPage.getByRole("button", {name: draw.askButton}).click();
      await expect(giverPage.getByText(draw.answerPending)).toBeVisible();
      await notices("reveal and anonymous question");
      await recipientPage.goto(memberUrl);
      await expect(recipientPage.getByText(question, {exact: true})).toBeVisible();
      await recipientPage.getByLabel(draw.answerLabel).fill(answer);
      await recipientPage.getByRole("button", {name: draw.answerButton}).click();
      await expect(recipientPage.getByText(draw.answered)).toBeVisible();
      await expect(recipientPage.getByText(answer, {exact: true})).toHaveCount(0);
      await giverPage.reload();
      await expect(giverPage.getByText(answer, {exact: true})).toBeVisible();
      await notices("anonymous answer", "question-answered", [giver]);
      async function privateNotice(template: "question-answered" | "plans-changed") {
        await giverPage.goto(path("/notifications"));
        const message = notify.templates[template];
        await expect(giverPage.getByText(message.title, {exact: true})).toBeVisible();
        await expect(giverPage.getByText(message.body, {exact: true})).toBeVisible();
        for (const secret of [question, answer, ...roster]) {
          await expect(giverPage.getByText(secret, {exact: true})).toHaveCount(0);
        }
      }
      await privateNotice("question-answered");

      await page.goto(manageUrl);
      await summary(page, draw.detailsTitle).click();
      await page.getByLabel(draw.budget, {exact: true}).fill("25");
      await page.getByRole("button", {name: draw.saveDetails}).click();
      await expect(page.getByText(draw.detailsSaved)).toBeVisible();
      await notices("budget changed", "budget-changed", roster);
      await giverPage.goto(listPath(recipient));
      await expect(giverPage.getByText(lists.overBudget, {exact: true})).toBeVisible();

      await summary(page, draw.participation).click();
      await page.getByRole("button", {name: draw.dropout.replace("{name}", recipient)}).click();
      await expect(page.getByRole("button", {name: draw.join.replace("{name}", recipient)})).toBeVisible();
      await notices("dropout repair", "plans-changed", [giver], [recipient]);
      await privateNotice("plans-changed");
      await giverPage.goto(path("/lists"));
      await expect(giverPage.getByRole("region", {name: givingTo})).toHaveCount(0);
      await giverPage.goto(path());
      await expect(giverPage.getByRole("link", {name: draw.reveal})).toBeVisible();

      await summary(page, draw.previewLabel).click();
      await page.getByRole("combobox", {name: draw.personLabel, exact: true}).selectOption({label: giver});
      await page.getByRole("button", {name: draw.previewButton}).click();
      await expect(page.getByText(draw.hiddenInPreview, {exact: true})).toHaveCount(2);
      for (const response of await Promise.all(managementResponses)) {
        const payload = response.replaceAll('\\"', '"');
        expect(/"(?:pairs?|assignments?|recipient(?:Id|Name|Sealed)|giver(?:Id|Name)|personName|askerId)"\s*:/i.test(payload)).toBe(false);
        expect(payload.includes(question)).toBe(false);
        expect(payload.includes(answer)).toBe(false);
      }
      await page.goto(path("/notifications"));
      await expect(page.getByText(notify.templates["names-drawn"].title, {exact: true})).toBeVisible();
      await expect(page.getByText(notify.templates["budget-changed"].title, {exact: true})).toBeVisible();
      await expect(page.getByText(notify.templates["plans-changed"].title, {exact: true})).toHaveCount(0);
      await expect(page.getByText(notify.templates["question-answered"].title, {exact: true})).toHaveCount(0);
      for (const name of roster) await expect(page.getByText(name, {exact: true})).toHaveCount(0);
    } finally {
      try {
        await Promise.all(contexts.map((context) => context.close()));
        if (familyId) await runForFamily(db, familyId, (tx) => tx.delete(families).where(eq(families.id, familyId!)).execute());
      } finally {
        await close();
      }
    }
  });
}
