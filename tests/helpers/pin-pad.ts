import {expect, type Page} from "@playwright/test";
import en from "../../messages/en.json" with {type: "json"};
import es from "../../messages/es.json" with {type: "json"};

type Language = "en" | "es";
const words = (language: Language) => (language === "en" ? en : es).getIn;

/** Types a PIN on the on-screen keypad, one key at a time, the way a person would. */
export async function typePin(page: Page, pin: string) {
  for (const digit of pin) {
    await page.getByRole("button", {name: digit, exact: true}).click();
  }
}

/**
 * Opens a personal key and makes the PIN: "Yes, it's my phone", the PIN, and the PIN once more.
 * Ends on "Use Face ID next time?".
 */
export async function openKey(page: Page, url: string, pin: string, language: Language = "en") {
  const t = words(language);
  await page.goto(url);
  await page.getByRole("button", {name: t.hello.yes}).click();
  await expect(page.getByRole("heading", {name: t.pin.makeTitle})).toBeVisible();
  await typePin(page, pin);
  await expect(page.getByRole("heading", {name: t.pin.againTitle})).toBeVisible();
  await typePin(page, pin);
  await expect(page.getByRole("heading", {name: t.face.title})).toBeVisible();
}

/** "Not now" on the Face ID offer, waiting for the next screen so a following navigation is not cut short. */
export async function skipFaceId(page: Page, language: Language = "en") {
  await page.getByRole("link", {name: (language === "en" ? en : es).auth.notNow}).click();
  // onboarding's /welcome redirects on to its first step: wait for where the person lands
  await page.waitForURL((url) => !/\/(face-id|welcome)$/.test(url.pathname));
  await page.waitForLoadState();
}

/** Lets arrivals and sheets settle, so axe reads final colours. */
export async function settled(page: Page) {
  await page.waitForFunction(() => document.getAnimations()
    .every((animation) => animation.playState !== "running" || animation.effect?.getTiming().iterations === Infinity));
}

/** Chooses a name on the family's sign-in screen and types the PIN. */
export async function signInWithPin(page: Page, familyId: string, name: string, pin: string, language: Language = "en") {
  const t = words(language);
  await page.goto(`/${language}/sign-in?family=${familyId}&all=1`);
  await page.getByRole("link", {name, exact: true}).click();
  await expect(page.getByRole("heading", {name: t.enter.title})).toBeVisible();
  await typePin(page, pin);
}

/** Signs out from the You screen, the way a person switches who is using the phone. */
export async function signOut(page: Page, language: Language = "en") {
  if (!new URL(page.url()).pathname.endsWith("/account")) await page.goto(`/${language}/account`);
  await page.getByRole("button", {name: words(language).you.signOut, exact: true}).click();
  await expect(page).toHaveURL(new RegExp(`/${language}/sign-in$`));
}
