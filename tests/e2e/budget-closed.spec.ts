import {randomUUID} from "node:crypto";
import {expect, test, type Page, type TestInfo} from "@playwright/test";
import {Pool} from "pg";
import en from "../../messages/en.json" with {type: "json"};
import es from "../../messages/es.json" with {type: "json"};

const database = new Pool({connectionString: process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL});
test.setTimeout(90_000);
test.afterAll(() => database.end());

async function organizer(page: Page) {
  const name = `Budget guard ${randomUUID().slice(0, 8)}`;
  await page.goto("/en/start");
  await page.getByLabel(en.auth.organizerInvite).fill(process.env.E2E_ORGANIZER_INVITE_CODE!);
  await page.getByLabel(en.auth.familyName).fill(name);
  await page.getByLabel(en.auth.yourName).fill("Northstar");
  await page.getByLabel(en.auth.pin, {exact: true}).fill("4268");
  await page.getByLabel(en.auth.confirmPin).fill("4268");
  await page.getByRole("button", {name: en.auth.createFamily}).click();
  await expect(page.getByRole("heading", {name: en.auth.facePrompt})).toBeVisible();
  await page.getByRole("link", {name: en.auth.notNow}).click();
  await expect(page.getByRole("heading", {name})).toBeVisible();
  const cookie = (await page.context().cookies()).find(({name}) => name === "__Host-fge-session")!;
  const familyId = cookie.value.split(".")[0];
  const {rows: [exchange]} = await database.query("select id from exchanges where family_id = $1", [familyId]);
  return {familyId, exchangeId: exchange.id as string, name};
}

async function budgetForm(page: Page, locale: "en" | "es" = "en") {
  const messages = locale === "en" ? en : es;
  await page.goto(`/${locale}/lists`);
  await page.locator("summary").filter({hasText: messages.lists.budget}).click();
  return page.getByLabel(messages.lists.budget, {exact: true});
}

async function setBudget(page: Page, value: string) {
  const field = await budgetForm(page);
  await field.fill(value);
  await page.getByRole("button", {name: en.lists.saveBudget}).click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText(en.lists.saved);
}

async function state(exchangeId: string) {
  const {rows: [exchange]} = await database.query("select id, status, budget_amount from exchanges where id = $1", [exchangeId]);
  return exchange;
}

async function capture(page: Page, info: TestInfo, label: string) {
  const path = info.outputPath(`${label}.png`);
  await page.screenshot({path, fullPage: true});
  await info.attach(label, {path, contentType: "image/png"});
}

async function prepareClose(page: Page, exchangeId: string, name: string) {
  await page.goto(`/en/exchanges/${exchangeId}/manage`);
  await page.getByRole("button", {name: en.draw.close, exact: true}).click();
  const dialog = page.getByRole("dialog", {name: en.season.closeTitle.replace("{name}", name), exact: true});
  await expect(dialog).toBeVisible();
  return dialog.getByRole("button", {name: en.season.closeConfirm.replace("{name}", name), exact: true});
}

test("organizer can set and clear budgets before a draw and edit drawn and locked exchanges", async ({page}, info) => {
  const f = await organizer(page);
  try {
    await setBudget(page, "45.50");
    await expect(page.getByText("Gift budget: $45.50", {exact: true})).toBeVisible();
    await page.reload();
    await expect(page.getByText("Gift budget: $45.50", {exact: true})).toBeVisible();
    await setBudget(page, "");
    await expect(page.getByText(en.lists.noBudget, {exact: true})).toBeVisible();
    expect(await state(f.exchangeId)).toMatchObject({budget_amount: null});
    await setBudget(page, "25");

    for (const name of ["Snowstep", "Brighttwig", "Lanternseed"]) {
      await page.goto("/en/family");
      const section = page.locator("details").filter({has: page.locator("summary").filter({hasText: /^Add a person$/})});
      await section.locator("summary").click();
      await section.getByRole("textbox", {name: en.auth.name}).fill(name);
      await section.getByRole("button", {name: en.auth.addMember}).click();
      await expect(page.getByRole("heading", {name, exact: true})).toBeVisible();
    }
    await page.goto(`/en/exchanges/${f.exchangeId}/manage`);
    await page.getByLabel(en.draw.giftDay, {exact: true}).fill("2026-12-25");
    await page.getByRole("button", {name: en.draw.saveDetails}).click();
    await expect(page.getByLabel(en.draw.giftDay, {exact: true})).toBeHidden();
    expect(await state(f.exchangeId)).toMatchObject({status: "open"});
    await page.locator("summary").filter({hasText: /^Draw names$/}).click();
    await page.getByRole("button", {name: en.draw.confirmDraw}).click();
    await expect(page.getByText(/^Draw seal /)).toBeVisible();
    expect(await state(f.exchangeId)).toMatchObject({status: "drawn"});
    await setBudget(page, "35");
    expect(await state(f.exchangeId)).toMatchObject({status: "drawn", budget_amount: "35.00"});
    await page.goto(`/en/exchanges/${f.exchangeId}`);
    await page.getByRole("button", {name: en.draw.reveal}).tap();
    await expect(page.getByText(/^You’re giving to /)).toBeVisible();
    expect(await state(f.exchangeId)).toMatchObject({status: "locked"});
    await setBudget(page, "40");
    await expect(page.getByText("Gift budget: $40.00", {exact: true})).toBeVisible();
    expect(await state(f.exchangeId)).toMatchObject({status: "locked", budget_amount: "40.00"});
    await capture(page, info, "open-budget-saved");
  } finally {
    await database.query("delete from families where id = $1", [f.familyId]);
  }
});

for (const locale of ["en", "es"] as const) {
  test(`stale budget forms reject changes, clearing and unchanged saves after closing in another tab (${locale})`, async ({page, context}, info) => {
    const f = await organizer(page);
    const messages = locale === "en" ? en : es;
    try {
      await setBudget(page, "25");
      const attempts = [];
      for (const [label, value] of [["change", "50"], ["clear", ""], ["unchanged", "25.00"]]) {
        const stale = await context.newPage();
        await (await budgetForm(stale, locale)).fill(value);
        attempts.push({stale, label});
      }
      const close = await prepareClose(page, f.exchangeId, f.name);
      await close.click();
      await expect(page.getByRole("heading", {name: en.season.wrapTitle, exact: true})).toBeVisible();
      expect(await state(f.exchangeId)).toMatchObject({status: "closed", budget_amount: "25.00"});
      for (const {stale, label} of attempts) {
        await stale.getByRole("button", {name: messages.lists.saveBudget}).click();
        await expect(stale.getByRole("main").getByRole("alert")).toHaveText(messages.lists.feedback.closed);
        await expect(stale.getByRole("main").getByRole("status")).toHaveCount(0);
        expect(await state(f.exchangeId)).toMatchObject({status: "closed", budget_amount: "25.00"});
        await capture(stale, info, `closed-${locale}-${label}-rejected`);
      }
      await page.goto(`/en/exchanges/${f.exchangeId}`);
      await expect(page.getByRole("heading", {name: en.season.wrapTitle, exact: true})).toBeVisible();
      expect(await state(f.exchangeId)).toMatchObject({status: "closed", budget_amount: "25.00"});
      await capture(page, info, "closed-exchange-retained-budget");
      await page.goto(`/${locale}/lists`);
      await expect(page.getByRole("button", {name: messages.lists.saveBudget})).toHaveCount(0);
      await expect(page.getByLabel(messages.lists.budget, {exact: true})).toHaveCount(0);
      await info.attach("closed-exchange-state", {body: JSON.stringify(await state(f.exchangeId), null, 2), contentType: "application/json"});
    } finally {
      await database.query("delete from families where id = $1", [f.familyId]);
    }
  });
}

test("a budget save queued behind the real close action rechecks status under the row lock", async ({page, context}, info) => {
  const f = await organizer(page);
  const holder = await database.connect();
  try {
    await setBudget(page, "25");
    const stale = await context.newPage();
    await (await budgetForm(stale)).fill("99");
    const close = await prepareClose(page, f.exchangeId, f.name);
    await holder.query("begin");
    await holder.query("select id from exchanges where id = $1 for update", [f.exchangeId]);
    const {rows: [{pid}]} = await holder.query("select pg_backend_pid() as pid");
    const blockers = [pid];
    const waiting = async () => (await database.query(
      "select pid, wait_event_type, query from pg_stat_activity where pg_blocking_pids(pid) && $1::int[] and wait_event_type = 'Lock' and query like '%\"exchanges\"%'",
      [blockers],
    )).rows;
    await close.click();
    await expect.poll(async () => (await waiting()).length).toBe(1);
    blockers.push(...(await waiting()).map(({pid}) => pid));
    await stale.getByRole("button", {name: en.lists.saveBudget}).click();
    await expect.poll(async () => (await waiting()).length).toBe(2);
    await info.attach("both-actions-waiting-on-exchange-lock", {body: JSON.stringify(await waiting(), null, 2), contentType: "application/json"});
    await holder.query("commit");
    await expect(page.getByRole("heading", {name: en.season.wrapTitle, exact: true})).toBeVisible();
    await expect(stale.getByRole("main").getByRole("alert")).toHaveText(en.lists.feedback.closed);
    expect(await state(f.exchangeId)).toMatchObject({status: "closed", budget_amount: "25.00"});
    await capture(stale, info, "queued-budget-rejected");
    await info.attach("closed-exchange-state", {body: JSON.stringify(await state(f.exchangeId), null, 2), contentType: "application/json"});
  } finally {
    await holder.query("rollback");
    holder.release();
    await database.query("delete from families where id = $1", [f.familyId]);
  }
});
