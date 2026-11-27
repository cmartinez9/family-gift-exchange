import {randomUUID} from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {expect, test, type Page} from "@playwright/test";
import {eq} from "drizzle-orm";
import {connectDatabase} from "../../src/server/db/database";
import {families} from "../../src/server/db/schema";
import {practiceFamilies} from "../../src/server/draw/schema";
import {openFamilyAfterDetails} from "../helpers/family-setup";
import {openPerson} from "../helpers/open-person";

async function newOrganizer(page: Page) {
  const name = `The Snowbell Family ${randomUUID().slice(0, 6)}`;
  await page.goto("/en/start");
  await page.getByLabel("Organizer invitation code").fill(process.env.E2E_ORGANIZER_INVITE_CODE!);
  await page.getByLabel("Family or exchange name").fill(name);
  await page.getByLabel("Your name or nickname").fill("Northstar");
  await page.getByLabel("4-digit PIN").fill("4268");
  await page.getByLabel("Type the PIN again").fill("4268");
  await page.getByRole("button", {name: "Create my family"}).click();
  await page.getByRole("link", {name: "Not now"}).click();
  await openFamilyAfterDetails(page);
  const session = (await page.context().cookies()).find(({name}) => name === "__Host-fge-session")!;
  return {name, id: session.value.split(".")[0]};
}

async function removeFamily(familyId: string) {
  const databaseUrl = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for draw browser tests");
  const {db, close} = connectDatabase(databaseUrl);
  try {
    const [practice] = await db.select({familyId: practiceFamilies.practiceFamilyId}).from(practiceFamilies)
      .where(eq(practiceFamilies.familyId, familyId));
    await db.delete(families).where(eq(families.id, familyId));
    if (practice) await db.delete(families).where(eq(families.id, practice.familyId));
  } finally {
    await close();
  }
}

function disclosure(page: Page, name: string) {
  return page.locator("summary").filter({hasText: new RegExp(`^${name}$`)});
}

test("runs a private practice season through the browser", async ({page, browser}, info) => {
  await page.emulateMedia({reducedMotion: "reduce"});
  const family = await newOrganizer(page);
  const visitor = await browser.newContext({ignoreHTTPSErrors: true});
  try {
    await page.getByRole("link", {name: "Exchanges"}).click();
    await page.getByRole("link", {name: "Practice exchange"}).click();
    await page.getByRole("button", {name: "Start practice"}).click();
    await page.getByRole("button", {name: "Draw names"}).click();
    const pairs = page.getByRole("listitem").filter({hasText: / gives to /});
    await expect(pairs).toHaveCount(6);
    const pairing = await pairs.filter({hasText: /^Pinewisp gives to /}).innerText();
    const recipient = pairing.replace("Pinewisp gives to ", "");
    await page.screenshot({path: info.outputPath("practice-draw.png"), fullPage: true});

    await page.getByRole("link", {name: "Pinewisp", exact: true}).click();
    await expect(page.getByText("Viewing as Pinewisp", {exact: true})).toBeVisible();
    await expect(page.getByRole("heading", {name: /^You’re giving to /})).toHaveCount(0);
    expect(await openPerson(page)).toBe(recipient);
    expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);

    await page.getByRole("button", {name: `Ask ${recipient} a question`}).click();
    await page.getByLabel("Your anonymous question").fill("Any favorite colors?");
    await page.getByRole("button", {name: "Send my question"}).click();
    await expect(page.getByText(`Sent to ${recipient}`, {exact: true})).toBeVisible();
    await page.getByRole("link", {name: "Practice exchange"}).click();
    await page.getByRole("link", {name: recipient, exact: true}).click();
    await expect(page.getByRole("link", {name: "Answer", exact: true})).toBeVisible();
    await page.getByRole("link", {name: "Answer", exact: true}).click();
    await expect(page.getByText("Any favorite colors?", {exact: true})).toBeVisible();
    await expect(page.getByText("Pinewisp", {exact: false})).toHaveCount(0);
    await page.getByLabel("Your answer").fill("Midnight purple");
    await page.getByRole("button", {name: "Send my answer"}).click();
    await expect(page.getByText("You’ve answered.", {exact: true})).toBeVisible();
    await expect(page.getByText("Midnight purple", {exact: true})).toHaveCount(0);
    await page.goto("/en/exchanges/practice");
    await page.getByRole("link", {name: "Pinewisp", exact: true}).click();
    await expect(page.getByText("Midnight purple", {exact: true})).toBeVisible();
    await page.screenshot({path: info.outputPath("private-question-answer.png"), fullPage: true});

    const guest = await visitor.newPage();
    await guest.goto(page.url());
    await expect(guest).toHaveURL(/\/en\/sign-in$/);
    await page.getByRole("link", {name: "Practice exchange"}).click();
    await disclosure(page, "Dropouts and late joiners").click();
    await page.getByRole("button", {name: "Pinewisp can’t take part"}).click();
    await expect(pairs).toHaveCount(5);
    await page.getByRole("button", {name: "Add Winterplum to the draw"}).click();
    await expect(pairs).toHaveCount(6);
    await disclosure(page, "Close exchange").click();
    await page.getByRole("button", {name: "Yes, close exchange"}).click();
    await expect(page.getByRole("button", {name: "Start another practice round"})).toBeVisible();
    await page.screenshot({path: info.outputPath("closed-practice.png"), fullPage: true});
  } finally {
    await visitor.close();
    await removeFamily(family.id);
  }
});

test("keeps real previews sealed and resets the lock only after typed confirmation", async ({page}, info) => {
  // five setup steps and the draw ceremony take longer than a single form did
  test.setTimeout(90_000);
  const family = await newOrganizer(page);
  try {
    for (const name of ["Snowstep", "Brighttwig", "Lanternseed"]) {
      await disclosure(page, "Add a person").click();
      await page.getByRole("textbox", {name: "Name or nickname"}).fill(name);
      await page.getByRole("button", {name: "Add a person"}).click();
      await expect(page.getByRole("heading", {name})).toBeVisible();
      // The family form can stay open after save, so reset the disclosure for the next addition.
      const add = disclosure(page, "Add a person");
      if (await add.locator("..").getAttribute("open") !== null) await add.click();
    }
    await page.getByRole("link", {name: "Exchanges"}).click();
    await page.getByRole("link", {name: family.name}).click();
    await expect(page.getByRole("heading", {name: "What should we call it?"})).toBeVisible();
    const manage = page.url();

    // setup: the exchange, who's in, who lives where, then the draw
    await page.getByLabel("Exchange name").fill("Snowbell Gift Night");
    await page.getByLabel("Gift day", {exact: true}).fill("2023-01-06");
    await page.getByLabel("Gift time at the location").fill("18:30");
    await page.getByLabel("Budget in US dollars").fill("35.00");
    await page.getByRole("button", {name: "Next: who’s in"}).click();
    await expect(page.getByRole("heading", {name: "Who’s in?"})).toBeVisible();

    await page.getByRole("checkbox", {name: "Snowstep"}).uncheck();
    await page.getByRole("button", {name: "Next: who lives where"}).click();
    await expect(page.getByRole("heading", {name: "Who lives where?"})).toBeVisible();
    await page.getByRole("link", {name: "Next: draw names"}).click();
    await expect(page.getByRole("button", {name: "Draw names"})).toBeDisabled();
    await page.goto(`${manage}/people`);
    await page.getByRole("checkbox", {name: "Snowstep"}).check();
    await page.getByRole("button", {name: "Next: who lives where"}).click();
    await page.getByRole("link", {name: "Next: draw names"}).click();
    await expect(page.getByRole("heading", {name: "Ready to draw", exact: true})).toBeVisible();

    await disclosure(page, "Test the draw rules").click();
    await page.getByRole("button", {name: "Test the draw rules", exact: true}).click();
    await expect(page.getByText(/Possible\. The fewest eligible people anyone has is 3/)).toBeVisible();
    await page.getByRole("button", {name: "Draw names"}).click();
    await page.getByRole("button", {name: "Skip the animation"}).click();
    await expect(page.getByRole("heading", {name: "Names are drawn"})).toBeVisible();
    const seal = page.getByText(/^Seal code [A-Z0-9]{4}-[A-Z0-9]{4}$/);
    await expect(seal).toBeVisible();
    const initialSeal = await seal.innerText();

    await page.goto(manage);
    await disclosure(page, "Preview as a member").click();
    await page.getByRole("combobox", {name: "Person", exact: true}).selectOption({label: "Snowstep"});
    await page.getByRole("button", {name: "Open preview"}).click();
    await expect(page.getByRole("heading", {name: "Preview as Snowstep"})).toBeVisible();
    await expect(page.getByText("Hidden in preview", {exact: true})).toHaveCount(2);
    await expect(page.getByText("$35.00", {exact: true})).toBeVisible();
    await expect(page.getByText(/^Seal code /)).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("button")).toHaveCount(0);
    await page.screenshot({path: info.outputPath("sealed-organizer-preview.png"), fullPage: true});

    await page.getByRole("link", {name: "Stop"}).click();
    await page.getByRole("link", {name: "Check the sealed draw"}).click();
    await expect(page.getByRole("heading", {name: "The sealed draw passes all the rules."})).toBeVisible();
    await expect(page.getByText("The draw forms one loop.", {exact: true})).toBeVisible();
    await page.screenshot({path: info.outputPath("sealed-draw-proof.png"), fullPage: true});
    await page.getByRole("link", {name: "Your person"}).click();
    expect(["Snowstep", "Brighttwig", "Lanternseed"]).toContain(await openPerson(page));
    await page.goto(manage);
    await expect(page.getByText("1 of 4 have opened their person.", {exact: true})).toBeVisible();
    await disclosure(page, "Replace the entire draw").click();
    await page.getByLabel("Type the confirmation").fill("yes");
    await page.getByRole("button", {name: "Replace the entire draw"}).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Enter the confirmation exactly as shown.");
    await expect(seal).toHaveText(initialSeal);
    await page.screenshot({path: info.outputPath("redraw-confirmation-rejected.png"), fullPage: true});
    await page.getByLabel("Type the confirmation").fill("REDRAW");
    await page.getByRole("button", {name: "Replace the entire draw"}).click();
    await expect(page.getByText("0 of 4 have opened their person.", {exact: true})).toBeVisible();
    await expect(seal).not.toHaveText(initialSeal);
    await page.goto(page.url().replace("/en/", "/es/"));
    await expect(page.getByRole("link", {name: "Tu persona", exact: true})).toBeVisible();
    await expect(page.getByText("0 de 4 ya descubrieron a su persona.", {exact: true})).toBeVisible();
    await page.screenshot({path: info.outputPath("spanish-redraw-reset.png"), fullPage: true});
  } finally {
    await removeFamily(family.id);
  }
});
