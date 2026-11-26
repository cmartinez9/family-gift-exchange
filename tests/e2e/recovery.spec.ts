import {execFile} from "node:child_process";
import {randomUUID} from "node:crypto";
import {promisify} from "node:util";
import {devices, expect, test, type Page, type TestInfo} from "@playwright/test";
import {eq} from "drizzle-orm";
import {connectDatabase, runForFamily} from "../../src/server/db/database";
import {families} from "../../src/server/db/schema";
import {openKey, signInWithPin, signOut, skipFaceId, typePin} from "../helpers/pin-pad";

const pin = "4268";
const replacementPin = "6285";

async function createFamily(page: Page) {
  await page.goto("/en/start");
  await page.getByLabel("Organizer invitation code").fill(process.env.E2E_ORGANIZER_INVITE_CODE!);
  await page.getByLabel("Family or exchange name").fill(`Recovery ${randomUUID().slice(0, 6)}`);
  await page.getByLabel("Your name or nickname").fill("Organizer");
  await page.getByLabel("4-digit PIN").fill(pin);
  await page.getByLabel("Type the PIN again").fill(pin);
  await page.getByRole("button", {name: "Create my family"}).click();
  await expect(page.getByRole("heading", {name: "Use Face ID next time?"})).toBeVisible();
  const familyId = (await page.context().cookies()).find(({name}) => name === "__Host-fge-session")!.value.split(".")[0];
  await page.getByRole("link", {name: "Not now"}).click();
  await expect(page.getByRole("heading", {name: "Who's ready"})).toBeVisible();
  return familyId;
}

async function removeFamily(familyId: string) {
  const {db, close} = connectDatabase(process.env.DATABASE_URL!);
  try {
    await runForFamily(db, familyId, (tx) => tx.delete(families).where(eq(families.id, familyId)).execute());
  } finally {
    await close();
  }
}

async function addPerson(page: Page, name: string, helper?: string) {
  await page.locator("summary").filter({hasText: /^Add a person$/}).click();
  const form = page.locator("form").filter({has: page.getByRole("button", {name: "Add a person", exact: true})});
  await form.getByLabel("Name or nickname").fill(name);
  if (helper) await form.getByLabel("Who helps on their own device?").selectOption({label: helper});
  await form.getByRole("button", {name: "Add a person", exact: true}).click();
  await expect(page.getByRole("heading", {name, exact: true})).toBeVisible();
  // The add form remains open after its server action.
  await page.reload();
}

async function prepareKey(page: Page, name: string, reset = false) {
  const row = page.getByRole("listitem").filter({has: page.getByRole("heading", {name, exact: true})});
  if (reset) await row.locator("summary").filter({hasText: /^Reset PIN$/}).click();
  await row.getByRole("button", {name: reset ? "Prepare a new key" : "Prepare message", exact: true}).click();
  const message = row.getByText(reset ? new RegExp(`^Hi ${name}! Here's your private key`) : new RegExp(`^Hi ${name}! This is your private key`));
  await expect(message).toBeVisible();
  return (await message.innerText()).split(" ").at(-1)!;
}

async function redeem(page: Page, url: string, name: string, chosenPin = pin) {
  await openKey(page, url, chosenPin);
  await skipFaceId(page);
  await page.goto("/en/account");
  await expect(page.getByRole("heading", {name, exact: true})).toBeVisible();
}

const login = (page: Page, familyId: string, name: string, chosenPin = pin) => signInWithPin(page, familyId, name, chosenPin);
const wrongPin = (page: Page) => page.getByRole("alert").filter({hasText: "That PIN didn't match"});
const needsKey = (page: Page) => page.getByRole("alert").filter({hasText: "This name needs a new key"});
const signedInAs = (page: Page, name: string) => expect(page.getByRole("heading", {name, exact: true})).toBeVisible();

/** Opens the notice about a phone that signed in as you, and says it wasn't you. */
async function notMe(page: Page, device: RegExp = /signed in as you/) {
  await page.goto("/en/account/notices");
  await page.getByRole("link", {name: device}).first().click();
  await page.getByRole("button", {name: "That wasn't me"}).click();
}

async function capture(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({path, fullPage: true});
  await info.attach(name, {path, contentType: "image/png"});
}

test("co-organizer dispute locks down the family and old PIN stays invalid after key recovery", async ({page, browser, browserName}, info) => {
  test.setTimeout(90_000);
  const familyId = await createFamily(page);
  const device = devices[browserName === "chromium" ? "Pixel 7" : "iPhone 13"];
  const co = await browser.newContext({...device, ignoreHTTPSErrors: true});
  const member = await browser.newContext({...device, ignoreHTTPSErrors: true});
  const intruder = await browser.newContext({...device, ignoreHTTPSErrors: true});
  try {
    for (const name of ["Co-organizer", "Safe member", "Pending member"]) await addPerson(page, name);
    await page.getByRole("link", {name: "Send keys", exact: true}).click();
    const coKey = await prepareKey(page, "Co-organizer");
    const memberKey = await prepareKey(page, "Safe member");
    const pendingKey = await prepareKey(page, "Pending member");
    const coPage = await co.newPage();
    const memberPage = await member.newPage();
    const intruderPage = await intruder.newPage();
    await redeem(coPage, coKey, "Co-organizer");
    await redeem(memberPage, memberKey, "Safe member");
    await page.goto("/en/family");
    const appointment = page.locator("form").filter({has: page.getByRole("combobox", {name: "Co-organizer", exact: true})});
    await appointment.getByRole("combobox").selectOption({label: "Co-organizer"});
    await appointment.getByRole("button", {name: "Save changes"}).click();
    await expect(appointment.getByRole("status")).toHaveText("Saved.");

    await login(intruderPage, familyId, "Co-organizer");
    await signedInAs(intruderPage, "Co-organizer");
    await intruderPage.goto("/en/family/keys");
    const takeoverKey = await prepareKey(intruderPage, "Organizer", true);
    await notMe(coPage);
    await expect(coPage.getByRole("heading", {name: "The exchange is paused for now"})).toBeVisible();
    await capture(coPage, info, "family-lockdown-notice");
    for (const signedIn of [page, memberPage, intruderPage]) {
      await signedIn.goto("/en/account");
      await expect(signedIn).toHaveURL(/\/en\/sign-in$/);
    }
    for (const key of [pendingKey, takeoverKey]) {
      await intruderPage.goto(key);
      await expect(intruderPage.getByRole("heading", {name: "This key doesn't open"})).toBeVisible();
      await expect(intruderPage.getByRole("button", {name: "Yes, it's my phone"})).toHaveCount(0);
    }
    await intruderPage.goto(`/en/sign-in?family=${familyId}&all=1`);
    await intruderPage.getByRole("link", {name: "Co-organizer", exact: true}).click();
    await expect(needsKey(intruderPage)).toBeVisible();
    await expect(intruderPage.getByRole("img", {name: /digits typed/})).toHaveCount(0);
    await login(memberPage, familyId, "Safe member");
    await signedInAs(memberPage, "Safe member");
    await memberPage.goto("/en/account/notices");
    await expect(memberPage.getByText("Everyone was signed out for safety", {exact: true})).toHaveCount(1);
    await capture(memberPage, info, "unaffected-member-recovery");

    const {stdout} = await promisify(execFile)("pnpm", ["--silent", "admin:organizer-key", familyId], {
      env: {...process.env, DATABASE_ADMIN_URL: process.env.DATABASE_URL, AUTH_SECRET: process.env.E2E_AUTH_SECRET, AUTH_ORIGIN: new URL(page.url()).origin},
    });
    await redeem(page, JSON.parse(stdout).url, "Organizer", replacementPin);
    await page.goto("/en/family/keys");
    const replacement = await prepareKey(page, "Co-organizer", true);
    await redeem(coPage, replacement, "Co-organizer", replacementPin);
    await expect(coPage.getByRole("link", {name: "Manage my family"})).toBeVisible();
    await capture(coPage, info, "co-organizer-recovered");
    await login(intruderPage, familyId, "Co-organizer", pin);
    await expect(wrongPin(intruderPage)).toBeVisible();
    await signOut(coPage);
    await login(coPage, familyId, "Co-organizer", replacementPin);
    await signedInAs(coPage, "Co-organizer");
    // Recovery on the trusted phone must not make the compromised PIN usable again.
    await login(intruderPage, familyId, "Co-organizer", pin);
    await expect(wrongPin(intruderPage)).toBeVisible();
    await capture(intruderPage, info, "old-pin-rejected-after-recovery");
  } finally {
    await Promise.allSettled([co.close(), member.close(), intruder.close()]);
    await removeFamily(familyId);
  }
});

test("five wrong PIN guesses lock the name, notify its owner, and permit organizer key recovery", async ({page, browser, browserName}, info) => {
  const familyId = await createFamily(page);
  const device = devices[browserName === "chromium" ? "Pixel 7" : "iPhone 13"];
  const owner = await browser.newContext({...device, ignoreHTTPSErrors: true});
  const stranger = await browser.newContext({...device, ignoreHTTPSErrors: true});
  try {
    await addPerson(page, "Rosa");
    await page.getByRole("link", {name: "Send keys"}).click();
    const key = await prepareKey(page, "Rosa");
    const ownerPage = await owner.newPage();
    const strangerPage = await stranger.newPage();
    await strangerPage.goto(`/en/sign-in?family=${familyId}`);
    await expect(strangerPage.getByRole("link", {name: "Rosa", exact: true})).toHaveCount(0);
    await redeem(ownerPage, key, "Rosa");
    for (let guess = 0; guess < 5; guess++) {
      await login(strangerPage, familyId, "Rosa", "6544");
      if (guess < 4) await expect(wrongPin(strangerPage)).toBeVisible();
      else await expect(strangerPage.getByRole("heading", {name: "Let's take a break"})).toBeVisible();
    }
    await capture(strangerPage, info, "pin-guessing-locked");
    await login(strangerPage, familyId, "Rosa", pin);
    await expect(strangerPage.getByRole("heading", {name: "Let's take a break"})).toBeVisible();
    await ownerPage.goto("/en/account/notices");
    await expect(ownerPage.getByText("Too many wrong PINs", {exact: true})).toBeVisible();
    await capture(ownerPage, info, "owner-lockout-activity");
    await strangerPage.getByRole("button", {name: "Ask Organizer for a new PIN"}).click();
    await expect(strangerPage.getByRole("main").getByRole("status")).toContainText("Organizer has been asked");
    await page.reload();
    const replacement = await prepareKey(page, "Rosa", true);
    await redeem(strangerPage, replacement, "Rosa", replacementPin);
    await ownerPage.reload();
    await expect(ownerPage).toHaveURL(/\/en\/sign-in$/);
    await login(ownerPage, familyId, "Rosa", pin);
    await expect(wrongPin(ownerPage)).toBeVisible();
  } finally {
    await Promise.allSettled([owner.close(), stranger.close()]);
    await removeFamily(familyId);
  }
});

test("assigned helper manages a person without a phone and cannot use organizer controls while helping", async ({page}, info) => {
  const familyId = await createFamily(page);
  try {
    await addPerson(page, "Grandma", "Organizer");
    await expect(page.getByText("Looked after by Organizer")).toBeVisible();
    await page.getByRole("link", {name: "Send keys"}).click();
    await expect(page.getByRole("heading", {name: "Grandma", exact: true})).toHaveCount(0);
    await page.goto("/en/account");
    await page.getByRole("button", {name: "Help Grandma", exact: true}).click();
    // With no person to open yet, helping starts on Grandma's list, under the helping banner.
    await expect(page).toHaveURL(/\/en\/lists\/[0-9a-f-]+$/);
    await expect(page.getByRole("region", {name: "Helping mode"})).toContainText("You're helping Grandma");
    await page.goto("/en/account");
    await expect(page.getByRole("region", {name: "Helping mode"})).toContainText("You're helping Grandma");
    await expect(page.getByRole("link", {name: "Manage my family"})).toHaveCount(0);
    await capture(page, info, "helper-profile");
    await page.goto("/en/family/keys");
    await expect(page.getByRole("button", {name: "Prepare message"})).toHaveCount(0);
    await page.goto("/en/account");
    await page.getByRole("button", {name: "Back to me"}).click();
    await expect(page.getByRole("link", {name: "Manage my family"})).toBeVisible();
  } finally {
    await removeFamily(familyId);
  }
});

test("editing a pending printed-code preview cannot redeem another name, including after slow PIN entry", async ({page, browser, browserName}, info) => {
  test.skip(browserName !== "chromium", "Network latency control uses Chromium CDP");
  const waitMs = Number(process.env.E2E_PREVIEW_WAIT_MS ?? 0);
  test.setTimeout(45_000 + waitMs);
  const familyId = await createFamily(page);
  const guest = await browser.newContext({...devices["Pixel 7"], ignoreHTTPSErrors: true});
  try {
    for (const name of ["First", "Second"]) await addPerson(page, name);
    await page.getByRole("link", {name: "Send keys"}).click();
    const first = page.getByRole("listitem").filter({has: page.getByRole("heading", {name: "First", exact: true})});
    await first.getByRole("button", {name: "Prepare a key card"}).click();
    await expect(first.getByRole("img", {name: "Scan to open your private key"})).toBeVisible();
    const firstCode = (await first.getByText(/^Your key code is/).innerText()).match(/\b[A-Z2-9]{6}\b/)![0];
    const firstUrl = (await first.getByText(/^Hi First!/).innerText()).split(" ").at(-1)!;
    const card = info.outputPath("printed-qr-card.png");
    await first.screenshot({path: card});
    await info.attach("printed-qr-card", {path: card, contentType: "image/png"});
    await prepareKey(page, "Second");
    const second = page.getByRole("listitem").filter({has: page.getByRole("heading", {name: "Second", exact: true})});
    const secondCode = (await second.getByText(/^Your key code is/).innerText()).match(/\b[A-Z2-9]{6}\b/)![0];
    const guestPage = await guest.newPage();
    await guestPage.goto(`/en/sign-in?family=${familyId}&join=1`);
    const cdp = await guest.newCDPSession(guestPage);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {offline: false, latency: 1500, downloadThroughput: -1, uploadThroughput: -1});
    await guestPage.getByLabel("6-character key code").fill(firstCode);
    await guestPage.getByRole("button", {name: "Continue with my code"}).click();
    await guestPage.getByLabel("6-character key code").fill(secondCode);
    await expect(guestPage.getByRole("button", {name: "Continue with my code"})).toBeEnabled({timeout: 15_000});
    await expect(guestPage.getByRole("button", {name: "No, I'm helping First"})).toHaveCount(0);
    await cdp.send("Network.emulateNetworkConditions", {offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1});
    await guestPage.getByRole("button", {name: "Continue with my code"}).click();
    await expect(guestPage.getByRole("button", {name: "No, I'm helping Second"})).toBeVisible();
    await guestPage.getByRole("button", {name: "Yes, it's my phone"}).click();
    await typePin(guestPage, pin);
    await expect(guestPage.getByRole("heading", {name: "Type it once more"})).toBeVisible();
    await capture(guestPage, info, "preview-bound-to-second-person");
    const previewAt = Date.now();
    if (waitMs > 0) await guestPage.waitForTimeout(waitMs);
    await typePin(guestPage, pin);
    await expect(guestPage.getByRole("heading", {name: "Use Face ID next time?"})).toBeVisible();
    await skipFaceId(guestPage);
    await guestPage.goto("/en/account");
    await signedInAs(guestPage, "Second");
    await capture(guestPage, info, "slow-preview-redeemed-second-person");
    await info.attach("preview-elapsed", {body: JSON.stringify({minimumWaitMs: waitMs, actualElapsedMs: Date.now() - previewAt}), contentType: "application/json"});
    await signOut(guestPage);
    // The discarded preview must not consume First's personal key.
    await redeem(guestPage, firstUrl, "First");
  } finally {
    await guest.close();
    await removeFamily(familyId);
  }
});

for (const chain of ["unredeemed key", "PIN successor", "new co-organizer appointment"] as const) {
  test(`organizer dispute blocks takeover through ${chain} and the operator restores access`, async ({page, browser, browserName}, info) => {
    test.setTimeout(90_000);
    const familyId = await createFamily(page);
    const device = devices[browserName === "chromium" ? "Pixel 7" : "iPhone 13"];
    const co = await browser.newContext({...device, ignoreHTTPSErrors: true});
    const safe = await browser.newContext({...device, ignoreHTTPSErrors: true});
    const intruder = await browser.newContext({...device, ignoreHTTPSErrors: true});
    const successor = await browser.newContext({...device, ignoreHTTPSErrors: true});
    try {
      await addPerson(page, "Delegate");
      await addPerson(page, "Safe member");
      await page.getByRole("link", {name: "Send keys"}).click();
      const coKey = await prepareKey(page, "Delegate");
      const safeKey = await prepareKey(page, "Safe member");
      const coPage = await co.newPage();
      const safePage = await safe.newPage();
      const intruderPage = await intruder.newPage();
      const successorPage = await successor.newPage();
      await redeem(coPage, coKey, "Delegate");
      await redeem(safePage, safeKey, "Safe member");
      async function appoint(actor: Page) {
        await actor.goto("/en/family");
        const form = actor.locator("form").filter({has: actor.getByRole("combobox", {name: "Co-organizer", exact: true})});
        await form.getByRole("combobox").selectOption({label: "Delegate"});
        await form.getByRole("button", {name: "Save changes"}).click();
        await expect(form.getByRole("status")).toHaveText("Saved.");
      }
      if (chain !== "new co-organizer appointment") await appoint(page);
      await login(intruderPage, familyId, "Organizer");
      await signedInAs(intruderPage, "Organizer");
      let takeoverKey: string;
      if (chain === "new co-organizer appointment") {
        await appoint(intruderPage);
        await coPage.goto("/en/family/keys");
        takeoverKey = await prepareKey(coPage, "Organizer", true);
      } else {
        await intruderPage.goto("/en/family/keys");
        takeoverKey = await prepareKey(intruderPage, "Delegate", true);
        if (chain === "PIN successor") {
          await redeem(successorPage, takeoverKey, "Delegate", replacementPin);
          await signOut(successorPage);
          await login(successorPage, familyId, "Delegate", replacementPin);
          await signedInAs(successorPage, "Delegate");
          await successorPage.goto("/en/family/keys");
          takeoverKey = await prepareKey(successorPage, "Organizer", true);
        }
      }
      await notMe(page);
      await expect(page.getByRole("heading", {name: "The exchange is paused for now"})).toBeVisible();
      await capture(page, info, "organizer-lockdown");
      for (const other of [coPage, safePage, intruderPage, successorPage]) {
        await other.goto("/en/account");
        await expect(other).toHaveURL(/\/en\/sign-in$/);
      }
      await intruderPage.goto(takeoverKey);
      await expect(intruderPage.getByRole("heading", {name: "This key doesn't open"})).toBeVisible();
      await intruderPage.goto(`/en/sign-in?family=${familyId}&all=1`);
      await intruderPage.getByRole("link", {name: "Organizer", exact: true}).click();
      await expect(needsKey(intruderPage)).toBeVisible();
      await login(safePage, familyId, "Safe member");
      await signedInAs(safePage, "Safe member");
      if (chain === "new co-organizer appointment") {
        await login(coPage, familyId, "Delegate");
        await signedInAs(coPage, "Delegate");
        await expect(coPage.getByRole("link", {name: "Manage my family"})).toHaveCount(0);
        await capture(coPage, info, "malicious-appointment-revoked");
      } else if (chain === "PIN successor") {
        await successorPage.goto(`/en/sign-in?family=${familyId}&all=1`);
        await successorPage.getByRole("link", {name: "Delegate", exact: true}).click();
        await expect(needsKey(successorPage)).toBeVisible();
      }
      const {stdout} = await promisify(execFile)("pnpm", ["--silent", "admin:organizer-key", familyId], {
        env: {...process.env, DATABASE_ADMIN_URL: process.env.DATABASE_URL, AUTH_SECRET: process.env.E2E_AUTH_SECRET, AUTH_ORIGIN: new URL(page.url()).origin},
      });
      await redeem(page, JSON.parse(stdout).url, "Organizer", replacementPin);
      await expect(page.getByRole("link", {name: "Manage my family"})).toBeVisible();
      await capture(page, info, "operator-restored-organizer");
      await login(intruderPage, familyId, "Organizer", pin);
      await expect(wrongPin(intruderPage)).toBeVisible();
    } finally {
      await Promise.allSettled([co.close(), safe.close(), intruder.close(), successor.close()]);
      await removeFamily(familyId);
    }
  });
}

test("member dispute revokes the authenticating passkey and later PIN sessions while an unrelated older passkey still works", async ({page, browser, browserName}, info) => {
  test.skip(browserName !== "chromium", "Virtual platform authenticators use Chromium CDP");
  test.setTimeout(60_000);
  const familyId = await createFamily(page);
  const original = await browser.newContext({...devices["Pixel 7"], ignoreHTTPSErrors: true});
  const reported = await browser.newContext({...devices["iPhone 13"], ignoreHTTPSErrors: true});
  const successor = await browser.newContext({...devices["Pixel 7"], ignoreHTTPSErrors: true});
  try {
    await addPerson(page, "Rosa");
    await page.getByRole("link", {name: "Send keys"}).click();
    const key = await prepareKey(page, "Rosa");
    const originalPage = await original.newPage();
    const reportedPage = await reported.newPage();
    const successorPage = await successor.newPage();
    async function authenticator(on: Page) {
      const cdp = await on.context().newCDPSession(on);
      await cdp.send("WebAuthn.enable");
      const {authenticatorId} = await cdp.send("WebAuthn.addVirtualAuthenticator", {options: {
        protocol: "ctap2", transport: "internal", hasResidentKey: true,
        hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
      }});
      return {cdp, authenticatorId};
    }
    const a = await authenticator(originalPage);
    await redeem(originalPage, key, "Rosa");
    await originalPage.goto("/en/face-id");
    await originalPage.getByRole("button", {name: "Yes, use Face ID", exact: true}).click();
    await signedInAs(originalPage, "Rosa");
    const first = (await a.cdp.send("WebAuthn.getCredentials", {authenticatorId: a.authenticatorId})).credentials[0];
    await originalPage.goto("/en/face-id");
    await originalPage.getByRole("button", {name: "Yes, use Face ID", exact: true}).click();
    await signedInAs(originalPage, "Rosa");
    const second = (await a.cdp.send("WebAuthn.getCredentials", {authenticatorId: a.authenticatorId})).credentials.find((c) => c.credentialId !== first.credentialId)!;
    await a.cdp.send("WebAuthn.removeCredential", {authenticatorId: a.authenticatorId, credentialId: second.credentialId});
    // A resident authenticator replaces the earlier credential for the same user; restore it for this login.
    await a.cdp.send("WebAuthn.addCredential", {authenticatorId: a.authenticatorId, credential: first});
    // Establish an earlier login with the same passkey on its enrollment browser.
    await signOut(originalPage);
    await originalPage.getByRole("button", {name: "Sign in with Face ID"}).click();
    await signedInAs(originalPage, "Rosa");
    for (const [index, on] of [reportedPage, successorPage].entries()) {
      const target = await authenticator(on);
      await target.cdp.send("WebAuthn.addCredential", {authenticatorId: target.authenticatorId, credential: {...first, signCount: 100 * (index + 1)}});
      await on.goto("/en");
      await on.getByRole("button", {name: "Sign in with Face ID"}).click();
      await signedInAs(on, "Rosa");
    }
    await signOut(successorPage);
    await login(successorPage, familyId, "Rosa");
    await signedInAs(successorPage, "Rosa");
    // Identify the reported remote phone separately from the earlier enrollment browser.
    await notMe(originalPage, /An iPhone signed in as you/);
    await expect(originalPage.getByRole("main").getByRole("status")).toContainText("was signed out");
    for (const on of [reportedPage, successorPage]) {
      await on.reload();
      await expect(on).toHaveURL(/\/en\/sign-in$/);
      await on.getByRole("button", {name: "Sign in with Face ID"}).click();
      await expect(on.locator("p[role=alert]")).toHaveText("Face ID didn't sign you in. Try again or use your name and PIN.");
    }
    await capture(reportedPage, info, "implicated-passkey-rejected");
    await a.cdp.send("WebAuthn.removeCredential", {authenticatorId: a.authenticatorId, credentialId: first.credentialId});
    await a.cdp.send("WebAuthn.addCredential", {authenticatorId: a.authenticatorId, credential: second});
    await signOut(originalPage);
    await originalPage.getByRole("button", {name: "Sign in with Face ID"}).click();
    await signedInAs(originalPage, "Rosa");
    await capture(originalPage, info, "unrelated-older-passkey-preserved");
  } finally {
    await Promise.allSettled([original.close(), reported.close(), successor.close()]);
    await removeFamily(familyId);
  }
});

test("family creation rejects an invalid organizer invitation before creating a session", async ({page}, info) => {
  await page.goto("/en/start");
  await page.getByLabel("Organizer invitation code").fill("not-an-owner-invitation");
  await page.getByLabel("Family or exchange name").fill("Invitation guard");
  await page.getByLabel("Your name or nickname").fill("Organizer");
  await page.getByLabel("4-digit PIN").fill(pin);
  await page.getByLabel("Type the PIN again").fill(pin);
  await page.getByRole("button", {name: "Create my family"}).click();
  await expect(page.locator("p[role=alert]")).toHaveText("That organizer invitation code didn't match.");
  expect((await page.context().cookies()).some(({name}) => name === "__Host-fge-session")).toBe(false);
  await capture(page, info, "invalid-organizer-invitation");
  const familyId = await createFamily(page);
  await removeFamily(familyId);
});

test("PIN sign-in keeps both return links inside the phone viewport", async ({page}, info) => {
  const familyId = await createFamily(page);
  try {
    await signOut(page);
    await login(page, familyId, "Organizer", "6544");
    await expect(wrongPin(page)).toBeVisible();
    await capture(page, info, "phone-pin-signin-layout");
    const dimensions = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      contentWidth: document.documentElement.scrollWidth,
      links: [...document.querySelectorAll("main a")].map((link) => ({text: link.textContent, right: link.getBoundingClientRect().right})),
    }));
    await info.attach("phone-layout-dimensions", {body: JSON.stringify(dimensions, null, 2), contentType: "application/json"});
    expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
  } finally {
    await removeFamily(familyId);
  }
});
