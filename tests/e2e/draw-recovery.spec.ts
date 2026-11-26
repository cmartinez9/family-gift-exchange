import {execFile} from "node:child_process";
import {randomUUID} from "node:crypto";
import {promisify} from "node:util";
import {expect, test, type Browser, type Page, type TestInfo} from "@playwright/test";
import {and, eq, sql} from "drizzle-orm";
import {connectDatabase, runForFamily} from "../../src/server/db/database";
import {exchanges, families, households, keepApart, participants, people} from "../../src/server/db/schema";
import {pinCredentials} from "../../src/server/auth/schema";
import {hashPin} from "../../src/server/auth/pin";
import {createSession, digest, secret} from "../../src/server/auth/session";
import {disputeSession} from "../../src/server/auth/security";
import {assignments, drawRuleSnapshots, practiceFamilies} from "../../src/server/draw/schema";
import {drawSeal, sealText} from "../../src/server/draw/sealing";
import {modelOneLoop, possibleDraws} from "../helpers/possible-draws";

// Seed only the starting state: a known, encrypted cycle in a disposable database.
// Reveals, questions, reporting, recovery, and redraws run against the HTTPS app.
async function fixture(browser: Browser, count: number, organizer = 0, coOrganizer: number | null = null) {
  const database = connectDatabase((process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL)!);
  const familyId = randomUUID();
  const exchangeId = randomUUID();
  const ids: string[] = Array.from({length: count}, () => randomUUID());
  const names = ids.map((_, index) => `Person ${String.fromCharCode(65 + index)}`);
  const previous = new Map(ids.map((id, index) => [id, ids[(index + 1) % ids.length]]));
  const key = Buffer.from(process.env.E2E_ASSIGNMENT_ENCRYPTION_KEY!, "base64");
  const pinHash = await hashPin(process.env.E2E_AUTH_SECRET!, "4268");
  const joinedAt = new Date(Date.now() - 86_400_000);
  await database.db.insert(families).values({id: familyId, name: "Recovery browser family"});
  await database.db.insert(people).values(ids.map((id, index) => ({familyId, id, displayName: names[index],
    role: index === organizer ? "organizer" as const : index === coOrganizer ? "co_organizer" as const : "member" as const,
  })));
  await database.db.insert(pinCredentials).values(ids.map((personId) => ({familyId, personId, pinHash, joinedAt, changedAt: joinedAt})));
  await database.db.insert(exchanges).values({familyId, id: exchangeId, name: "Recovery Christmas", giftDay: "2023-01-06",
    status: "drawn", drawVersion: 1, seal: drawSeal(key, familyId, exchangeId, 1, previous),
  });
  await database.db.insert(participants).values(ids.map((personId) => ({familyId, exchangeId, personId, status: "in" as const})));
  await database.db.insert(drawRuleSnapshots).values({familyId, exchangeId,
    roster: ids.map((id) => ({id, helperId: null, householdId: null})), keepApart: [],
  });
  await database.db.insert(assignments).values(ids.map((giverId) => ({familyId, exchangeId, giverId, version: 1,
    recipientSealed: sealText(key, {familyId, exchangeId, giverId, version: 1, field: "assignment"}, previous.get(giverId)!),
  })));
  const contexts: Awaited<ReturnType<Browser["newContext"]>>[] = [];
  async function device(index: number) {
    const token = secret();
    const session = await runForFamily(database.db, familyId, (tx) => createSession(tx, familyId, ids[index], digest(token), "iphone", new Date()));
    const context = await browser.newContext({viewport: {width: 393, height: 851}, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true});
    contexts.push(context);
    await context.addCookies([
      {name: "__Host-fge-session", value: session.cookie, url: "https://localhost:3100", secure: true, httpOnly: true, sameSite: "Lax"},
      {name: "__Host-fge-device", value: token, url: "https://localhost:3100", secure: true, httpOnly: true, sameSite: "Lax"},
    ]);
    const viewer = {familyId, personId: ids[index], actingAs: ids[index], sessionId: session.id, isOrganizer: index === organizer || index === coOrganizer};
    return {page: await context.newPage(), viewer};
  }
  const devices = [];
  for (let index = 0; index < count; index++) devices.push(await device(index));
  return {familyId, exchangeId, ids, names, previous, devices, device, database,
    member: `/en/exchanges/${exchangeId}`, manage: `/en/exchanges/${exchangeId}/manage`,
    async close() {
      await Promise.allSettled(contexts.map((context) => context.close()));
      const practice = await database.db.select().from(practiceFamilies).where(eq(practiceFamilies.familyId, familyId));
      await database.db.delete(families).where(eq(families.id, familyId));
      for (const row of practice) await database.db.delete(families).where(eq(families.id, row.practiceFamilyId));
      await database.close();
    },
  };
}

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.getByRole("button", {name: "Open your person", exact: true}).click();
  const recipient = page.getByRole("status").filter({hasText: /^You’re giving to /});
  await expect(recipient).toBeVisible();
  return (await recipient.innerText()).replace("You’re giving to ", "").replace(/\.$/, "");
}

async function reportOpening(page: Page) {
  await page.goto("/en/account");
  const section = page.locator("section").filter({has: page.getByRole("heading", {name: "Your person opened on other devices"})});
  await section.getByRole("button", {name: "That wasn't me"}).click();
}

async function capture(page: Page, info: TestInfo, name: string) {
  await page.screenshot({path: info.outputPath(`${name}.png`), fullPage: true});
}

for (const recovery of ["local repair", "confirmed redraw"] as const) {
  test(`four-person disputed reveal restores every match through ${recovery}`, async ({browser}, info) => {
    const f = await fixture(browser, 4, 0, 2);
    try {
      expect(await open(f.devices[1].page, f.member)).toBe("Person C");
      const owner = await f.device(1);
      if (recovery === "local repair") {
        await reportOpening(owner.page);
        await expect(owner.page).toHaveURL(/reported=1/);
      } else {
        // Persist the pending report without running the report action's automatic repair.
        // The organizer's actual browser then executes the confirmed full redraw.
        expect(await runForFamily(f.database.db, f.familyId, (tx) => disputeSession(
          tx, owner.viewer, f.devices[1].viewer.sessionId, new Date(),
        ))).toBe(true);
        const page = f.devices[0].page;
        await page.goto(f.manage);
        await page.locator("summary").filter({hasText: /^Replace the entire draw$/}).click();
        await page.getByLabel("Type the confirmation").fill("REDRAW");
        await page.getByRole("button", {name: "Replace the entire draw", exact: true}).click();
        await expect(page.getByText("0 of 4 have opened their person.", {exact: true})).toBeVisible();
      }
      const actual = new Map<string, string>();
      for (let index = 0; index < 4; index++) actual.set(f.names[index], await open(index === 1 ? owner.page : f.devices[index].page, f.member));
      expect(actual.get("Person B")).not.toBe("Person C");
      expect(new Set(actual.values()).size).toBe(4);
      for (const [giver, recipient] of actual) expect(giver).not.toBe(recipient);
      await f.devices[0].page.goto(`${f.manage}?check=1`);
      await expect(f.devices[0].page.getByRole("heading", {name: "The sealed draw passes all the rules."})).toBeVisible();
      await expect(f.devices[0].page.getByText("4 of 4 have opened their person.", {exact: true})).toBeVisible();
      await capture(f.devices[0].page, info, "four-person-access-restored");
      await f.devices[1].page.goto(f.member);
      await expect(f.devices[1].page).toHaveURL(/\/en\/sign-in$/);
      await info.attach("revealed-results", {body: JSON.stringify(Object.fromEntries(actual), null, 2), contentType: "application/json"});
    } finally { await f.close(); }
  });

  test(`six-person organizer recovers a disputed own reveal through ${recovery}`, async ({browser}, info) => {
    const f = await fixture(browser, 6);
    try {
      expect(await open(f.devices[0].page, f.member)).toBe("Person B");
      const reporter = await f.device(0);
      await reportOpening(reporter.page);
      await expect(reporter.page.getByRole("status")).toHaveText("Everyone was signed out for safety.");
      const {stdout} = await promisify(execFile)("pnpm", ["--silent", "admin:organizer-key", f.familyId], {
        env: {...process.env, DATABASE_ADMIN_URL: process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL,
          AUTH_SECRET: process.env.E2E_AUTH_SECRET, AUTH_ORIGIN: "https://localhost:3100"},
      });
      const page = reporter.page;
      await page.goto(JSON.parse(stdout).url);
      await page.getByRole("button", {name: "Yes, I'm Person A", exact: true}).click();
      await page.getByLabel("4-digit PIN").fill("6285");
      await page.getByLabel("Type the PIN again").fill("6285");
      await page.getByRole("button", {name: "Save PIN", exact: true}).click();
      await page.getByRole("link", {name: "Not now"}).click();
      await expect(page.getByRole("heading", {name: "Hi, Person A!", exact: true})).toBeVisible();
      if (recovery === "confirmed redraw") {
        await page.goto(f.manage);
        await page.locator("summary").filter({hasText: /^Replace the entire draw$/}).click();
        await page.getByLabel("Type the confirmation").fill("REDRAW");
        await page.getByRole("button", {name: "Replace the entire draw", exact: true}).click();
        await expect(page.getByText("0 of 6 have opened their person.", {exact: true})).toBeVisible();
      }
      expect(await open(page, f.member)).not.toBe("Person B");
      await capture(page, info, "organizer-own-reveal-recovered");
      for (let index = 1; index < 6; index++) {
        const member = f.devices[index].page;
        await member.goto(`/en/sign-in?family=${f.familyId}`);
        await member.getByRole("link", {name: f.names[index], exact: true}).click();
        await member.getByLabel("4-digit PIN").fill("4268");
        await member.getByRole("button", {name: "Sign in", exact: true}).click();
        await expect(member.getByRole("heading", {name: `Hi, ${f.names[index]}!`, exact: true})).toBeVisible();
        await open(member, f.member);
      }
      await page.goto(`${f.manage}?check=1`);
      await expect(page.getByRole("heading", {name: "The sealed draw passes all the rules."})).toBeVisible();
      await expect(page.getByText("6 of 6 have opened their person.", {exact: true})).toBeVisible();
      await capture(page, info, "all-six-matches-restored");
    } finally { await f.close(); }
  });
}

test("organizer cannot infer a repaired recipient from their match, question retention, opened count, and loop proof", async ({browser}, info) => {
  const f = await fixture(browser, 6, 4);
  try {
    for (const device of f.devices) await open(device.page, f.member);
    await f.devices[3].page.getByLabel("Your anonymous question").fill("Recognizable question from D");
    await f.devices[3].page.getByRole("button", {name: "Send question", exact: true}).click();
    await expect(f.devices[3].page.getByText("Waiting for an answer", {exact: true})).toBeVisible();
    const owner = await f.device(1);
    await reportOpening(owner.page);
    await expect(owner.page).toHaveURL(/reported=1/);
    const organizer = f.devices[4].page;
    await organizer.goto(`${f.manage}?check=1`);
    await expect(organizer.getByRole("heading", {name: "The sealed draw passes all the rules."})).toBeVisible();
    const seenText = await organizer.getByText(/^\d of 6 have opened their person\.$/).innerText();
    const seen = Number(seenText.split(" ")[0]);
    const oneLoop = await organizer.getByText("The draw forms one loop.", {exact: true}).count() === 1;
    await capture(organizer, info, "organizer-public-proof");
    await organizer.goto(f.member);
    const questionRetained = await organizer.getByText("Recognizable question from D", {exact: true}).count() === 1;
    const actual = new Map<string, string>();
    for (let index = 0; index < 6; index++) {
      const recipient = await open(index === 1 ? owner.page : f.devices[index].page, f.member);
      actual.set(f.ids[index], f.ids[f.names.indexOf(recipient)]);
    }
    const changed = (pairs: ReadonlyMap<string, string>) => f.ids.filter((id) => pairs.get(id) !== f.previous.get(id)).length;
    const alternatives = possibleDraws(f.ids).filter((pairs) => pairs.get(f.ids[1]) !== f.ids[2]
      && changed(pairs) === changed(actual) && pairs.get(f.ids[4]) === actual.get(f.ids[4])
      && f.ids.filter((id) => pairs.get(id) === f.previous.get(id)).length === seen
      && (pairs.get(f.ids[3]) === f.ids[4]) === questionRetained && modelOneLoop(pairs) === oneLoop);
    const possibleRecipients = new Set(alternatives.map((pairs) => pairs.get(f.ids[1])));
    expect(possibleRecipients.size).toBeGreaterThan(1);
    expect(actual.get(f.ids[1])).not.toBe(f.ids[2]);
    await info.attach("privacy-observations", {body: JSON.stringify({changed: changed(actual), opened: seen, oneLoop,
      questionRetained, possibleRecipientNames: [...possibleRecipients].map((id) => f.names[f.ids.indexOf(id!)]),
    }, null, 2), contentType: "application/json"});
    await capture(organizer, info, "organizer-private-view");
  } finally { await f.close(); }
});

test("practice starts and draws without reconciling a pending real-family dispute", async ({browser}, info) => {
  const f = await fixture(browser, 4, 0, 2);
  try {
    await open(f.devices[1].page, f.member);
    const reporter = await f.device(1);
    expect(await runForFamily(f.database.db, f.familyId, (tx) => disputeSession(
      tx, reporter.viewer, f.devices[1].viewer.sessionId, new Date(),
    ))).toBe(true);
    const page = f.devices[0].page;
    await page.goto("/en/exchanges/practice");
    await page.getByRole("button", {name: "Start practice", exact: true}).click();
    await page.getByRole("button", {name: "Draw names", exact: true}).click();
    await expect(page.getByRole("listitem").filter({hasText: / gives to /})).toHaveCount(6);
    await page.reload();
    await expect(page.getByRole("listitem").filter({hasText: / gives to /})).toHaveCount(6);
    const [real] = await f.database.db.select().from(exchanges).where(and(eq(exchanges.familyId, f.familyId), eq(exchanges.id, f.exchangeId)));
    expect(real.drawVersion).toBe(1);
    expect(real.disputedRevealRepairedAt).toBeNull();
    await capture(page, info, "practice-independent-of-real-dispute");
    const guest = f.devices[1].page;
    await guest.goto(page.url());
    await expect(guest).toHaveURL(/\/en\/sign-in$/);
  } finally { await f.close(); }
});

test("closed undated history cannot bypass the active draw's family-removal guard", async ({browser}, info) => {
  const f = await fixture(browser, 4);
  try {
    await f.database.db.insert(exchanges).values({familyId: f.familyId, id: randomUUID(), name: "Closed undated history", status: "closed"});
    const page = f.devices[0].page;
    await page.goto("/en/family");
    const person = page.getByRole("listitem").filter({has: page.getByRole("heading", {name: "Person B", exact: true})});
    await person.locator("summary").filter({hasText: /^Edit Person B$/}).click();
    await expect(person.getByLabel("Who helps on their own device?")).toHaveCount(0);
    await person.locator("summary").filter({hasText: /^Remove Person B$/}).click();
    await person.getByRole("button", {name: "Yes, remove Person B", exact: true}).click();
    await expect(person.getByRole("alert")).toHaveText("The draw has started. Use the exchange's draw controls to change who takes part.");
    await capture(page, info, "active-exchange-removal-guard");
    expect(await open(f.devices[1].page, f.member)).toBe("Person C");
    await page.goto(`${f.manage}?check=1`);
    await expect(page.getByRole("heading", {name: "The sealed draw passes all the rules."})).toBeVisible();
  } finally { await f.close(); }
});

test("a draw avoids households, helper pairs, and keep-apart pairs while a helper can reveal only their dependent", async ({browser}, info) => {
  const f = await fixture(browser, 6);
  try {
    const householdId = randomUUID();
    await f.database.db.insert(households).values({familyId: f.familyId, id: householdId, name: "A and C household"});
    for (const index of [0, 2]) await f.database.db.update(people).set({householdId})
      .where(and(eq(people.familyId, f.familyId), eq(people.id, f.ids[index])));
    await f.database.db.update(people).set({helperId: f.ids[0]})
      .where(and(eq(people.familyId, f.familyId), eq(people.id, f.ids[3])));
    const [personA, personB] = [f.ids[1], f.ids[4]].sort();
    await f.database.db.insert(keepApart).values({familyId: f.familyId, exchangeId: f.exchangeId, personA, personB, reason: "partner"});
    const page = f.devices[0].page;
    await page.goto(f.manage);
    await page.locator("summary").filter({hasText: /^Draw again$/}).click();
    await page.getByRole("button", {name: "Yes, draw names", exact: true}).click();
    await expect(page.getByText("0 of 6 have opened their person.", {exact: true})).toBeVisible();
    const actual = new Map<string, string>();
    for (const index of [0, 1, 2, 4, 5]) actual.set(f.names[index], await open(f.devices[index].page, f.member));
    await page.goto("/en/account");
    await page.getByRole("button", {name: "Help Person D", exact: true}).click();
    actual.set("Person D", await open(page, f.member));
    await capture(page, info, "helper-own-dependent-reveal");
    expect(new Set(actual.values()).size).toBe(6);
    for (const [giver, recipient] of actual) {
      expect(giver).not.toBe(recipient);
      expect(actual.get(recipient)).not.toBe(giver);
      expect([giver, recipient].sort()).not.toEqual(["Person A", "Person C"]);
      expect([giver, recipient].sort()).not.toEqual(["Person A", "Person D"]);
      expect([giver, recipient].sort()).not.toEqual(["Person B", "Person E"]);
    }
    expect(modelOneLoop(actual)).toBe(true);
    await f.devices[3].page.goto(f.member);
    await expect(f.devices[3].page).toHaveURL(/\/en\/sign-in$/);
    await f.devices[1].page.goto(f.manage);
    await expect(f.devices[1].page.getByText("This page could not be found.", {exact: false})).toBeVisible();
    await info.attach("restricted-draw-results", {body: JSON.stringify(Object.fromEntries(actual), null, 2), contentType: "application/json"});
  } finally { await f.close(); }
});

test("a reveal waiting on the family lock rejects a session revoked before the lock is released", async ({browser}, info) => {
  const f = await fixture(browser, 4);
  const blocker = await f.database.db.$client.connect();
  try {
    const page = f.devices[1].page;
    await page.goto(f.member);
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM families WHERE id = $1 FOR UPDATE", [f.familyId]);
    const pending = page.waitForRequest((request) => request.method() === "POST" && request.url().includes(f.exchangeId));
    const clicking = page.getByRole("button", {name: "Open your person", exact: true}).click();
    await pending;
    // A second connection verifies that the real action has reached the shared lock.
    const drawLogin = decodeURIComponent(new URL(process.env.E2E_DRAW_DATABASE_URL ?? process.env.DATABASE_URL!).username);
    await expect.poll(async () => {
      const result = await f.database.db.execute(sql`SELECT count(*)::int AS count FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND usename = ${drawLogin}`);
      return Number(result.rows[0].count);
    }).toBeGreaterThan(0);
    await blocker.query("UPDATE sessions SET revoked_at = now() WHERE family_id = $1 AND id = $2", [f.familyId, f.devices[1].viewer.sessionId]);
    await blocker.query("COMMIT");
    await clicking;
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("You don’t have access to this exchange.");
    await expect(page.getByText(/^You’re giving to /)).toHaveCount(0);
    await capture(page, info, "queued-reveal-rejected-after-revocation");
    const openings = await f.database.db.execute(sql`SELECT count(*)::int AS count FROM draw_openings WHERE family_id = ${f.familyId}`);
    expect(Number(openings.rows[0].count)).toBe(0);
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
    await f.close();
  }
});

test("repair-deadline pages keep sealed data blocked and offer localized recovery while practice still works", async ({browser}, info) => {
  test.setTimeout(60_000);
  const f = await fixture(browser, 20);
  try {
    // A backlog of exposed matches exercises the real repair deadline, without
    // replacing the solver or the application with a stub.
    for (const device of f.devices.slice(1)) await open(device.page, f.member);
    const owner = await f.device(1);
    for (let index = 1; index < 20; index++) {
      const reporter = index === 1 ? owner.viewer : await runForFamily(f.database.db, f.familyId, async (tx) => {
        const session = await createSession(tx, f.familyId, f.ids[index], digest(secret()), "ipad", new Date());
        return {...f.devices[index].viewer, sessionId: session.id};
      });
      expect(await runForFamily(f.database.db, f.familyId, (tx) => disputeSession(
        tx, reporter, f.devices[index].viewer.sessionId, new Date(),
      ))).toBe(true);
    }
    for (const [locale, message, account] of [
      ["en", "The check took too long. Try again or simplify the keep-apart rules.", "My account"],
      ["es", "La revisión tomó demasiado tiempo. Inténtalo de nuevo o simplifica las reglas.", "Mi cuenta"],
    ]) {
      await owner.page.goto(f.member.replace("/en/", `/${locale}/`));
      await expect(owner.page.getByRole("main").getByRole("alert")).toHaveText(message);
      await expect(owner.page.getByRole("link", {name: account, exact: true})).toBeVisible();
      await expect(owner.page.getByRole("button")).toHaveCount(0);
      await capture(owner.page, info, `${locale}-member-repair-recovery`);
      const organizer = f.devices[0].page;
      await organizer.goto(`${f.manage.replace("/en/", `/${locale}/`)}?check=1`);
      await expect(organizer.getByRole("main").getByRole("alert")).toHaveText(message);
      await expect(organizer.getByRole("link", {name: account, exact: true})).toBeVisible();
      await capture(organizer, info, `${locale}-organizer-repair-recovery`);
    }
    const organizer = f.devices[0].page;
    await organizer.goto("/en/exchanges/practice");
    await organizer.getByRole("button", {name: "Start practice", exact: true}).click();
    await organizer.getByRole("button", {name: "Draw names", exact: true}).click();
    await expect(organizer.getByRole("listitem").filter({hasText: / gives to /})).toHaveCount(6);
    await capture(organizer, info, "practice-with-real-repair-deadline");
    const [real] = await f.database.db.select().from(exchanges).where(and(eq(exchanges.familyId, f.familyId), eq(exchanges.id, f.exchangeId)));
    expect(real.drawVersion).toBe(1);
    expect(real.disputedRevealRepairedAt).toBeNull();
  } finally { await f.close(); }
});

test("uses a valid multi-loop fallback when keep-apart rules make one loop impossible", async ({browser}, info) => {
  const f = await fixture(browser, 6);
  try {
    await f.database.db.delete(assignments).where(eq(assignments.familyId, f.familyId));
    await f.database.db.delete(drawRuleSnapshots).where(eq(drawRuleSnapshots.familyId, f.familyId));
    await f.database.db.update(exchanges).set({status: "setup", drawVersion: 0, seal: null})
      .where(and(eq(exchanges.familyId, f.familyId), eq(exchanges.id, f.exchangeId)));
    for (const first of f.ids.slice(0, 3)) for (const second of f.ids.slice(3)) {
      const [personA, personB] = [first, second].sort();
      await f.database.db.insert(keepApart).values({familyId: f.familyId, exchangeId: f.exchangeId, personA, personB, reason: "custom"});
    }
    const page = f.devices[0].page;
    await page.goto(f.manage);
    await page.locator("summary").filter({hasText: /^Draw names$/}).click();
    await page.getByRole("button", {name: "Yes, draw names", exact: true}).click();
    await page.getByRole("link", {name: "Check the sealed draw", exact: true}).click();
    await expect(page.getByRole("heading", {name: "The sealed draw passes all the rules."})).toBeVisible();
    await expect(page.getByText("The draw uses more than one loop.", {exact: true})).toBeVisible();
    await capture(page, info, "valid-multi-loop-fallback");
    const actual = new Map<string, string>();
    for (let index = 0; index < 6; index++) {
      const recipient = await open(f.devices[index].page, f.member);
      expect(f.names.indexOf(recipient) < 3).toBe(index < 3);
      actual.set(f.names[index], recipient);
    }
    expect(new Set(actual.values()).size).toBe(6);
    expect(modelOneLoop(actual)).toBe(false);
    await info.attach("fallback-draw-results", {body: JSON.stringify(Object.fromEntries(actual), null, 2), contentType: "application/json"});
  } finally { await f.close(); }
});
