import {createECDH, randomBytes, randomUUID} from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {devices, expect, test, type Page} from "@playwright/test";
import {eq} from "drizzle-orm";
import {connectDatabase, runForFamily} from "../../src/server/db/database";
import {families} from "../../src/server/db/schema";
import {pushSubscriptions} from "../../src/server/messages/schema";

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

async function enterPin(page: Page, name: string, value: string) {
  await page.getByRole("link", {name, exact: true}).click();
  await page.getByLabel("4-digit PIN").fill(value);
  await page.getByRole("button", {name: "Sign in", exact: true}).click();
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
    const address = await page.getByLabel("Family sign-in address").inputValue();
    await page.getByRole("button", {name: "Prepare message"}).click();
    const message = page.getByText("Hi Snowbit! This is your private key", {exact: false});
    await expect(message).toBeVisible();
    const url = (await message.innerText()).split(" ").at(-1)!;
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("button", {name: "Mark as sent"}).click();
    await expect(page.getByText("Marked as sent.", {exact: true})).toBeVisible();
    await page.goto(url);
    await expect(page.getByText("This link is for Snowbit. This phone is signed in as Northstar.")).toBeVisible();

    const memberPage = await member.newPage();
    await memberPage.goto(url);
    await memberPage.getByRole("button", {name: "I'm helping Snowbit"}).click();
    await expect(memberPage.getByLabel("4-digit PIN")).toHaveCount(0);
    await memberPage.getByRole("button", {name: "Go back"}).click();
    await memberPage.getByRole("button", {name: "Yes, I'm Snowbit"}).click();
    await memberPage.getByLabel("4-digit PIN").fill("1962");
    await memberPage.getByLabel("Type the PIN again").fill("1962");
    await memberPage.getByRole("button", {name: "Save PIN"}).click();
    await expect(memberPage.getByRole("alert").filter({hasText: "looks like a date or year"})).toBeVisible();
    await memberPage.getByLabel("4-digit PIN").fill(pin);
    await memberPage.getByLabel("Type the PIN again").fill(pin);
    await memberPage.getByRole("button", {name: "Save PIN"}).click();
    await expect(memberPage.getByRole("heading", {name: "Use Face ID next time?"})).toBeVisible();
    await memberPage.getByRole("link", {name: "Not now"}).click();
    await expect(memberPage.getByText("Your key was used.")).toBeVisible();
    await expect(memberPage).toHaveTitle("Family Gift Exchange");
    expect((await new AxeBuilder({page: memberPage}).analyze()).violations).toEqual([]);

    const otherPage = await other.newPage();
    await otherPage.goto(url);
    await expect(otherPage.getByText(/This key was used on/)).toBeVisible();
    await otherPage.goto(address);
    await enterPin(otherPage, "Snowbit", pin);
    await expect(otherPage.getByRole("heading", {name: "Hi, Snowbit!"})).toBeVisible();
    await memberPage.reload();
    const otherDevice = memberPage.getByRole("listitem").filter({hasText: "A new device signed in."})
      .filter({has: memberPage.getByRole("button", {name: "That wasn't me"})});
    await otherDevice.getByRole("button", {name: "That wasn't me"}).click();
    await expect(memberPage.getByRole("status").filter({hasText: "was signed out"})).toBeVisible();
    await otherPage.reload();
    await expect(otherPage).toHaveURL(/\/en\/sign-in$/);

    // A known device can unlock new-device PIN sign-in after a dispute.
    await memberPage.getByRole("button", {name: "Switch person or sign out"}).click();
    await enterPin(memberPage, "Snowbit", pin);
    await expect(memberPage.getByRole("heading", {name: "Hi, Snowbit!"})).toBeVisible();
    await otherPage.goto(address);
    await enterPin(otherPage, "Snowbit", pin);
    await expect(otherPage.getByRole("heading", {name: "Hi, Snowbit!"})).toBeVisible();
    await memberPage.locator("summary").filter({hasText: /^Sign out everywhere$/}).click();
    await memberPage.getByRole("button", {name: "Sign out everywhere"}).click();
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
    await page.getByRole("button", {name: "Use Face ID"}).click();
    await expect(page.getByRole("heading", {name: "Who's ready"})).toBeVisible();
    await page.context().clearCookies();
    await page.goto("/en");
    await page.getByRole("button", {name: "Sign in with Face ID"}).click();
    await expect(page.getByRole("heading", {name: "Hi, Northstar!"})).toBeVisible();
    await page.getByText("Make a new PIN", {exact: true}).click();
    await page.getByLabel("4-digit PIN").fill("6285");
    await page.getByLabel("Type the PIN again").fill("6285");
    await page.getByRole("button", {name: "Save PIN"}).click();
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
    await guestPage.getByRole("link", {name: "Tengo un código de 6 caracteres"}).click();
    await guestPage.getByLabel("Código de 6 caracteres").fill(code);
    await guestPage.getByRole("button", {name: "Continuar con mi código"}).click();
    await guestPage.getByRole("button", {name: "Sí, soy Pino"}).click();
    await guestPage.getByLabel("PIN de 4 dígitos").fill(pin);
    await guestPage.getByLabel("Vuelve a escribir el PIN").fill(pin);
    await guestPage.getByRole("button", {name: "Guardar PIN"}).click();
    await guestPage.getByRole("link", {name: "Ahora no"}).click();
    await expect(guestPage.getByRole("heading", {name: "¡Hola, Pino!"})).toBeVisible();
    expect((await guestPage.goto("/es/family/group-chat"))?.status()).toBe(404);
    await guestPage.goto("/es/account");
    await guestPage.getByRole("button", {name: "Cambiar de persona o cerrar sesión"}).click();
    await guestPage.getByRole("link", {name: "Pino", exact: true}).click();
    await guestPage.locator("summary").filter({hasText: "Olvidé mi PIN"}).click();
    await guestPage.getByRole("button", {name: "Pedirle una llave nueva al organizador"}).click();
    await expect(guestPage.getByRole("status").filter({hasText: "Ya le avisamos al organizador"})).toBeVisible();
    await page.getByRole("link", {name: "Go back"}).click();
    const row = page.getByRole("listitem").filter({has: page.getByRole("heading", {name: "Pino"})});
    await expect(row.getByText(/Asked for a new key on/)).toBeVisible();
    await page.getByRole("link", {name: "Notifications (1 unread)"}).click();
    await expect(page.getByText("Pino asked for a PIN reset.")).toBeVisible();
    expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
    await page.getByRole("button", {name: "Mark as read"}).click();
    await expect(page.getByText(/ · Read$/)).toBeVisible();
    await page.getByRole("link", {name: "View PIN reset requests"}).click();
    await expect(page.getByRole("link", {name: "Notifications", exact: true})).toBeVisible();

    await page.getByRole("link", {name: "Messages for the family chat"}).click();
    const draw = page.getByRole("region", {name: "Names are drawn!"});
    await draw.getByRole("button", {name: "Copy message"}).click();
    await expect(draw.getByRole("status")).toHaveText("Message copied.");
    const copied = await page.evaluate(() => sessionStorage.getItem("notification-copy"));
    const chatAddress = new URL(address);
    chatAddress.pathname = "/en/sign-in";
    expect(copied).toContain(chatAddress.href);
    expect(copied).not.toContain(code);
    await draw.getByRole("button", {name: "Share", exact: true}).click();
    expect(await page.evaluate(() => sessionStorage.getItem("notification-share"))).toBe(copied);
    const whatsapp = new URL((await draw.getByRole("link", {name: "Share on WhatsApp"}).getAttribute("href"))!);
    expect(whatsapp.origin).toBe("https://wa.me");
    expect(whatsapp.searchParams.get("text")).toBe(copied);
    expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);

    await page.goto("/es/family/group-chat");
    await expect(page.getByRole("heading", {name: "Mensajes para el chat familiar"})).toBeVisible();
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
    const enable = page.getByRole("button", {name: "Turn on notifications for this device"});
    await expect(enable).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem("test-notification-permission"))).toBeNull();
    await enable.click();
    await expect(page.getByRole("status")).toHaveText("Notifications are on for this device.");
    expect(await page.evaluate(() => sessionStorage.getItem("test-notification-permission"))).toBe("asked");
    const sessionId = (await page.context().cookies()).find(({name}) => name === "__Host-fge-session")!.value.split(".")[1];
    const subscriptions = () => runForFamily(db, familyId, (tx) => tx.select().from(pushSubscriptions));
    expect(await subscriptions()).toMatchObject([{endpoint, sessionId}]);

    await page.getByRole("button", {name: "Turn off notifications for this device"}).click();
    await expect(page.getByRole("status")).toHaveText("Notifications are off for this device.");
    expect(await subscriptions()).toEqual([]);
  } finally {
    await close();
    await removeFamily(familyId);
  }
});
