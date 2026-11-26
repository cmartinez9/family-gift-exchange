import {randomUUID} from "node:crypto";
import {mkdirSync} from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import {expect, test, type Page} from "@playwright/test";
import {and, eq} from "drizzle-orm";
import sharp from "sharp";
import en from "../../messages/en.json" with {type: "json"};
import es from "../../messages/es.json" with {type: "json"};
import {connectDatabase, runForFamily} from "../../src/server/db/database";
import {claims, exchanges, families, items, outbox, people} from "../../src/server/db/schema";

// Home, My list and Family as the Sweater Weather design draws them (flows 3, 4 and 5), on a 390 by 844
// phone. Each screen is checked with axe and photographed into test-results/design/.

const pin = "4268";
const phone = {width: 390, height: 844};
const shots = "test-results/design";

const ART = {
  robe: ["#E9E4E0", '<path d="M30 22l10-6h20l10 6 8 54-14 6H36l-14-6z" fill="#2F3438"/><path d="M40 16l10 18 10-18" fill="none" stroke="#4A5156" stroke-width="4" stroke-linejoin="round"/><path d="M30 52h40" stroke="#5B6267" stroke-width="5" stroke-linecap="round"/>'],
  pruners: ["#E5EDE3", '<path d="M48 50 28 22c-2-3 1-6 4-4l22 26z" fill="#B9C0C4"/><path d="M52 50 72 22c2-3-1-6-4-4L46 44z" fill="#D7DCDF"/><path d="M47 48 34 80c-1 3 3 5 5 3l14-28z" fill="#D2452F"/><path d="M53 48l13 32c1 3-3 5-5 3L47 55z" fill="#E86A3E"/><circle cx="50" cy="48" r="3.4" fill="#5C6266"/>'],
} as const;

function picture(kind: keyof typeof ART) {
  const [background, art] = ART[kind];
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 100 100"><rect width="100" height="100" fill="${background}"/>${art}</svg>`))
    .png().toBuffer();
}

function database() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for wishlist browser tests");
  return connectDatabase(databaseUrl);
}

function isoDay(offset: number) {
  const day = new Date(Date.now() + offset * 86_400_000);
  return day.toISOString().slice(0, 10);
}

async function startFamily(page: Page) {
  const {auth} = en;
  const familyName = `Hollyberry ${randomUUID().slice(0, 6)}`;
  await page.goto("/en/start");
  await page.getByLabel(auth.organizerInvite).fill(process.env.E2E_ORGANIZER_INVITE_CODE!);
  await page.getByLabel(auth.familyName).fill(familyName);
  await page.getByLabel(auth.yourName).fill("Rosa");
  await page.getByLabel(auth.pin, {exact: true}).fill(pin);
  await page.getByLabel(auth.confirmPin).fill(pin);
  await page.getByRole("button", {name: auth.createFamily}).click();
  await page.getByRole("link", {name: auth.notNow}).click();
  await expect(page.getByRole("heading", {name: familyName})).toBeVisible();
  const session = (await page.context().cookies()).find(({name}) => name === "__Host-fge-session");
  return session!.value.split(".")[0];
}

type Family = {familyId: string; rosa: string; ana: string; tito: string; leo: string; christian: string; exchangeId: string};

/** The rest of the family, the exchange's day, place and budget, and Ana's list, straight into the database. */
async function seedFamily(familyId: string): Promise<Family> {
  const {db, close} = database();
  try {
    return await runForFamily(db, familyId, async (tx) => {
      const [rosa] = await tx.select({id: people.id}).from(people).where(eq(people.familyId, familyId));
      const [ana, christian] = await tx.insert(people).values([
        {familyId, displayName: "Ana"}, {familyId, displayName: "Christian"},
      ]).returning({id: people.id});
      const [tito, leo] = await tx.insert(people).values([
        {familyId, displayName: "Tito", helperId: rosa.id}, {familyId, displayName: "Leo", helperId: ana.id},
      ]).returning({id: people.id});
      const [exchange] = await tx.update(exchanges).set({
        name: "Christmas 2026", giftDay: isoDay(24), place: "Ana’s house", budgetAmount: "50.00",
      }).where(eq(exchanges.familyId, familyId)).returning({id: exchanges.id});
      await tx.insert(items).values([
        {familyId, ownerId: ana.id, kind: "link", title: "Pour-over coffee set", store: "Target", price: "32.00",
          url: "https://www.target.com/p/pour-over-coffee-set", position: 0},
        {familyId, ownerId: ana.id, kind: "link", title: "Sourdough baking book", store: "Amazon", price: "24.50",
          note: "The one with the blue cover", url: "https://www.amazon.com/dp/sourdough", position: 1},
        {familyId, ownerId: ana.id, kind: "link", title: "Cozy slipper socks", store: "Walmart", price: "12.97", starred: true,
          url: "https://www.walmart.com/ip/slipper-socks", position: 2},
        {familyId, ownerId: christian.id, kind: "note", title: "Gift card for coffee", position: 0},
        {familyId, ownerId: tito.id, kind: "note", title: "Dinosaur puzzle", position: 0},
      ]);
      return {familyId, rosa: rosa.id, ana: ana.id, tito: tito.id, leo: leo.id, christian: christian.id, exchangeId: exchange.id};
    });
  } finally {
    await close();
  }
}

async function itemId(familyId: string, title: string) {
  const {db, close} = database();
  try {
    return await runForFamily(db, familyId, async (tx) => {
      const [item] = await tx.select({id: items.id}).from(items).where(and(eq(items.familyId, familyId), eq(items.title, title)));
      return item.id;
    });
  } finally {
    await close();
  }
}

async function seed(familyId: string, action: Parameters<typeof runForFamily>[2]) {
  const {db, close} = database();
  try {
    await runForFamily(db, familyId, action);
  } finally {
    await close();
  }
}

async function removeFamily(familyId: string) {
  await seed(familyId, (tx) => tx.delete(families).where(eq(families.id, familyId)).execute());
}

/** Lets arrivals and sheets settle, checks accessibility, then photographs the screen. */
async function shoot(page: Page, name: string, options: {axe?: boolean} = {}) {
  await page.waitForTimeout(700);
  await expect(page).toHaveTitle(/\S/);
  if (options.axe !== false) {
    const results = await new AxeBuilder({page}).analyze();
    expect(results.violations, `${name}: ${results.violations.map(({id}) => id).join(", ")}`).toEqual([]);
  }
  mkdirSync(shots, {recursive: true});
  await page.screenshot({path: `${shots}/${test.info().project.name}-${name}.png`});
}

test("draws Home, My list and Family as designed, in English and Spanish", async ({page}) => {
  test.setTimeout(240_000);
  await page.setViewportSize(phone);
  const {lists, homeScreen, ui} = en;
  const familyId = await startFamily(page);
  try {
    const family = await seedFamily(familyId);

    // 3.3: Home before you have a list
    await page.goto("/en");
    await expect(page.getByRole("heading", {name: homeScreen.listTitle})).toBeVisible();
    await expect(page.getByText("Christmas", {exact: true})).toBeVisible();
    await shoot(page, "f3-3_3-home-add-to-list");

    // 4.3: My list, empty
    await page.getByRole("navigation", {name: ui.tabs.label}).getByRole("link", {name: ui.tabs.list}).click();
    await expect(page.getByRole("heading", {name: lists.emptyTitle})).toBeVisible();
    await expect(page.getByText(lists.itemCount.match(/=0 \{([^}]+)\}/)![1])).toBeVisible();
    await shoot(page, "f4-4_3-my-list-empty");

    // Take a photo: the robe, with a note, a price and a heart
    await page.getByRole("link", {name: lists.photoShort}).click();
    await expect(page.getByRole("heading", {name: lists.addPhotoTitle})).toBeVisible();
    await page.getByLabel(lists.photo).setInputFiles({name: "robe.png", mimeType: "image/png", buffer: await picture("robe")});
    await expect(page.getByLabel(lists.replacePhoto)).toBeAttached();
    await page.getByLabel(lists.title).fill("Fleece robe");
    await page.getByLabel(lists.price).fill("39.99");
    await page.getByRole("textbox", {name: lists.note, exact: true}).fill("Size M, any dark color");
    await page.getByLabel(lists.star, {exact: true}).check();
    await shoot(page, "f4-new-photo-page");
    await page.getByRole("button", {name: lists.saveItem}).click();
    await expect(page.getByRole("status").filter({hasText: lists.added})).toBeVisible();
    await expect(page.getByRole("article", {name: "Fleece robe"})).toBeVisible();
    // 4.4: added, with the toast
    await shoot(page, "f4-4_4-added", {axe: false});

    await page.getByRole("button", {name: lists.addSomething}).click();
    const addSheet = page.getByRole("dialog", {name: lists.addSomething});
    await expect(addSheet).toBeVisible();
    // 4.2: Add something
    await shoot(page, "f4-4_2-add-sheet");
    await addSheet.getByRole("link", {name: new RegExp(lists.addPhotoTitle)}).click();
    await page.getByLabel(lists.photo).setInputFiles({name: "pruners.png", mimeType: "image/png", buffer: await picture("pruners")});
    await page.getByLabel(lists.title).fill("Garden pruners");
    await page.getByLabel(lists.price).fill("24.97");
    await page.getByRole("button", {name: lists.saveItem}).click();
    await expect(page.getByRole("article", {name: "Garden pruners"})).toBeVisible();

    // a link the store would not give a picture for
    await seed(familyId, (tx) => tx.insert(items).values({
      familyId, ownerId: family.rosa, kind: "link", title: "Large Print Crosswords, Vol. 2", store: "amazon.com",
      url: "https://www.amazon.com/dp/crosswords", position: -1,
    }).execute());
    await page.reload();
    // 4.1: My list
    const crosswords = page.getByRole("article", {name: "Large Print Crosswords, Vol. 2"});
    await expect(crosswords.getByText(lists.noPicture.replace("{store}", "amazon.com"))).toBeVisible();
    await shoot(page, "f4-4_1-my-list");

    // 4.5: edit in a sheet
    await page.getByRole("link", {name: lists.editNamedItem.replace("{title}", "Fleece robe")}).click();
    const editSheet = page.getByRole("dialog", {name: lists.editItem});
    await expect(editSheet.getByLabel(lists.title)).toHaveValue("Fleece robe");
    await shoot(page, "f4-4_5-edit-sheet");
    await editSheet.getByRole("textbox", {name: lists.note, exact: true}).fill("Size M, any dark color. Not white.");
    await editSheet.getByRole("button", {name: lists.saveItem}).click();
    await expect(editSheet).toBeHidden();
    await expect(page.getByRole("article", {name: "Fleece robe"}).getByText("Not white.", {exact: false})).toBeVisible();

    // 4.6: taken off, with Undo
    await page.getByRole("link", {name: lists.editNamedItem.replace("{title}", "Large Print Crosswords, Vol. 2")}).click();
    await page.getByRole("dialog", {name: lists.editItem}).getByRole("button", {name: lists.deleteItem}).click();
    await expect(crosswords).toHaveCount(0);
    await expect(page.getByRole("status").filter({hasText: lists.tookOff.replace("{title}", "Large Print Crosswords, Vol. 2")})).toBeVisible();
    await shoot(page, "f4-4_6-took-off-undo", {axe: false});
    await page.getByRole("button", {name: ui.undo}).click();
    await expect(crosswords).toBeVisible();

    // 4.7: sizes and about me, saved as you go
    await page.getByRole("link", {name: new RegExp(lists.mySizes)}).click();
    await expect(page.getByRole("heading", {name: lists.profile})).toBeVisible();
    await page.getByRole("group", {name: lists.size.tops}).getByText("M", {exact: true}).click();
    await expect(page.getByRole("status").filter({hasText: lists.saved})).toBeVisible();
    await page.getByRole("group", {name: lists.size.bottoms}).getByText("M", {exact: true}).click();
    await page.getByLabel(lists.size.shoeSystem).selectOption("us-women");
    await page.getByRole("button", {name: lists.shoeBigger}).click();
    await page.getByRole("button", {name: lists.shoeBigger}).click();
    await expect(page.getByLabel(lists.size.shoes, {exact: true})).toHaveValue("7½");
    await page.getByRole("button", {name: lists.shoeSmaller}).click();
    await expect(page.getByLabel(lists.size.shoes, {exact: true})).toHaveValue("7");
    await page.getByRole("button", {name: lists.shoeBigger}).click();
    await expect(page.getByLabel(lists.size.shoes, {exact: true})).toHaveValue("7½");
    const likes = page.getByLabel(lists.aboutField.likes, {exact: true});
    await likes.fill("Gardening, crosswords, lattes");
    await likes.blur();
    await expect(page.getByRole("status").filter({hasText: lists.saved})).toBeVisible();
    await shoot(page, "f4-4_7-sizes", {axe: false});
    expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
    await page.getByRole("link", {name: lists.myList}).first().click();
    await expect(page.getByText("Tops M · Bottoms M · Shoe size 7½")).toBeVisible();

    // Marks: Rosa is getting Ana's book (bought); Leo is getting Ana's coffee; Ana is getting Rosa's robe
    const robe = await itemId(familyId, "Fleece robe");
    const book = await itemId(familyId, "Sourdough baking book");
    const coffee = await itemId(familyId, "Pour-over coffee set");
    const socks = await itemId(familyId, "Cozy slipper socks");
    await seed(familyId, (tx) => tx.insert(claims).values([
      {familyId, itemId: book, claimerId: family.rosa, boughtAt: new Date()},
      {familyId, itemId: coffee, claimerId: family.leo},
      {familyId, itemId: robe, claimerId: family.ana},
    ]).execute());

    // 5.4: your own list never shows marks
    await page.reload();
    await expect(page.getByRole("article", {name: "Fleece robe"})).toBeVisible();
    await expect(page.getByText(lists.someone)).toHaveCount(0);
    await shoot(page, "f5-5_4-own-list-no-marks");

    // 3.1 and 3.4: Home on an ordinary day
    await page.getByRole("navigation", {name: ui.tabs.label}).getByRole("link", {name: ui.tabs.home}).click();
    await expect(page.getByRole("heading", {name: homeScreen.installTitle})).toBeVisible();
    await expect(page.getByRole("link", {name: new RegExp(lists.getting)})).toBeVisible();
    await expect(page.getByRole("link", {name: new RegExp(homeScreen.youHelp.replace("{name}", "Tito"))})).toBeVisible();
    await shoot(page, "f3-3_1-home");
    // 3.2: the home-screen steps
    // the steps follow the phone: Android first on an Android phone, and the other phone is one tap away
    await page.getByRole("button", {name: homeScreen.installButton}).click();
    const steps = page.locator("dialog[open]");
    await expect(steps).toHaveCount(1);
    const android = /Android/.test(await page.evaluate(() => navigator.userAgent));
    await expect(steps.getByRole("heading", {name: android ? homeScreen.androidTitle : homeScreen.iphoneTitle})).toBeVisible();
    if (android) await steps.getByRole("button", {name: homeScreen.haveIphone}).click();
    await expect(steps.getByText(homeScreen.iphoneStep2)).toBeVisible();
    await shoot(page, "f3-3_2-home-screen-steps");
    await steps.getByRole("button", {name: homeScreen.haveAndroid}).click();
    await expect(steps.getByText(homeScreen.androidStep2)).toBeVisible();
    await steps.getByRole("button", {name: homeScreen.gotIt}).click();
    await expect(steps).toHaveCount(0);
    // putting the card away has Undo
    await page.getByRole("button", {name: homeScreen.installDismiss}).click();
    await expect(page.getByRole("heading", {name: homeScreen.installTitle})).toHaveCount(0);
    await expect(page.getByRole("status").filter({hasText: homeScreen.installDismissed})).toBeVisible();
    await shoot(page, "f3-home-install-put-away", {axe: false});
    await page.getByRole("button", {name: ui.undo}).click();
    await expect(page.getByRole("heading", {name: homeScreen.installTitle})).toBeVisible();
    // 3.7: no connection
    await page.context().setOffline(true);
    await expect(page.getByRole("status").filter({hasText: homeScreen.offline})).toBeVisible();
    await shoot(page, "f3-3_7-home-offline", {axe: false});
    await page.context().setOffline(false);

    // 3.4: a new notice is the one gold step, and dots your avatar
    await seed(familyId, (tx) => tx.insert(outbox).values({
      familyId, personId: family.rosa, channel: "push", template: "claimed-item-changed", language: "en", status: "sent",
    }).execute());
    await page.reload();
    const notice = page.getByRole("link", {name: new RegExp(en.notify.templates["claimed-item-changed"].title)});
    await expect(notice).toContainText(homeScreen.tapToRead);
    await expect(page.getByRole("heading", {name: homeScreen.installTitle})).toHaveCount(0);
    await expect(page.getByRole("link", {name: `${homeScreen.you}, ${homeScreen.somethingNew}`})).toBeVisible();
    await shoot(page, "f3-3_4-home-notice");
    await notice.click();
    await expect(page).toHaveURL(/\/en\/notifications$/);
    await page.goto("/en");

    // 5.1: Family
    await page.getByRole("navigation", {name: ui.tabs.label}).getByRole("link", {name: ui.tabs.family}).click();
    await expect(page.getByRole("heading", {name: lists.familyLists, level: 1})).toBeVisible();
    await expect(page.getByRole("link", {name: /Tito/}).getByText(`${lists.helpedByYou} · 1 thing`)).toBeVisible();
    await expect(page.getByRole("link", {name: /Leo/}).getByText(`${lists.helpedBy.replace("{name}", "Ana")} · Nothing yet`)).toBeVisible();
    await expect(page.getByRole("link", {name: /Rosa/})).toHaveCount(0);
    await shoot(page, "f5-5_1-family");

    // 5.2: Ana's list, claiming
    await page.getByRole("link", {name: /^Ana /}).click();
    await expect(page.getByRole("heading", {name: lists.namedList.replace("{name}", "Ana")})).toBeVisible();
    await expect(page.getByRole("article", {name: "Pour-over coffee set"}).getByText(lists.someone)).toBeVisible();
    await expect(page.getByRole("article", {name: "Sourdough baking book"}).getByText(lists.mine)).toBeVisible();
    const socksCard = page.getByRole("article", {name: "Cozy slipper socks"});
    await expect(socksCard.getByText(lists.wants.replace("{name}", "Ana")).first()).toBeVisible();
    await shoot(page, "f5-5_2-ana-list");
    await socksCard.getByRole("button", {name: lists.claim}).click();
    await expect(socksCard.getByText(lists.mine)).toBeVisible();
    await page.waitForTimeout(1200);
    await shoot(page, "f5-5_2-claimed");
    await socksCard.getByRole("button", {name: lists.undoClaim}).click();
    // the button waits for the release to be saved
    await expect(socksCard.getByRole("button", {name: lists.claim})).toBeEnabled();

    // 5.3: someone else got there a second first
    await seed(familyId, (tx) => tx.insert(claims).values({familyId, itemId: socks, claimerId: family.christian}).execute());
    await socksCard.getByRole("button", {name: lists.claim}).click();
    await expect(socksCard.getByText(lists.justGot)).toBeVisible();
    await expect(socksCard.getByText(lists.lateTap)).toBeVisible();
    await shoot(page, "f5-5_3-claimed-too-late");

    // 5.6: Things I'm getting
    await page.goto("/en/lists/getting");
    const bookCard = page.getByRole("article", {name: "Sourdough baking book"});
    await expect(bookCard.getByLabel(lists.bought)).toBeChecked();
    await bookCard.getByLabel(lists.wrapped).check();
    await expect(bookCard.getByLabel(lists.wrapped)).toBeChecked();
    await shoot(page, "f5-5_6-things-im-getting");

    // Spanish
    await page.goto(`/es/lists/${family.rosa}`);
    await expect(page.getByRole("heading", {name: es.lists.myList})).toBeVisible();
    await shoot(page, "es-f4-4_1-my-list");
    await page.goto("/es/lists");
    await expect(page.getByRole("heading", {name: es.lists.familyLists, level: 1})).toBeVisible();
    await shoot(page, "es-f5-5_1-family");
    await page.goto("/es");
    await expect(page.getByText(es.homeScreen.tapToRead)).toBeVisible();
    await expect(page.getByText(es.lists.gettingSummary.split(" · ")[1].replace("{wrapped}", "1"))).toBeVisible();
    await shoot(page, "es-f3-3_4-home");

    // The largest text size: Dynamic Type's biggest standard setting is about 135% of the default
    await page.goto(`/en/lists/${family.ana}`);
    await page.evaluate(() => {
      document.documentElement.style.zoom = "1.35";
    });
    await expect(page.getByRole("heading", {name: lists.namedList.replace("{name}", "Ana")})).toBeVisible();
    await shoot(page, "large-text-f5-5_2-ana-list", {axe: false});
    const overflow = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      const wide = [...document.querySelectorAll("main *")].filter((element) => element.getBoundingClientRect().right > width + 1)
        .map((element) => `${element.tagName}.${element.className}`.slice(0, 50)).slice(0, 6);
      return {over: document.documentElement.scrollWidth - width, wide};
    });
    expect(overflow.over, JSON.stringify(overflow.wide)).toBeLessThanOrEqual(1);

    // Reduced motion: the tag fades in instead of swinging, and the page simply appears
    await page.emulateMedia({reducedMotion: "reduce"});
    await page.goto(`/en/lists/${family.tito}`);
    await page.waitForLoadState("networkidle");
    const puzzle = page.getByRole("article", {name: "Dinosaur puzzle"});
    await puzzle.getByRole("button", {name: lists.claim}).click();
    await expect(puzzle.getByText(lists.mine)).toBeVisible();
    await page.waitForTimeout(250);
    const tag = await puzzle.locator("[data-claim-tag]").evaluate((element) => ({
      opacity: getComputedStyle(element).opacity, transform: getComputedStyle(element).transform,
    }));
    expect(Number(tag.opacity)).toBeGreaterThan(0.9);
    const arrival = await page.locator(".fge-arrive > *").first().evaluate((element) => getComputedStyle(element).animationName);
    expect(arrival).toBe("none");
    await shoot(page, "reduced-motion-claimed");
  } finally {
    await removeFamily(familyId);
  }
});
