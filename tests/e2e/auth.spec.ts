import {createECDH, randomBytes, randomUUID} from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {devices, expect, test, type Page} from "@playwright/test";
import {eq} from "drizzle-orm";
import {connectDatabase, runForFamily} from "../../src/server/db/database";
import {families} from "../../src/server/db/schema";
import {pushSubscriptions} from "../../src/server/messages/schema";
import {settled, signInWithPin, signOut, typePin} from "../helpers/pin-pad";

const pin = "4268";

async function startFamily(page: Page, familyName: string) {
  await page.goto("/en/start");
  await page.getByLabel("Organizer invitation code").fill(process.env.E2E_ORGANIZER_INVITE_CODE!);
  await page.getByLabel("Family or exchange name").fill(familyName);
  await page.getByLabel("Your name or nickname").fill("Northstar");
  await page.getByLabel("4-digit PIN").fill(pin);
  await page.getByLabel("Type the PIN again").fill(pin);
  await page.getByRole("button", {name: "Create my family"}).click();
  await expect(page.getByRole("heading", {name: "Use Face ID next time?"})).toBeVisible();
  const session = (await page.context().cookies()).find(({name}) => name === "__Host-fge-session");
  expect(session).toMatchObject({httpOnly: true, secure: true, sameSite: "Lax"});
  return session!.value.split(".")[0];
}

async function removeFamily(familyId: string) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for browser auth tests");
  const {db, close} = connectDatabase(databaseUrl);
  try {
    await runForFamily(db, familyId, (tx) => tx.delete(families).where(eq(families.id, familyId)).execute());
  } finally {
    await close();
  }
}


test("sets up the family, joins by key, switches devices, disputes a session and signs out everywhere", async ({page, browser, browserName}) => {
  const familyName = `Frostfall ${randomUUID().slice(0, 6)}`;
  const familyId = await startFamily(page, familyName);
  const device = devices[browserName === "chromium" ? "Pixel 7" : "iPhone 13"];
  const member = await browser.newContext({...device, ignoreHTTPSErrors: true});
  const other = await browser.newContext({...device, ignoreHTTPSErrors: true});
  try {
    await page.getByRole("link", {name: "Not now"}).click();
    await expect(page.getByRole("heading", {name: familyName})).toBeVisible();
    await page.locator("summary").filter({hasText: /^Add a person$/}).click();
    await page.getByRole("textbox", {name: "Name or nickname"}).fill("Snowbit");
    await page.getByRole("button", {name: "Add a person"}).click();
    await expect(page.getByRole("heading", {name: "Snowbit"})).toBeVisible();

    await page.getByRole("link", {name: "Send keys"}).click();
    await page.getByRole("button", {name: "Prepare message"}).click();
    const message = page.getByText("Hi Snowbit! This is your private key", {exact: false});
    await expect(message).toBeVisible();
    const url = (await message.innerText()).split(" ").at(-1)!;
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("button", {name: "Mark as sent"}).click();
    await expect(page.getByText("Marked as sent.", {exact: true})).toBeVisible();
    await page.goto(url);
    await expect(page.getByRole("heading", {name: "This key is Snowbit's"})).toBeVisible();
    await expect(page.getByText("This phone is signed in as Northstar, so it can't open Snowbit's key. Nothing was changed.")).toBeVisible();

    const memberPage = await member.newPage();
    await memberPage.goto(url);
    await memberPage.getByRole("button", {name: "No, I'm helping Snowbit"}).click();
    await expect(memberPage.getByRole("img", {name: /digits typed/})).toHaveCount(0);
    await memberPage.getByRole("button", {name: "Go back"}).click();
    await memberPage.getByRole("button", {name: "Yes, it's my phone"}).click();
    await typePin(memberPage, "1962");
    await expect(memberPage.getByRole("alert").filter({hasText: "1962 looks like a year"})).toBeVisible();
    await typePin(memberPage, pin);
    await expect(memberPage.getByRole("heading", {name: "Type it once more"})).toBeVisible();
    await typePin(memberPage, pin);
    await expect(memberPage.getByRole("heading", {name: "Use Face ID next time?"})).toBeVisible();
    await memberPage.getByRole("link", {name: "Not now"}).click();
    await expect(memberPage.getByRole("heading", {name: "Your sizes"})).toBeVisible();
    await memberPage.goto("/en/account/notices");
    await expect(memberPage.getByText(/^Your key was opened on/)).toBeVisible();
    await expect(memberPage).toHaveTitle(/Family Gift Exchange$/);
    await settled(memberPage);
    expect((await new AxeBuilder({page: memberPage}).analyze()).violations).toEqual([]);

    const otherPage = await other.newPage();
    await otherPage.goto(url);
    await expect(otherPage.getByRole("heading", {name: "This key was already opened"})).toBeVisible();
    await signInWithPin(otherPage, familyId, "Snowbit", pin);
    await expect(otherPage.getByRole("heading", {name: "Snowbit", exact: true})).toBeVisible();
    await memberPage.reload();
    await memberPage.getByRole("link", {name: /signed in as you/}).click();
    await memberPage.getByRole("button", {name: "That wasn't me"}).click();
    await expect(memberPage.getByRole("status").filter({hasText: "was signed out"})).toBeVisible();
    await otherPage.reload();
    await expect(otherPage).toHaveURL(/\/en\/sign-in$/);

    // A known device can unlock new-device PIN sign-in after a dispute.
    await signOut(memberPage);
    await signInWithPin(memberPage, familyId, "Snowbit", pin);
    await expect(memberPage.getByRole("heading", {name: "Snowbit", exact: true})).toBeVisible();
    await signInWithPin(otherPage, familyId, "Snowbit", pin);
    await expect(otherPage.getByRole("heading", {name: "Snowbit", exact: true})).toBeVisible();
    await memberPage.goto("/en/account/phones");
    await memberPage.getByRole("button", {name: "Sign out everywhere"}).click();
    await memberPage.getByRole("dialog").getByRole("button", {name: "Sign out everywhere"}).click();
    await expect(memberPage).toHaveURL(/\/en\/sign-in$/);
    await otherPage.reload();
    await expect(otherPage).toHaveURL(/\/en\/sign-in$/);
  } finally {
    await member.close();
    await other.close();
    await removeFamily(familyId);
  }
});

test("registers a discoverable credential and signs in from the bare app address", async ({page, browserName}) => {
  test.skip(browserName !== "chromium", "Chromium provides a virtual platform authenticator");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2", transport: "internal", hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
    },
  });
  const familyId = await startFamily(page, `Icicle ${randomUUID().slice(0, 6)}`);
  try {
    await page.getByRole("button", {name: "Yes, use Face ID"}).click();
    await expect(page.getByRole("heading", {name: "Who's ready"})).toBeVisible();
    await page.context().clearCookies();
    await page.goto("/en");
    await page.getByRole("button", {name: "Sign in with Face ID"}).click();
    await expect(page.getByRole("heading", {name: "Northstar", exact: true})).toBeVisible();
    await page.getByRole("link", {name: "Choose 4 new digits"}).click();
    await typePin(page, "6285");
    await expect(page.getByRole("heading", {name: "Type it once more"})).toBeVisible();
    await typePin(page, "6285");
    await expect(page.getByRole("status").filter({hasText: "Your new PIN is ready."})).toBeVisible();
  } finally {
    await cdp.detach();
    await removeFamily(familyId);
  }
});

test("a Spanish member requests a PIN reset and the organizer reads it and shares a family message", async ({page, browser, browserName}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {value: {
      writeText: async (text: string) => { sessionStorage.setItem("notification-copy", text); },
    }});
    Object.defineProperty(navigator, "share", {value: async ({text}: ShareData) => {
      sessionStorage.setItem("notification-share", text ?? "");
    }});
  });
  const familyId = await startFamily(page, `Pines ${randomUUID().slice(0, 6)}`);
  const device = devices[browserName === "chromium" ? "Pixel 7" : "iPhone 13"];
  const guest = await browser.newContext({...device, ignoreHTTPSErrors: true, locale: "es-US"});
  try {
    await page.getByRole("link", {name: "Not now"}).click();
    await page.locator("summary").filter({hasText: /^Add a person$/}).click();
    await page.getByRole("textbox", {name: "Name or nickname"}).fill("Pino");
    const add = page.locator("details[open]").filter({has: page.getByRole("button", {name: "Add a person"})});
    await add.getByRole("combobox", {name: "Language"}).selectOption("es");
    await add.getByRole("button", {name: "Add a person"}).click();
    await expect(page.getByRole("heading", {name: "Pino"})).toBeVisible();
    await page.getByRole("link", {name: "Send keys"}).click();
    await page.getByRole("button", {name: "Prepare a key card"}).click();
    await expect(page.getByRole("img", {name: "Scan to open your private key"})).toBeVisible();
    const message = page.getByText(/^¡Hola, Pino!/);
    await expect(message).toBeVisible();
    const code = (await page.getByText(/^Your key code is/).innerText()).match(/\b[A-Z2-9]{6}\b/)![0];
    const address = await page.getByLabel("Family sign-in address").inputValue();
    const signIn = new URL(address);
    signIn.pathname = "/es/sign-in";
    const guestPage = await guest.newPage();
    await guestPage.goto(signIn.href);
    await guestPage.getByRole("link", {name: "¿Otra persona? Usa tu propia llave"}).click();
    await guestPage.getByLabel("Código de 6 caracteres").fill(code);
    await guestPage.getByRole("button", {name: "Continuar con mi código"}).click();
    await guestPage.getByRole("button", {name: "Sí, es mi teléfono"}).click();
    await typePin(guestPage, pin);
    await expect(guestPage.getByRole("heading", {name: "Escríbelo otra vez"})).toBeVisible();
    await typePin(guestPage, pin);
    await guestPage.getByRole("link", {name: "Ahora no"}).click();
    await expect(guestPage.getByRole("heading", {name: "Tus tallas"})).toBeVisible();
    expect((await guestPage.goto("/es/family/group-chat"))?.status()).toBe(404);
    await guestPage.goto("/es/account");
    await expect(guestPage.getByRole("heading", {name: "Pino", exact: true})).toBeVisible();
    await signOut(guestPage, "es");
    // this phone has only been Pino: welcome back, then the PIN
    await guestPage.getByRole("link", {name: "Usar mi PIN"}).click();
    await guestPage.getByRole("button", {name: "¿Lo olvidaste?"}).click();
    await guestPage.getByRole("button", {name: "Pedirle una llave nueva a Northstar"}).click();
    await expect(guestPage.getByRole("status").filter({hasText: "Ya le avisamos a Northstar"})).toBeVisible();
    await page.getByRole("link", {name: "Go back"}).click();
    const row = page.getByRole("listitem").filter({has: page.getByRole("heading", {name: "Pino"})});
    await expect(row.getByText(/Asked for a new key on/)).toBeVisible();
    await page.getByRole("link", {name: "Notifications (1 unread)"}).click();
    await expect(page.getByText("Pino asked for a PIN reset.")).toBeVisible();
    await page.screenshot({path: test.info().outputPath("pin-reset-inbox.png"), fullPage: true});
    expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
    await page.getByRole("button", {name: "Mark as read"}).click();
    await expect(page.getByRole("button", {name: "Mark as read"})).toHaveCount(0);
    await expect(page.locator('[data-notice="read"]')).toHaveCount(1);
    await page.getByRole("link", {name: "View PIN reset requests"}).click();
    await expect(page.getByRole("link", {name: "Notifications", exact: true})).toBeVisible();

    await page.getByRole("link", {name: "Messages for the family chat"}).click();
    await expect(page.getByRole("region", {name: "Wishlist reminder"})).toBeVisible();
    await page.getByText("The draw", {exact: true}).click();
    const draw = page.getByRole("region", {name: "Names are drawn!"});
    await draw.getByRole("button", {name: "Copy message"}).click();
    await expect(page.getByRole("status").filter({hasText: "Message copied."})).toBeVisible();
    const copied = await page.evaluate(() => sessionStorage.getItem("notification-copy"));
    const chatAddress = new URL(address);
    chatAddress.pathname = "/en/sign-in";
    expect(copied).toContain(chatAddress.href);
    expect(copied).not.toContain(code);
    await page.getByRole("button", {name: "Share to the group chat", exact: true}).click();
    expect(await page.evaluate(() => sessionStorage.getItem("notification-share"))).toBe(copied);
    const whatsapp = new URL((await page.getByRole("link", {name: "Share on WhatsApp"}).getAttribute("href"))!);
    expect(whatsapp.origin).toBe("https://wa.me");
    expect(whatsapp.searchParams.get("text")).toBe(copied);
    expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);

    await page.goto("/es/family/group-chat");
    await expect(page.getByRole("heading", {name: "Avísale a la familia"})).toBeVisible();
    await page.screenshot({path: test.info().outputPath("family-chat-message-es.png"), fullPage: true});
  } finally {
    await guest.close();
    await removeFamily(familyId);
  }
});

test("asks for device notification permission only after a tap and saves or removes the session subscription", async ({page}) => {
  const ecdh = createECDH("prime256v1");
  const endpoint = `https://fcm.googleapis.com/fcm/send/test-${randomUUID()}`;
  await page.addInitScript((subscription) => {
    let current: object | null = null;
    const browserSubscription = {
      toJSON: () => subscription,
      unsubscribe: async () => { current = null; return true; },
    };
    const worker = {pushManager: {
      getSubscription: async () => current,
      subscribe: async () => { current = browserSubscription; return current; },
    }};
    Object.defineProperty(navigator, "serviceWorker", {value: {
      register: async () => worker,
      getRegistration: async () => worker,
      ready: Promise.resolve(worker),
    }});
    Object.defineProperty(window, "PushManager", {value: class {}});
    Object.defineProperty(window, "Notification", {value: {
      requestPermission: async () => {
        sessionStorage.setItem("test-notification-permission", "asked");
        return "granted";
      },
    }});
  }, {endpoint, keys: {p256dh: ecdh.generateKeys().toString("base64url"), auth: randomBytes(16).toString("base64url")}});

  const familyId = await startFamily(page, `Push ${randomUUID().slice(0, 6)}`);
  const {db, close} = connectDatabase(process.env.DATABASE_URL!);
  try {
    await page.goto("/en/notifications");
    const deviceControls = page.getByRole("region", {name: "Home-screen notifications", exact: true});
    const enable = page.getByRole("button", {name: "Turn on notifications for this device"});
    await expect(enable).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem("test-notification-permission"))).toBeNull();
    await enable.click();
    await expect(deviceControls.getByRole("status")).toHaveText("Notifications are on for this device.");
    expect(await page.evaluate(() => sessionStorage.getItem("test-notification-permission"))).toBe("asked");
    const sessionId = (await page.context().cookies()).find(({name}) => name === "__Host-fge-session")!.value.split(".")[1];
    const subscriptions = () => runForFamily(db, familyId, (tx) => tx.select().from(pushSubscriptions));
    expect(await subscriptions()).toMatchObject([{endpoint, sessionId}]);

    await page.getByRole("button", {name: "Turn off notifications for this device"}).click();
    await expect(deviceControls.getByRole("status")).toHaveText("Notifications are off for this device.");
    expect(await subscriptions()).toEqual([]);
  } finally {
    await close();
    await removeFamily(familyId);
  }
});
