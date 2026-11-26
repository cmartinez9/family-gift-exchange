import {randomUUID} from "node:crypto";
import {expect, test, type Browser, type BrowserContext, type Page} from "@playwright/test";
import {and, eq} from "drizzle-orm";
import en from "../../messages/en.json" with {type: "json"};
import {connectDatabase, runForFamily, type FamilyTransaction} from "../../src/server/db/database";
import {claims, families, items, people} from "../../src/server/db/schema";

const pin = "4268";
const {auth, lists} = en;

async function database<T>(familyId: string, action: (tx: FamilyTransaction) => Promise<T>) {
  const connection = connectDatabase(process.env.DATABASE_URL!);
  try {
    return await runForFamily(connection.db, familyId, action);
  } finally {
    await connection.close();
  }
}

async function createFamily(page: Page) {
  await page.goto("/en/start");
  await page.getByLabel(auth.organizerInvite).fill(process.env.E2E_ORGANIZER_INVITE_CODE!);
  await page.getByLabel(auth.familyName).fill(`Boundary ${randomUUID().slice(0, 8)}`);
  await page.getByLabel(auth.yourName).fill("Winterberry");
  await page.getByLabel(auth.pin, {exact: true}).fill(pin);
  await page.getByLabel(auth.confirmPin).fill(pin);
  await page.getByRole("button", {name: auth.createFamily}).click();
  await expect(page.getByRole("heading", {name: auth.facePrompt})).toBeVisible();
  await page.getByRole("link", {name: auth.notNow}).click();
  await expect(page.getByRole("link", {name: auth.sendKeys})).toBeVisible();
  return (await page.context().cookies()).find(({name}) => name === "__Host-fge-session")!.value.split(".")[0];
}

async function addMember(page: Page, name: string, helper?: string) {
  await page.goto("/en/family");
  const section = page.locator("details").filter({has: page.locator("summary").filter({hasText: /^Add a person$/})});
  await section.locator("summary").click();
  await section.getByLabel(auth.name).fill(name);
  if (helper) await section.getByLabel(auth.helper).selectOption({label: helper});
  await section.getByRole("button", {name: auth.addMember}).click();
  await expect(page.getByRole("heading", {name, exact: true})).toBeVisible();
}

async function joinMember(page: Page, browser: Browser, name: string) {
  await page.goto("/en/family/keys");
  const row = page.getByRole("listitem").filter({has: page.getByRole("heading", {name, exact: true})});
  await row.getByRole("button", {name: auth.prepareKey}).click();
  const url = (await row.getByText(`Hi ${name}! This is your private key`, {exact: false}).innerText()).split(" ").at(-1)!;
  const context = await browser.newContext({
    baseURL: new URL(page.url()).origin, viewport: {width: 390, height: 844},
    isMobile: true, hasTouch: true, ignoreHTTPSErrors: true,
  });
  const member = await context.newPage();
  await member.goto(url);
  await member.getByRole("button", {name: `Yes, I'm ${name}`}).click();
  await member.getByLabel(auth.pin, {exact: true}).fill(pin);
  await member.getByLabel(auth.confirmPin).fill(pin);
  await member.getByRole("button", {name: auth.savePin}).click();
  await expect(member.getByRole("heading", {name: auth.facePrompt})).toBeVisible();
  await member.getByRole("link", {name: auth.notNow}).click();
  return {context, page: member};
}

async function ownList(page: Page) {
  await page.goto("/en/lists");
  await page.getByRole("link", {name: lists.myList, exact: true}).click();
  await expect(page.getByRole("heading", {name: lists.myList, exact: true})).toBeVisible();
  return new URL(page.url()).pathname;
}

async function addNote(page: Page, path: string, title: string) {
  await page.goto(`${path}/items/new?kind=note`);
  await page.getByLabel(lists.title).fill(title);
  await page.getByRole("textbox", {name: lists.note, exact: true}).fill(`Notes for ${title}`);
  await page.getByRole("button", {name: lists.saveItem}).click();
  await expect(page.getByRole("article", {name: title, exact: true})).toBeVisible();
}

async function screenshot(page: Page, name: string) {
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({path, fullPage: true});
  await test.info().attach(name, {path, contentType: "image/png"});
}

async function cleanup(familyId: string, contexts: BrowserContext[] = []) {
  for (const context of contexts) await context.close();
  await database(familyId, (tx) => tx.delete(families).where(eq(families.id, familyId)).execute());
}

test("rejects code and private links, then saves a real store preview without a URL scheme", async ({page}) => {
  test.skip(!process.env.E2E_LIVE_PRODUCT_URL, "Set E2E_LIVE_PRODUCT_URL to an available public product with a preview image");
  const familyId = await createFamily(page);
  try {
    const path = await ownList(page);
    await page.goto(`${path}/items/new?kind=link`);
    const input = page.getByLabel(lists.url);
    for (const [value, code] of [
      ["javascript:alert(1)", "unsafe-link"],
      ["data:text/html,<script>alert(1)</script>", "invalid-link"],
      ["https://example.com/<script>alert(1)</script>", "invalid-link"],
      ["http://127.0.0.1:55439/", "unsafe-link"],
      ["https://localhost/private", "unsafe-link"],
    ] as const) {
      await input.fill(value);
      await input.blur();
      await expect(page.getByRole("main").getByRole("alert")).toHaveText(lists.feedback[code]);
    }
    await screenshot(page, "unsafe-private-link-rejected");
    const publicUrl = new URL(process.env.E2E_LIVE_PRODUCT_URL!);
    publicUrl.searchParams.set("utm_source", "wishlist-test");
    await input.fill(publicUrl.href.replace(/^https:\/\//, ""));
    await input.blur();
    const preview = page.getByRole("region", {name: lists.previewTitle});
    const photo = preview.locator('img[width="400"]');
    await expect(photo).toBeVisible({timeout: 15_000});
    await expect.poll(() => photo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await expect(preview.getByText(lists.photoFallback, {exact: true})).toHaveCount(0);
    await expect(page.getByLabel(lists.title)).not.toHaveValue("");
    const normalized = new URL(publicUrl);
    normalized.searchParams.delete("utm_source");
    await expect(preview.getByRole("link", {name: lists.openProduct})).toHaveAttribute("href", normalized.href);
    await screenshot(page, "live-product-preview");
    const title = await page.getByLabel(lists.title).inputValue();
    await page.getByRole("textbox", {name: lists.note, exact: true}).fill("Any color, please");
    await page.getByRole("button", {name: lists.saveItem}).click();
    const card = page.getByRole("article", {name: title, exact: true});
    await expect(card.locator('img[width="400"]')).toBeVisible();
    await expect(card.getByText("Any color, please", {exact: true})).toBeVisible();
    await page.reload();
    await expect(card.locator('img[width="400"]')).toBeVisible();
    const photoUrl = await card.locator('img[width="400"]').getAttribute("src");
    expect((await page.request.get(photoUrl!)).headers()["content-type"]).toBe("image/webp");
    await screenshot(page, "live-product-saved");
  } finally {
    await cleanup(familyId);
  }
});

test("saves the 301st wishlist item and restricts the single budget to the organizer", async ({page, browser}) => {
  const familyId = await createFamily(page);
  const contexts: BrowserContext[] = [];
  try {
    await addMember(page, "Firleaf");
    const member = await joinMember(page, browser, "Firleaf");
    contexts.push(member.context);
    await page.goto("/en/lists");
    await page.locator("summary").filter({hasText: lists.budget}).click();
    const budget = page.getByLabel(lists.budget, {exact: true});
    await budget.fill("45,50");
    const requestPromise = page.waitForRequest((request) => request.method() === "POST");
    await page.getByRole("button", {name: lists.saveBudget}).click();
    const request = await requestPromise;
    await expect(page.getByText("Gift budget: $45.50", {exact: true})).toBeVisible();
    await member.page.goto("/en/lists");
    await expect(member.page.getByText("Gift budget: $45.50", {exact: true})).toBeVisible();
    await expect(member.page.getByRole("button", {name: lists.saveBudget})).toHaveCount(0);
    const headers = {...request.headers()};
    for (const key of ["cookie", "host", "content-length"]) delete headers[key];
    const denied = await member.page.request.post(request.url(), {headers, data: request.postDataBuffer()!});
    expect(await denied.text()).toContain("forbidden");
    await screenshot(member.page, "family-budget-member");

    await budget.fill("-1");
    await page.getByRole("button", {name: lists.saveBudget}).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(lists.feedback["invalid-budget"]);
    await expect(page.getByText("Gift budget: $45.50", {exact: true})).toBeVisible();
    await budget.fill("");
    await page.getByRole("button", {name: lists.saveBudget}).click();
    await expect(page.getByText(lists.noBudget, {exact: true})).toBeVisible();

    const path = await ownList(page);
    const ownerId = path.split("/").at(-1)!;
    await database(familyId, (tx) => tx.insert(items).values(Array.from({length: 300}, (_, position) => ({
      familyId, ownerId, kind: "note" as const, title: `Wish ${position + 1}`, position,
    }))).execute());
    await addNote(page, path, "Wish 301: telescope");
    await page.reload();
    await expect(page.getByRole("article")).toHaveCount(301);
    const card = page.getByRole("article", {name: "Wish 301: telescope", exact: true});
    await expect(card.getByText("Notes for Wish 301: telescope")).toBeVisible();
    await card.screenshot({path: test.info().outputPath("wish-301.png")});
    await page.goto("/en/lists");
    await expect(page.getByText("301 items · List not ready yet", {exact: true})).toBeVisible();
    await screenshot(page, "unlimited-wishlist-directory");
  } finally {
    await cleanup(familyId, contexts);
  }
});

test("lets a switched helper edit a relative's list while other members can only view and claim", async ({page, browser}) => {
  const familyId = await createFamily(page);
  const contexts: BrowserContext[] = [];
  let otherFamilyId: string | undefined;
  try {
    await addMember(page, "Little Acorn", "Winterberry");
    await addMember(page, "Firleaf");
    const member = await joinMember(page, browser, "Firleaf");
    contexts.push(member.context);
    await page.goto("/en/lists");
    const path = await page.getByRole("link", {name: "Little Acorn", exact: true}).getAttribute("href");
    await page.goto(path!);
    await expect(page.getByRole("link", {name: lists.editProfile})).toHaveCount(0);
    expect((await page.request.get(`${path}/items/new?kind=note`)).status()).toBe(404);
    await page.goto("/en/account");
    await page.getByRole("button", {name: "Help Little Acorn", exact: true}).click();
    await expect(page.getByText(auth.actingFor.replace("{name}", "Little Acorn"), {exact: true})).toBeVisible();
    await page.getByRole("link", {name: lists.myList, exact: true}).click();
    await expect(page.getByText("You’re helping Little Acorn.", {exact: true})).toBeVisible();
    await addNote(page, path!, "Wooden train");
    await page.getByRole("link", {name: lists.editProfile}).click();
    await page.getByLabel(lists.size.shoes, {exact: true}).fill("2Y");
    await page.getByLabel(lists.size.shoes, {exact: true}).blur();
    await expect(page.getByRole("main").getByRole("status")).toHaveText(lists.saved);
    await page.getByRole("link", {name: lists.backToList}).click();
    await member.page.goto(path!);
    const card = member.page.getByRole("article", {name: "Wooden train", exact: true});
    await expect(card.getByText("Notes for Wooden train")).toBeVisible();
    await expect(member.page.getByText("2Y", {exact: true})).toBeVisible();
    await expect(card.getByRole("link", {name: lists.editItem, exact: true})).toHaveCount(0);
    expect((await member.page.request.get(`${path}/profile`)).status()).toBe(404);
    await card.getByRole("button", {name: lists.claim, exact: true}).click();
    await expect(card.getByText(lists.mine, {exact: true})).toBeVisible();
    await screenshot(member.page, "relative-list-member");
    await page.reload();
    await expect(page.getByText(lists.someone, {exact: true})).toHaveCount(0);
    await expect(page.getByText(lists.mine, {exact: true})).toHaveCount(0);
    await expect(page.getByRole("button", {name: lists.claim, exact: true})).toHaveCount(0);
    await screenshot(page, "relative-list-helper-private");

    const outsider = await browser.newContext({baseURL: new URL(page.url()).origin, ignoreHTTPSErrors: true});
    contexts.push(outsider);
    const outsiderPage = await outsider.newPage();
    otherFamilyId = await createFamily(outsiderPage);
    expect((await outsiderPage.request.get(path!)).status()).toBe(404);
    await outsiderPage.goto("/en/lists");
    await expect(outsiderPage.getByRole("link", {name: "Little Acorn", exact: true})).toHaveCount(0);
  } finally {
    if (otherFamilyId) await cleanup(otherFamilyId);
    await cleanup(familyId, contexts);
  }
});

test("resolves competing anonymous claims and releases only unpurchased gifts when a buyer is removed", async ({page, browser}) => {
  test.setTimeout(90_000);
  const familyId = await createFamily(page);
  const contexts: BrowserContext[] = [];
  try {
    for (const name of ["Snowfinch", "Firleaf"]) await addMember(page, name);
    const first = await joinMember(page, browser, "Snowfinch");
    const second = await joinMember(page, browser, "Firleaf");
    contexts.push(first.context, second.context);
    const path = await ownList(page);
    for (const title of ["Pending book", "Purchased scarf", "Other buyer's mittens", "Racing candle"]) {
      await addNote(page, path, title);
    }
    await first.page.goto(path);
    await second.page.goto(path);
    const race = (p: Page) => p.getByRole("article", {name: "Racing candle", exact: true});
    await Promise.all([first.page, second.page].map(async (p) => {
      await race(p).getByRole("button", {name: lists.claim, exact: true}).click();
      // Wait for the server action before reloading so navigation cannot cancel the claim.
      await expect(race(p).getByText(lists.mine, {exact: true})
        .or(race(p).getByText(lists.feedback["already-claimed"], {exact: true}))).toBeVisible();
    }));
    await first.page.reload();
    await second.page.reload();
    const firstWon = await race(first.page).getByText(lists.mine, {exact: true}).count() === 1;
    const winner = firstWon ? first.page : second.page;
    const loser = firstWon ? second.page : first.page;
    await expect(race(winner).getByText(lists.mine, {exact: true})).toBeVisible();
    await expect(race(loser).getByText(lists.someone, {exact: true})).toBeVisible();
    await expect(race(loser).getByRole("button", {name: lists.claim, exact: true})).toHaveCount(0);
    await expect(race(loser).getByText(firstWon ? "Snowfinch" : "Firleaf", {exact: false})).toHaveCount(0);
    await screenshot(loser, "competing-claim-anonymous");
    await race(winner).getByRole("button", {name: lists.undoClaim, exact: true}).click();
    await expect(race(winner).getByRole("button", {name: lists.claim, exact: true})).toBeVisible();

    for (const title of ["Pending book", "Purchased scarf"]) {
      await first.page.reload();
      const card = first.page.getByRole("article", {name: title, exact: true});
      await card.getByRole("button", {name: lists.claim, exact: true}).click();
      await expect(card.getByText(lists.mine, {exact: true})).toBeVisible();
    }
    const otherClaim = second.page.getByRole("article", {name: "Other buyer's mittens", exact: true});
    await otherClaim.getByRole("button", {name: lists.claim, exact: true}).click();
    await expect(otherClaim.getByText(lists.mine, {exact: true})).toBeVisible();
    await first.page.goto("/en/lists/getting");
    const bought = first.page.getByRole("listitem").filter({has: first.page.getByRole("heading", {name: "Purchased scarf", exact: true})});
    await bought.getByLabel(lists.bought, {exact: true}).check();
    await expect(bought.getByLabel(lists.bought, {exact: true})).toBeEnabled();
    const pending = first.page.getByRole("listitem").filter({has: first.page.getByRole("heading", {name: "Pending book", exact: true})});
    await pending.getByLabel(lists.wrapped, {exact: true}).check();
    await expect(pending.getByLabel(lists.wrapped, {exact: true})).toBeEnabled();
    await first.page.reload();
    await expect(bought.getByLabel(lists.bought, {exact: true})).toBeChecked();
    await expect(pending.getByLabel(lists.bought, {exact: true})).not.toBeChecked();
    await expect(pending.getByLabel(lists.wrapped, {exact: true})).toBeChecked();
    await screenshot(first.page, "buyer-checklist-before-removal");
    await page.reload();
    await expect(page.getByText(lists.mine, {exact: true})).toHaveCount(0);
    await expect(page.getByText(lists.someone, {exact: true})).toHaveCount(0);
    await screenshot(page, "recipient-list-private");

    await page.goto("/en/family");
    await page.locator("summary").filter({hasText: /^Edit Snowfinch$/}).click();
    await page.locator("summary").filter({hasText: /^Remove Snowfinch$/}).click();
    await page.getByRole("button", {name: "Yes, remove Snowfinch", exact: true}).click();
    await expect(page.getByRole("heading", {name: "Snowfinch", exact: true})).toHaveCount(0);
    await second.page.goto(path);
    const available = second.page.getByRole("article", {name: "Pending book", exact: true});
    await expect(available.getByRole("button", {name: lists.claim, exact: true})).toBeVisible();
    const retained = second.page.getByRole("article", {name: "Purchased scarf", exact: true});
    await expect(retained.getByText(lists.someone, {exact: true})).toBeVisible();
    await expect(retained.getByRole("button", {name: lists.claim, exact: true})).toHaveCount(0);
    await expect(second.page.getByRole("article", {name: "Other buyer's mittens", exact: true}).getByText(lists.mine, {exact: true})).toBeVisible();
    await screenshot(second.page, "claims-after-member-removal");
    await available.getByRole("button", {name: lists.claim, exact: true}).click();
    await expect(available.getByText(lists.mine, {exact: true})).toBeVisible();
    await first.page.goto(path);
    await expect(first.page).toHaveURL(/\/en\/sign-in/);
    await screenshot(first.page, "removed-buyer-signed-out");
    const state = await database(familyId, (tx) => tx.select({title: items.title, boughtAt: claims.boughtAt, removedAt: people.removedAt})
      .from(claims).innerJoin(items, eq(items.id, claims.itemId)).innerJoin(people, eq(people.id, claims.claimerId))
      .where(and(eq(claims.familyId, familyId), eq(items.title, "Purchased scarf"))));
    expect(state).toHaveLength(1);
    expect(state[0].boughtAt).not.toBeNull();
    expect(state[0].removedAt).not.toBeNull();
    await test.info().attach("retained-purchase-state", {body: JSON.stringify(state, null, 2), contentType: "application/json"});
  } finally {
    await cleanup(familyId, contexts);
  }
});
