// @vitest-environment jsdom
import {act, type ReactNode} from "react";
import {createRoot, type Root} from "react-dom/client";
import {createTranslator, NextIntlClientProvider} from "next-intl";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import {AskForHelp, firstName} from "../../src/app/[locale]/sign-in/ask-for-help";
import {KeyWelcome, SignInWithPin} from "../../src/app/[locale]/sign-in/get-in";
import {SignInScreen} from "../../src/app/[locale]/sign-in/screen";

const actions = vi.hoisted(() => ({
  askForHelpWithKey: vi.fn(), forgotPin: vi.fn(), useKey: vi.fn(), enterPin: vi.fn(), previewCode: vi.fn(),
  beginFaceId: vi.fn(), finishFaceIdEnrollment: vi.fn(), finishFaceIdSignIn: vi.fn(), reportUsedKey: vi.fn(), openFamily: vi.fn(),
}));
const server = vi.hoisted(() => ({
  getViewer: vi.fn(), organizerName: vi.fn(), peopleOnDevice: vi.fn(), signInFamily: vi.fn(),
  rememberedFamily: vi.fn(), currentDeviceHash: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth", () => ({getViewer: server.getViewer}));
vi.mock("@/server/auth/account", () => ({organizerName: server.organizerName, peopleOnDevice: server.peopleOnDevice}));
vi.mock("@/server/auth/families", () => ({signInFamily: server.signInFamily}));
vi.mock("@/server/auth/request", () => ({rememberedFamily: server.rememberedFamily, currentDeviceHash: server.currentDeviceHash}));
vi.mock("@/server/db/client", () => ({withFamily: (_: string, run: () => unknown) => run()}));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: "getIn.back" | "auth") => createTranslator({locale: "en", messages: en, namespace}),
}));
vi.mock("../../src/app/[locale]/sign-in/actions", () => actions);
vi.mock("@/i18n/navigation", () => ({
  Link: ({href, children}: {href: string; children: ReactNode}) => <a href={href}>{children}</a>,
  useRouter: () => ({push: vi.fn(), replace: vi.fn()}),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({matches: false, addEventListener() {}, removeEventListener() {}}));
  server.getViewer.mockResolvedValue(null);
  server.rememberedFamily.mockResolvedValue("family");
  server.currentDeviceHash.mockResolvedValue("phone");
  server.organizerName.mockResolvedValue("Christian Martinez");
  server.peopleOnDevice.mockResolvedValue(["rosa"]);
  server.signInFamily.mockResolvedValue({name: "Martinez", names: [{id: "rosa", name: "Rosa"}, {id: "ana", name: "Ana"}]});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(node: ReactNode, locale: "en" | "es" = "en") {
  await act(async () => root.render(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : es} timeZone="America/Chicago">{node}</NextIntlClientProvider>,
  ));
}

const link = (label: string) => [...container.querySelectorAll("button")].find((node) => node.textContent?.startsWith(label));

async function tap(label: string) {
  expect(link(label), label).toBeDefined();
  await act(async () => link(label)!.click());
}

const keyAsker = {familyId: "family", key: {value: "token", typed: false, preview: null}};

function prepareSheet() {
  const sheet = container.querySelector<HTMLDialogElement>("dialog")!;
  sheet.showModal = () => { sheet.open = true; };
  sheet.close = () => { sheet.open = false; };
  const animations: Array<{onfinish: (() => void) | null}> = [];
  for (const element of sheet.querySelectorAll<HTMLElement>(".fge-sheet-body, [data-scrim]")) {
    element.getAnimations = () => [];
    element.animate = () => {
      const animation = {onfinish: null as (() => void) | null, cancel() {}};
      animations.push(animation);
      return animation as unknown as Animation;
    };
  }
  return {sheet, finish: async () => act(async () => { animations.splice(0).forEach((animation) => animation.onfinish?.()); })};
}

async function chooseLastName() {
  const choice = container.querySelector<HTMLButtonElement>("dialog li:last-child button");
  expect(choice?.textContent).toContain("Ana");
  await act(async () => choice!.click());
}

it("names the organizer by first name", async () => {
  expect(firstName("  Christian  Martinez ")).toBe("Christian");
  await render(<AskForHelp organizer="Christian Martinez" asker={keyAsker} />);
  expect(link("Ask Christian for help")).toBeDefined();
  await render(<AskForHelp organizer="Christian" asker={keyAsker} />, "es");
  expect(link("Pedirle ayuda a Christian")).toBeDefined();
});

it("shows nothing when the family has no organizer to ask", async () => {
  await render(<AskForHelp organizer="" asker={keyAsker} />);
  expect(container.textContent).toBe("");
});

it("asks with the key before joining, then says so in plain words", async () => {
  actions.askForHelpWithKey.mockResolvedValue({success: "resetRequested"});
  await render(<AskForHelp organizer="Christian" asker={{familyId: "family", key: {value: "ABC234", typed: true, preview: "signed"}}} />);
  await tap("Ask Christian for help");
  expect(actions.askForHelpWithKey).toHaveBeenCalledWith("family", "ABC234", true, "signed");
  expect(actions.forgotPin).not.toHaveBeenCalled();
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Christian has been asked. Watch your chat.");
  expect(link("Ask Christian for help")).toBeUndefined();
});

it("sends the forgot-PIN request for someone who has joined", async () => {
  actions.forgotPin.mockResolvedValue({success: "resetRequested"});
  await render(<AskForHelp organizer="Christian" asker={{familyId: "family", personId: "rosa"}} />);
  await tap("Ask Christian for help");
  expect(actions.forgotPin).toHaveBeenCalledWith("family", "rosa");
  expect(container.querySelector('[role="status"]')).not.toBeNull();
});

it("treats today's limit as already asked, and lets a failure be tried again", async () => {
  actions.forgotPin.mockResolvedValueOnce({error: "connectionFailed"}).mockResolvedValueOnce({error: "tryLater"});
  await render(<AskForHelp organizer="Christian" asker={{familyId: "family", personId: "rosa"}} />);
  await tap("Ask Christian for help");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(en.getIn.help.failed);
  await tap("Ask Christian for help");
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Christian was already asked today. Watch your chat.");
});

it("sits on the key's first screen and the PIN screens", async () => {
  const entry = {personId: "rosa", name: "Rosa", familyName: "Martinez", available: true, usedAt: null};
  await render(<KeyWelcome familyId="family" value="token" typed={false} entry={entry} sender="Christian" organizer="Christian" />);
  expect(link("Ask Christian for help")).toBeDefined();
  await tap(en.getIn.hello.yes);
  expect(container.textContent).toContain(en.getIn.pin.makeTitle);
  expect(link("Ask Christian for help")).toBeDefined();
  await render(<SignInWithPin familyId="family" personId="rosa" name="Rosa" organizer="Christian" backHref="/sign-in" />);
  expect(link("Ask Christian for help")).toBeDefined();
});

it("asks directly from home for the only remembered person", async () => {
  actions.forgotPin.mockResolvedValue({success: "resetRequested"});
  await render(await SignInScreen({}));
  await tap("Ask Christian for help");
  expect(actions.forgotPin).toHaveBeenCalledExactlyOnceWith("family", "rosa");
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Christian has been asked. Watch your chat.");
});

it.each([{known: []}, {known: ["rosa", "ana"]}, {known: ["removed"]}])("chooses who needs help at home when no single current person is remembered (%j)", async ({known}) => {
  server.peopleOnDevice.mockResolvedValue(known);
  actions.forgotPin.mockResolvedValue({success: "resetRequested"});
  await render(await SignInScreen({}));
  const {sheet} = prepareSheet();
  await tap("Ask Christian for help");
  expect(sheet.open).toBe(true);
  expect(actions.forgotPin).not.toHaveBeenCalled();
  await chooseLastName();
  expect(actions.forgotPin).toHaveBeenCalledExactlyOnceWith("family", "ana");
});

it("keeps home help hidden until a family is known", async () => {
  server.rememberedFamily.mockResolvedValue(null);
  await render(await SignInScreen({}));
  expect(link("Ask Christian for help")).toBeUndefined();
});

it.each([
  [{success: "resetRequested"}, en.getIn.help.asked.replace("{organizer}", "Christian")],
  [{error: "tryLater"}, en.getIn.help.already.replace("{organizer}", "Christian")],
])("uses the same request and limit after choosing a name (%j)", async (response, message) => {
  actions.forgotPin.mockResolvedValue(response);
  await render(<AskForHelp organizer="Christian Martinez" asker={{familyId: "family", names: [{id: "ana", name: "Ana"}]}} />);
  const {sheet} = prepareSheet();
  await tap("Ask Christian for help");
  expect(sheet.open).toBe(true);
  expect(sheet.textContent).toContain(en.getIn.help.who);
  expect(sheet.textContent).toContain("Choose your name to ask Christian.");
  expect(actions.forgotPin).not.toHaveBeenCalled();
  await chooseLastName();
  expect(actions.forgotPin).toHaveBeenCalledExactlyOnceWith("family", "ana");
  expect(actions.askForHelpWithKey).not.toHaveBeenCalled();
  expect(container.querySelector('[role="status"]')?.textContent).toBe(message);
});

it("can dismiss the name choice without asking and retry a failed request", async () => {
  actions.forgotPin.mockResolvedValueOnce({error: "connectionFailed"}).mockResolvedValueOnce({success: "resetRequested"});
  await render(<AskForHelp organizer="Christian" asker={{familyId: "family", names: [{id: "ana", name: "Ana"}]}} />);
  const {sheet, finish} = prepareSheet();
  await tap("Ask Christian for help");
  await act(async () => sheet.querySelector<HTMLButtonElement>("[data-sheet-close]")!.click());
  await finish();
  expect(sheet.open).toBe(false);
  expect(actions.forgotPin).not.toHaveBeenCalled();
  await tap("Ask Christian for help");
  await chooseLastName();
  await finish();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(en.getIn.help.failed);
  await tap("Ask Christian for help");
  await chooseLastName();
  expect(actions.forgotPin).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Christian has been asked. Watch your chat.");
});

it("does not offer an empty name choice", async () => {
  await render(<AskForHelp organizer="Christian" asker={{familyId: "family", names: []}} />);
  expect(container.textContent).toBe("");
});

it.each([false, true])("can ask with the key from each helper view (typed: %s)", async (typed) => {
  actions.askForHelpWithKey.mockResolvedValue({success: "resetRequested"});
  const entry = {personId: "rosa", name: "Rosa", familyName: "Martinez", available: true, usedAt: null, preview: "signed"};
  await render(<KeyWelcome familyId="family" value="token" typed={typed} entry={entry} sender="Christian" organizer="Christian Martinez" />);
  await tap("No, I'm helping Rosa");
  expect(link("Ask Christian for help")).toBeDefined();
  await tap(en.helping.hereTitle.replace("{name}", "Rosa"));
  expect(link("Ask Christian for help")).toBeDefined();
  await tap(en.auth.back);
  await tap(en.helping.noPhoneTitle.replace("{name}", "Rosa"));
  await tap("Ask Christian for help");
  expect(actions.askForHelpWithKey).toHaveBeenCalledExactlyOnceWith("family", "token", typed, "signed");
  expect(actions.useKey).not.toHaveBeenCalled();
});
