import {randomUUID} from "node:crypto";
import {expect, test, type Browser, type Page, type TestInfo} from "@playwright/test";
import {and, eq, sql} from "drizzle-orm";
import en from "../../messages/en.json" with {type: "json"};
import es from "../../messages/es.json" with {type: "json"};
import {connectDatabase, runForFamily} from "../../src/server/db/database";
import {exchanges, families, keepApart, outbox, participants, people} from "../../src/server/db/schema";
import {createSession, digest, secret} from "../../src/server/auth/session";
import {hashPin} from "../../src/server/auth/pin";
import {authEvents, pinCredentials, sessionDisputes, sessions} from "../../src/server/auth/schema";
import {assignments, drawOpenings, drawRuleSnapshots} from "../../src/server/draw/schema";
import {drawSeal, openText, sealText} from "../../src/server/draw/sealing";
import {openPerson} from "../helpers/open-person";

test.setTimeout(90_000);

// Only the starting family, sealed draw, and signed-in devices are fixtures.
// Every tested disclosure and mutation goes through the running HTTPS app.
async function family(browser: Browser, options: {count?: number; active?: number; state?: "setup" | "open" | "drawn" | "locked"; helpers?: boolean; organizers?: number[]; groups?: number[][]; order?: number[]} = {}) {
  const {count = 6, active = count, state = "drawn", helpers = false, organizers = [0]} = options;
  const database = connectDatabase((process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL)!);
  const familyId = randomUUID(), exchangeId = randomUUID();
  const ids: string[] = Array.from({length: count}, () => randomUUID());
  const names = ids.map((_, i) => `Person ${String.fromCharCode(65 + i)}`);
  const groups = options.groups ?? [options.order ?? Array.from({length: active}, (_, i) => i)];
  const previous = new Map(groups.flatMap(group => group.map((i, j) => [ids[i], ids[group[(j + 1) % group.length]]] as const)));
  const key = Buffer.from(process.env.E2E_ASSIGNMENT_ENCRYPTION_KEY!, "base64");
  const version = state === "setup" || state === "open" ? 0 : 1;
  await database.db.insert(families).values({id: familyId, name: "Intent browser family"});
  await database.db.insert(people).values(ids.map((id, i) => ({familyId, id, displayName: names[i], language: i % 2 ? "es" as const : "en" as const,
    role: i === organizers[0] ? "organizer" as const : organizers.includes(i) ? "co_organizer" as const : "member" as const,
    helperId: helpers && i > 0 && i <= 10 ? ids[0] : null,
  })));
  const pinHash = await hashPin(process.env.E2E_AUTH_SECRET!, "4268");
  await database.db.insert(pinCredentials).values(ids.map(personId => ({familyId, personId, pinHash, joinedAt: new Date(), changedAt: new Date()})));
  await database.db.insert(exchanges).values({familyId, id: exchangeId, name: "Intent Christmas", giftDay: "2026-12-25", giftTime: "18:00", place: "Winter Hall", listDeadline: "2026-12-20", budgetAmount: "25", status: state, drawVersion: version,
    seal: version ? drawSeal(key, familyId, exchangeId, version, previous) : null});
  await database.db.insert(participants).values(ids.map((personId, i) => ({familyId, exchangeId, personId, status: i < active ? "in" as const : "out" as const})));
  if (version) {
    await database.db.insert(drawRuleSnapshots).values({familyId, exchangeId, roster: ids.slice(0, active).map((id, i) => ({id, householdId: null, helperId: helpers && i > 0 && i <= 10 ? ids[0] : null})), keepApart: []});
    await database.db.insert(assignments).values([...previous].map(([giverId, recipientId]) => ({familyId, exchangeId, giverId, version,
      recipientSealed: sealText(key, {familyId, exchangeId, giverId, version, field: "assignment"}, recipientId)})));
  }
  const contexts: Awaited<ReturnType<Browser["newContext"]>>[] = [];
  async function device(index: number) {
    const token = secret();
    const session = await runForFamily(database.db, familyId, tx => createSession(tx, familyId, ids[index], digest(token), "iphone", new Date()));
    const context = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true,
      reducedMotion: "reduce"});
    contexts.push(context);
    const origin = `https://localhost:${process.env.E2E_PORT || "3100"}`;
    await context.addCookies([
      {name: "__Host-fge-session", value: session.cookie, url: origin, secure: true, httpOnly: true, sameSite: "Lax"},
      {name: "__Host-fge-device", value: token, url: origin, secure: true, httpOnly: true, sameSite: "Lax"},
    ]);
    return {page: await context.newPage(), sessionId: session.id};
  }
  async function notices() { return database.db.select().from(outbox).where(eq(outbox.familyId, familyId)); }
  async function pairs() {
    const rows = await database.db.select().from(assignments).where(eq(assignments.familyId, familyId));
    return new Map(rows.map(row => [row.giverId, openText(key, {familyId, exchangeId, giverId: row.giverId, version: row.version, field: "assignment"}, row.recipientSealed)]));
  }
  return {database, familyId, exchangeId, ids, names, previous, device, notices, pairs,
    member: `/en/exchanges/${exchangeId}`, manage: `/en/exchanges/${exchangeId}/manage`,
    async close() { await Promise.allSettled(contexts.map(context => context.close())); await database.db.delete(families).where(eq(families.id, familyId)); await database.close(); },
  };
}

async function capture(page: Page, info: TestInfo, label: string) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const path = info.outputPath(`${label}.png`);
  await page.screenshot({path, fullPage: true, animations: "disabled"});
  await info.attach(label, {path, contentType: "image/png"});
}
async function reveal(page: Page, path: string) {
  await page.goto(path);
  return openPerson(page);
}
async function reportOtherOpening(page: Page) {
  await page.goto("/en/account");
  const section = page.locator("section").filter({has: page.getByRole("heading", {name: "Your person opened on other devices"})});
  await section.getByRole("button", {name: "That wasn't me", exact: true}).click();
  await expect(page).toHaveURL(/reported=1/);
}
async function noticeEvidence(f: Awaited<ReturnType<typeof family>>, info: TestInfo, label: string) {
  const rows = await f.notices();
  expect(rows.every(row => row.requesterName === null)).toBe(true);
  await info.attach(label, {body: JSON.stringify(rows.map(row => ({recipient: f.names[f.ids.indexOf(row.personId!)], template: row.template, language: row.language, status: row.status})), null, 2), contentType: "application/json"});
}

for (const locale of ["en", "es"] as const) {
  test(`onboarding opens the Sweater Weather person before sizes in ${locale}`, async ({browser}, info) => {
    const f = await family(browser);
    try {
      const member = await f.device(1);
      const messages = locale === "en" ? en : es;
      await member.page.goto(`/${locale}/welcome`);
      expect(await openPerson(member.page)).toBe("Person C");
      await capture(member.page, info, `${locale}-onboarding-person`);
      await member.page.getByRole("link", {name: messages.getIn.sizes.title, exact: true}).click();
      await expect(member.page).toHaveURL(new RegExp(`/${locale}/welcome/sizes$`));
      await expect(member.page.getByRole("heading", {name: messages.getIn.sizes.title, exact: true})).toBeVisible();
    } finally { await f.close(); }
  });
}

for (const surface of ["home", "family lists"] as const) {
  test(`opened match leads ${surface} in both languages and a second-device disclosure can be reported`, async ({browser}, info) => {
    const f = await family(browser);
    try {
      const owner = await f.device(1), other = await f.device(1);
      const path = surface === "home" ? "/en" : "/en/lists";
      await other.page.goto(path);
      await expect(other.page.getByRole("link").filter({hasText: en.lists.onlyYou})).toHaveCount(0);
      expect(await f.database.db.select().from(drawOpenings).where(eq(drawOpenings.familyId, f.familyId))).toEqual([]);
      await capture(other.page, info, `${surface}-before-reveal`);
      await reveal(owner.page, f.member);
      for (const locale of ["en", "es"] as const) {
        const messages = locale === "en" ? en : es;
        await other.page.goto(surface === "home" ? `/${locale}` : `/${locale}/lists`);
        const recipient = other.page.getByRole("link").filter({hasText: messages.lists.onlyYou});
        await expect(recipient).toBeVisible();
        await expect(recipient).toHaveAccessibleName(new RegExp(messages.lists.openPerson.replace("{name}", "Person C")));
        await expect(recipient).toHaveAttribute("href", `/${locale}/lists/${f.ids[2]}`);
        if (surface === "family lists") {
          const remaining = other.page.locator("main li a");
          expect(await remaining.evaluateAll((links) => links.map((link) => link.getAttribute("href"))))
            .toEqual([0, 3, 4, 5].map((index) => `/${locale}/lists/${f.ids[index]}`));
          expect(await recipient.evaluate((node, next) => !!(node.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING),
            (await remaining.first().elementHandle())!)).toBe(true);
        }
        await capture(other.page, info, `${surface}-${locale}-match-first`);
      }
      const opening = (await f.database.db.select().from(drawOpenings).where(and(eq(drawOpenings.familyId, f.familyId), eq(drawOpenings.sessionId, other.sessionId))))[0];
      expect(opening).toBeDefined();
      await other.page.goto(path);
      expect((await f.database.db.select().from(drawOpenings).where(and(eq(drawOpenings.familyId, f.familyId), eq(drawOpenings.sessionId, other.sessionId))))[0].openedAt).toEqual(opening.openedAt);
      await reportOtherOpening(owner.page);
      await owner.page.goto("/es/notifications");
      await expect(owner.page.getByRole("heading", {name: es.notify.templates["plans-changed"].title, exact: true})).toBeVisible();
      await expect(owner.page.getByText(es.notify.templates["plans-changed"].body, {exact: true})).toBeVisible();
      for (const name of f.names) await expect(owner.page.getByRole("main")).not.toContainText(name);
      await reveal(owner.page, f.member);
      await expect(owner.page.getByRole("heading", {level: 1})).not.toHaveText("You’re giving to Person C");
      await capture(owner.page, info, `${surface}-reported-match-repaired`);
      await other.page.goto(f.member);
      await expect(other.page).toHaveURL(/\/en\/sign-in$/);
      await noticeEvidence(f, info, `${surface}-recovery-routing`);
    } finally { await f.close(); }
  });
}

for (const state of ["setup", "open", "drawn", "locked"] as const) {
  test(`plan edits and both budget editors notify only participants in ${state}`, async ({browser}, info) => {
    const f = await family(browser, {count: 6, active: 5, state});
    try {
      const organizer = await f.device(0), member = await f.device(1), excluded = await f.device(5);
      const page = organizer.page;
      const expected = f.ids.slice(0, 5).sort();
      const reset = async () => {
        await f.database.db.update(exchanges).set({status: state}).where(eq(exchanges.id, f.exchangeId));
        await f.database.db.delete(outbox).where(eq(outbox.familyId, f.familyId));
      };
      const check = async (template: string) => {
        await expect.poll(async () => (await f.notices()).map(row => row.personId).sort()).toEqual(expected);
        const rows = await f.notices();
        expect(rows.map(row => row.personId).sort()).toEqual(expected);
        expect(rows.every(row => row.template === template && row.requesterName === null)).toBe(true);
        for (const row of rows) expect(row.language).toBe(f.ids.indexOf(row.personId!) % 2 ? "es" : "en");
      };
      // Start each action in the named state, then submit an actual browser form.
      await reset();
      await page.goto("/en/lists");
      await page.getByLabel(en.lists.budget, {exact: true}).fill("30");
      await page.getByRole("button", {name: en.lists.saveBudget, exact: true}).click();
      await expect(page.getByRole("status").filter({hasText: en.lists.saved}).last()).toBeVisible();
      await check("budget-changed");
      await page.getByRole("button", {name: en.lists.saveBudget, exact: true}).click();
      await expect(page.getByRole("button", {name: en.lists.saveBudget, exact: true})).toBeEnabled();
      await check("budget-changed");
      // Clearing and setting a budget are changes too, in every exchange state.
      for (const amount of ["", "35"]) {
        await reset();
        await page.getByLabel(en.lists.budget, {exact: true}).fill(amount);
        await page.getByRole("button", {name: en.lists.saveBudget, exact: true}).click();
        await expect(page.getByRole("status").filter({hasText: en.lists.saved}).last()).toBeVisible();
        await check("budget-changed");
        expect((await f.database.db.select().from(exchanges).where(eq(exchanges.id, f.exchangeId)))[0].budgetAmount)
          .toBe(amount ? `${amount}.00` : null);
      }
      await reset();
      await page.goto(`${f.manage}/details`);
      const budget = page.getByLabel("Budget in US dollars", {exact: true});
      await budget.fill("40");
      await page.getByRole("button", {name: "Save exchange details", exact: true}).click();
      await expect(page.getByText(en.draw.detailsSaved, {exact: true})).toBeVisible();
      await check("budget-changed");
      for (const amount of ["", "45"]) {
        await reset();
        await page.goto(`${f.manage}/details`);
        await budget.fill(amount);
        await page.getByRole("button", {name: "Save exchange details", exact: true}).click();
        await expect(page.getByText(en.draw.detailsSaved, {exact: true})).toBeVisible();
        await check("budget-changed");
        expect((await f.database.db.select().from(exchanges).where(eq(exchanges.id, f.exchangeId)))[0].budgetAmount)
          .toBe(amount ? `${amount}.00` : null);
      }
      await member.page.goto("/es/notifications");
      await expect(member.page.getByRole("heading", {name: es.notify.templates["budget-changed"].title, exact: true})).toBeVisible();
      await capture(member.page, info, `${state}-private-budget-notice`);
      await noticeEvidence(f, info, `${state}-budget-notice-routing`);
      for (const [label, value] of [["Gift day", "2026-12-26"], ["Gift time at the location", "19:00"], ["Place", "Lantern Hall"], ["List deadline", "2026-12-19"]]) {
        await reset();
        await page.goto(`${f.manage}/details`);
        const field = page.getByLabel(label, {exact: true});
        await field.fill(value);
        await page.getByRole("button", {name: "Save exchange details", exact: true}).click();
        await expect(page.getByText(en.draw.detailsSaved, {exact: true})).toBeVisible();
        await check("exchange-details-changed");
      }
      await member.page.goto("/es/notifications");
      await expect(member.page.getByRole("heading", {name: es.notify.templates["exchange-details-changed"].title, exact: true})).toBeVisible();
      for (const name of f.names) await expect(member.page.getByRole("main")).not.toContainText(name);
      await capture(member.page, info, `${state}-private-plan-notice`);
      await excluded.page.goto("/en/notifications");
      await expect(excluded.page.getByText(en.notify.inbox.empty, {exact: true})).toBeVisible();
      await noticeEvidence(f, info, `${state}-notice-routing`);
    } finally { await f.close(); }
  });
}

test("a failed required claimer notice rolls back edits and removals with a generic error", async ({browser}, info) => {
  const f = await family(browser);
  const functionName = `gate_notice_${f.familyId.replaceAll("-", "")}`;
  try {
    const owner = await f.device(1), buyer = await f.device(2);
    const page = owner.page;
    await page.goto(`/en/lists/${f.ids[1]}/items/new?kind=note`);
    await page.getByLabel(en.lists.title, {exact: true}).fill("Secret winter puzzle");
    await page.getByRole("button", {name: en.lists.saveItem, exact: true}).click();
    await buyer.page.goto(`/en/lists/${f.ids[1]}`);
    await buyer.page.getByRole("button", {name: en.lists.claim, exact: true}).click();
    await expect(buyer.page.getByText(en.lists.mine, {exact: true})).toBeVisible();
    // A real database write rejection exercises the action's transaction boundary.
    await f.database.db.execute(sql.raw(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.family_id = '${f.familyId}'::uuid AND NEW.template = 'claimed-item-changed' THEN RAISE EXCEPTION 'Private queue failure details'; END IF; RETURN NEW; END $$`));
    await f.database.db.execute(sql.raw(`CREATE TRIGGER ${functionName} BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION ${functionName}()`));
    await page.getByRole("link", {name: en.lists.editNamedItem.replace("{title}", "Secret winter puzzle"), exact: true}).click();
    await page.getByLabel(en.lists.title, {exact: true}).fill("Changed winter puzzle");
    await page.getByRole("button", {name: en.lists.saveItem, exact: true}).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(en.lists.feedback["could-not-save"]);
    await expect(page.getByRole("main")).not.toContainText("Private queue failure details");
    await capture(page, info, "claimer-notice-failure-generic-edit");
    await page.goto(`/en/lists/${f.ids[1]}`);
    const card = page.getByRole("article", {name: "Secret winter puzzle", exact: true});
    await expect(card).toBeVisible();
    await expect(page.getByText(en.lists.someone, {exact: true})).toHaveCount(0);
    await card.getByRole("link", {name: en.lists.editNamedItem.replace("{title}", "Secret winter puzzle"), exact: true}).click();
    const removing = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/remove"));
    await page.getByRole("button", {name: en.lists.deleteItem, exact: true}).click();
    await expect(card).toHaveCount(0);
    await removing;
    await expect(page.getByRole("status").filter({hasText: en.lists.feedback["could-not-save"]})).toBeVisible();
    await page.reload();
    await expect(card).toBeVisible();
    expect(await f.notices()).toEqual([]);
    await capture(page, info, "claimer-notice-failure-keeps-item");
    await f.database.db.execute(sql.raw(`DROP TRIGGER ${functionName} ON outbox`));
    await page.getByRole("link", {name: en.lists.editNamedItem.replace("{title}", "Secret winter puzzle"), exact: true}).click();
    await page.getByLabel(en.lists.title, {exact: true}).fill("Changed winter puzzle");
    await page.getByRole("button", {name: en.lists.saveItem, exact: true}).click();
    await expect(page.getByRole("article", {name: "Changed winter puzzle", exact: true})).toBeVisible();
    expect((await f.notices()).map(row => [row.personId, row.template])).toEqual([[f.ids[2], "claimed-item-changed"]]);
    await buyer.page.goto("/en/notifications");
    await expect(buyer.page.getByRole("heading", {name: en.notify.templates["claimed-item-changed"].title, exact: true})).toBeVisible();
    await expect(buyer.page.getByRole("main")).not.toContainText("winter puzzle");
    await capture(buyer.page, info, "claimer-notice-retry-committed");
    await noticeEvidence(f, info, "claimer-notice-atomic-routing");
  } finally {
    await f.database.db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${functionName} ON outbox`));
    await f.database.db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${functionName}()`));
    await f.close();
  }
});

test("question answers, dropout repair and roster redraw notify exactly affected people without pairing data", async ({browser}, info) => {
  const f = await family(browser);
  try {
    const devices = [];
    for (let index = 0; index < 6; index++) { const device = await f.device(index); devices.push(device); await reveal(device.page, f.member); }
    const page = devices[0].page;
    // Both restyled promises must lead to a real private notice in the asker's language.
    for (const [index, locale] of ["en", "es"].entries()) {
      const messages = locale === "en" ? en : es;
      const asker = devices[index].page, recipient = devices[index + 1].page;
      await reveal(asker, f.member.replace("/en/", `/${locale}/`));
      const ask = messages.draw.person.askForIdeas.replace("{name}", f.names[index + 1]);
      await asker.getByRole("button", {name: ask, exact: true}).click();
      await asker.getByLabel(messages.draw.askLabel).fill("Secret question about blue ribbons");
      await asker.getByRole("button", {name: messages.draw.askButton, exact: true}).click();
      await expect(asker.getByText(messages.draw.person.sentHint, {exact: true})).toBeVisible();
      await recipient.goto(`${f.member.replace("/en/", `/${locale}/`)}?answer=1`);
      await recipient.getByLabel(messages.draw.answerLabel).fill("Secret answer about green ribbons");
      await recipient.getByRole("button", {name: messages.draw.answerButton, exact: true}).click();
      await expect(recipient.getByText(messages.draw.answered, {exact: true})).toBeVisible();
      expect((await f.notices()).map(row => [row.personId, row.template, row.language]))
        .toEqual([[f.ids[index], "question-answered", locale]]);
      await asker.goto(`/${locale}/notifications`);
      await expect(asker.getByRole("heading", {name: messages.notify.templates["question-answered"].title, exact: true})).toBeVisible();
      await expect(asker.getByText(messages.notify.templates["question-answered"].body, {exact: true})).toBeVisible();
      await expect(asker.getByRole("main")).not.toContainText("ribbons");
      for (const name of f.names) await expect(asker.getByRole("main")).not.toContainText(name);
      await capture(asker, info, `${locale}-private-answer-notice`);
      await f.database.db.delete(outbox).where(eq(outbox.familyId, f.familyId));
    }
    // The confirmation's named notice is exactly what changed givers receive.
    for (const [locale, messages] of [["en", en], ["es", es]] as const) {
      await page.goto(f.manage.replace("/en/", `/${locale}/`));
      await page.locator("summary").filter({hasText: messages.draw.participation}).click();
      await page.getByRole("button", {name: messages.draw.dropout.replace("{name}", "Person F"), exact: true}).click();
      await expect(page.getByRole("dialog")).toContainText(messages.notify.templates["plans-changed"].title);
      await page.getByRole("button", {name: messages.draw.season.keepIn.replace("{name}", "Person F"), exact: true}).click();
    }
    await page.goto(f.manage);
    await page.locator("summary").filter({hasText: /^Dropouts and late joiners$/}).click();
    await page.getByRole("button", {name: "Person F can’t take part", exact: true}).click();
    await page.getByRole("button", {name: "Yes, take Person F out", exact: true}).click();
    await expect(page.getByText("4 of 5 have opened their person.", {exact: true})).toBeVisible();
    const repaired = await f.pairs();
    const changed = [...repaired].filter(([giver, recipient]) => f.previous.get(giver) !== recipient).map(([giver]) => giver).sort();
    const repairRows = await f.notices();
    expect(repairRows.filter(row => row.template === "plans-changed").map(row => row.personId).sort()).toEqual(changed);
    expect(repairRows.filter(row => row.template === "participation-cancelled").map(row => row.personId)).toEqual([f.ids[5]]);
    expect(repairRows).toHaveLength(changed.length + 1);
    for (const id of changed) {
      const index = f.ids.indexOf(id);
      const messages = index % 2 ? es : en;
      await devices[index].page.goto(`/${index % 2 ? "es" : "en"}/notifications`);
      await expect(devices[index].page.getByRole("heading", {name: messages.notify.templates["plans-changed"].title, exact: true})).toBeVisible();
      await expect(devices[index].page.getByText(messages.notify.templates["plans-changed"].body, {exact: true})).toBeVisible();
      for (const name of f.names) await expect(devices[index].page.getByRole("main")).not.toContainText(name);
    }
    await devices[5].page.goto("/es/notifications");
    await expect(devices[5].page.getByRole("heading", {name: es.notify.templates["participation-cancelled"].title, exact: true})).toBeVisible();
    await capture(devices[5].page, info, "departing-participant-cancellation");
    await noticeEvidence(f, info, "dropout-notice-routing");
    await f.database.db.delete(outbox).where(eq(outbox.familyId, f.familyId));
    await page.goto(f.manage);
    await page.locator("summary").filter({hasText: /^Replace the entire draw$/}).click();
    await page.getByLabel("Type the confirmation", {exact: true}).fill("REDRAW");
    await page.getByRole("checkbox", {name: "Person E", exact: true}).uncheck();
    await page.getByRole("button", {name: "Replace the entire draw", exact: true}).click();
    await expect(page.getByText("0 of 4 have opened their person.", {exact: true})).toBeVisible();
    const redrawRows = await f.notices();
    expect(redrawRows.filter(row => row.template === "draw-redrawn").map(row => row.personId).sort()).toEqual(f.ids.slice(0, 4).sort());
    expect(redrawRows.filter(row => row.template === "participation-cancelled").map(row => row.personId)).toEqual([f.ids[4]]);
    expect(redrawRows).toHaveLength(5);
    await page.goto("/en/notifications");
    await expect(page.getByRole("heading", {name: en.notify.templates["draw-redrawn"].title, exact: true})).toBeVisible();
    await expect(page.getByText(en.notify.templates["draw-redrawn"].body, {exact: true})).toBeVisible();
    for (const name of f.names) await expect(page.getByRole("main")).not.toContainText(name);
    await capture(page, info, "full-redraw-neutral-notice");
    await devices[4].page.goto("/en/notifications");
    await expect(devices[4].page.getByRole("heading", {name: en.notify.templates["participation-cancelled"].title, exact: true})).toBeVisible();
    await capture(devices[4].page, info, "redraw-departing-participant-cancellation");
    await noticeEvidence(f, info, "redraw-notice-routing");
  } finally { await f.close(); }
});

// Persist a pending report as initial recovery state. The browser below runs
// the actual reconciliation/redraw, without replacing the solver or publisher.
async function pendingReports(f: Awaited<ReturnType<typeof family>>, indices: number[], reporterId: string) {
  for (const index of indices) {
    const disputed = await f.device(index);
    await f.database.db.update(participants).set({seenVersion: 1}).where(and(eq(participants.familyId, f.familyId), eq(participants.personId, f.ids[index])));
    const eventId = randomUUID();
    await f.database.db.insert(drawOpenings).values({familyId: f.familyId, exchangeId: f.exchangeId, giverId: f.ids[index], viewerId: f.ids[index], sessionId: disputed.sessionId, version: 1});
    await f.database.db.insert(authEvents).values({familyId: f.familyId, id: eventId, personId: f.ids[index], kind: "keyDisputed", sessionId: disputed.sessionId});
    await f.database.db.insert(sessionDisputes).values({familyId: f.familyId, eventId, personId: f.ids[index], disputedSessionId: disputed.sessionId, affectedSessionIds: [disputed.sessionId], reportedBySessionId: reporterId});
    await f.database.db.update(sessions).set({revokedAt: new Date()}).where(and(eq(sessions.familyId, f.familyId), eq(sessions.id, disputed.sessionId)));
  }
}

test("a sixteen-person confirmed redraw resolves a pending disclosure with two organizers", async ({browser}, info) => {
  const f = await family(browser, {count: 16, state: "locked", organizers: [0, 8]});
  try {
    const organizer = await f.device(0);
    await pendingReports(f, [1], organizer.sessionId);
    const page = organizer.page;
    await page.goto(f.manage);
    await page.locator("summary").filter({hasText: /^Replace the entire draw$/}).click();
    await page.getByLabel("Type the confirmation", {exact: true}).fill("REDRAW");
    const started = Date.now();
    await page.getByRole("button", {name: "Replace the entire draw", exact: true}).click();
    await expect(page.getByText("0 of 16 have opened their person.", {exact: true})).toBeVisible();
    const elapsed = Date.now() - started;
    const next = await f.pairs();
    expect(next.get(f.ids[1])).not.toBe(f.previous.get(f.ids[1]));
    expect(new Set(next.values()).size).toBe(16);
    expect((await f.notices()).map(row => row.personId).sort()).toEqual([...f.ids].sort());
    expect((await f.notices()).every(row => row.template === "draw-redrawn")).toBe(true);
    await page.goto(`${f.manage}?check=1`);
    await expect(page.getByRole("heading", {name: "The sealed draw passes all the rules.", exact: true})).toBeVisible();
    await capture(page, info, "sixteen-person-private-redraw");
    await info.attach("sixteen-person-redraw-state", {body: JSON.stringify({pendingDisclosureChanged: true, uniqueRecipients: next.size, elapsedMs: elapsed, participantNotices: (await f.notices()).length}), contentType: "application/json"});
  } finally { await f.close(); }
});

test("reporting a helper phone that opened eleven matches restores access with the lowest-change repair", async ({browser}, info) => {
  const f = await family(browser, {count: 16, helpers: true, organizers: [13, 14], order: [0, 11, 1, 12, 2, 13, 3, 14, 4, 5, 6, 7, 8, 9, 10, 15]});
  try {
    const compromised = await f.device(0), owner = await f.device(0);
    await reveal(compromised.page, f.member);
    for (let index = 1; index <= 10; index++) {
      await compromised.page.goto("/en/account");
      await compromised.page.getByRole("button", {name: en.auth.helpAs.replace("{name}", f.names[index]), exact: true}).click();
      await expect(compromised.page).toHaveURL(/\/en\/helping$/);
      await reveal(compromised.page, f.member);
    }
    const openings = await f.database.db.select().from(drawOpenings).where(and(eq(drawOpenings.familyId, f.familyId), eq(drawOpenings.sessionId, compromised.sessionId)));
    expect(openings).toHaveLength(11);
    await reportOtherOpening(owner.page);
    const next = await f.pairs();
    const changed = f.ids.filter(id => next.get(id) !== f.previous.get(id));
    expect(changed.sort()).toEqual(f.ids.slice(0, 11).sort());
    expect((await f.notices()).filter(row => row.template === "plans-changed").map(row => row.personId).sort()).toEqual([...changed].sort());
    await reveal(owner.page, f.member);
    await capture(owner.page, info, "eleven-exposed-matches-repaired");
    const organizer = await f.device(13);
    await organizer.page.goto(`${f.manage}?check=1`);
    await expect(organizer.page.getByRole("heading", {name: "The sealed draw passes all the rules.", exact: true})).toBeVisible();
    await capture(organizer.page, info, "helper-repair-sealed-proof");
    await info.attach("helper-recovery-state", {body: JSON.stringify({exposedMatches: openings.length, changedMatches: changed.length, unchangedMatches: 16 - changed.length, uniqueRecipients: new Set(next.values()).size}), contentType: "application/json"});
  } finally { await f.close(); }
});

test("pending recovery continues beyond the capped ten-change layer to an eleven-change private repair", async ({browser}, info) => {
  const first = [0, 1, 2, 3, 4, 5], second = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const f = await family(browser, {count: 16, organizers: [4, 6], groups: [first, second]});
  try {
    const excluded = first.flatMap(a => second.map(b => ({personA: f.ids[a], personB: f.ids[b]})));
    await f.database.db.insert(keepApart).values(excluded.map(pair => {const [personA, personB] = [pair.personA, pair.personB].sort(); return {familyId: f.familyId, exchangeId: f.exchangeId, personA, personB, reason: "custom" as const};}));
    await f.database.db.update(drawRuleSnapshots).set({keepApart: excluded}).where(eq(drawRuleSnapshots.familyId, f.familyId));
    const organizer = await f.device(4), member = await f.device(1);
    const exposed = [1, ...second.slice(0, 8)];
    await pendingReports(f, exposed, organizer.sessionId);
    await member.page.goto(f.member);
    await expect(member.page.getByRole("button", {name: en.draw.person.revealTap, exact: true})).toBeVisible();
    const next = await f.pairs();
    expect(f.ids.filter(id => next.get(id) !== f.previous.get(id))).toHaveLength(11);
    expect(exposed.every(i => next.get(f.ids[i]) !== f.previous.get(f.ids[i]))).toBe(true);
    await reveal(member.page, f.member);
    await capture(member.page, info, "later-layer-recovered-member");
    await organizer.page.goto(`${f.manage}?check=1`);
    await expect(organizer.page.getByRole("heading", {name: "The sealed draw passes all the rules.", exact: true})).toBeVisible();
    await capture(organizer.page, info, "later-layer-private-repair-proof");
    await info.attach("later-layer-repair-state", {body: JSON.stringify({exposedMatches: exposed.length, changedMatches: 11, continuedBeyondMinimumLayer: true, uniqueRecipients: new Set(next.values()).size}), contentType: "application/json"});
  } finally { await f.close(); }
});

test("a low-choice roster remains drawable and warns that pairings may be worked out", async ({browser}, info) => {
  const f = await family(browser, {count: 4, state: "open"});
  try {
    const [personA, personB] = [f.ids[0], f.ids[2]].sort();
    await f.database.db.insert(keepApart).values({familyId: f.familyId, exchangeId: f.exchangeId, personA, personB, reason: "custom"});
    const organizer = await f.device(0);
    await organizer.page.goto(`${f.manage}/draw`);
    await expect(organizer.page.getByText("2 people have fewer than three eligible people. People may be able to work out who has whom.", {exact: true})).toBeVisible();
    await capture(organizer.page, info, "low-choice-authorized-warning");
    await organizer.page.getByRole("button", {name: "Draw names", exact: true}).click();
    await expect(organizer.page.getByRole("heading", {name: en.draw.setup.sealedTitle, exact: true})).toBeVisible({timeout: 15_000});
    await organizer.page.goto(f.manage);
    await expect(organizer.page.getByText("0 of 4 have opened their person.", {exact: true})).toBeVisible();
    const rows = await f.notices();
    expect(rows.map(row => row.personId).sort()).toEqual([...f.ids].sort());
    expect(rows.every(row => row.template === "names-drawn" && row.requesterName === null)).toBe(true);
    await organizer.page.goto("/en/notifications");
    await expect(organizer.page.getByRole("heading", {name: en.notify.templates["names-drawn"].title, exact: true})).toBeVisible();
    for (const name of f.names) await expect(organizer.page.getByRole("main")).not.toContainText(name);
    await capture(organizer.page, info, "initial-draw-private-notice");
    await noticeEvidence(f, info, "initial-draw-notice-routing");
  } finally { await f.close(); }
});
