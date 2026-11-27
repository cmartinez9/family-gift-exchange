// @vitest-environment jsdom
import {act, cloneElement, isValidElement, type ReactNode} from "react";
import {createRoot, type Root} from "react-dom/client";
import {createTranslator, NextIntlClientProvider} from "next-intl";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import {AskForHelp, firstName, OrganizerHelpProvider} from "../../src/app/[locale]/sign-in/ask-for-help";
import {KeyWelcome, SignInWithPin} from "../../src/app/[locale]/sign-in/get-in";
import {SignInFlow, SignInHelp, SignInScreen} from "../../src/app/[locale]/sign-in/screen";
import KeyPage from "../../src/app/[locale]/key/[key]/page";
import FaceIdPage from "../../src/app/[locale]/face-id/page";

const actions = vi.hoisted(() => ({
  forgotPin: vi.fn(), useKey: vi.fn(), enterPin: vi.fn(), previewCode: vi.fn(),
  beginFaceId: vi.fn(), finishFaceIdEnrollment: vi.fn(), finishFaceIdSignIn: vi.fn(), reportUsedKey: vi.fn(), openFamily: vi.fn(),
  noticeUsedKeyLink: vi.fn().mockResolvedValue(false),
}));
const server = vi.hoisted(() => ({
  getViewer: vi.fn(), requireViewer: vi.fn(), organizerContacts: vi.fn(), peopleOnDevice: vi.fn(), signInFamily: vi.fn(),
  rememberedFamily: vi.fn(), currentDeviceHash: vi.fn(), currentDeviceKind: vi.fn(),
  inspectKey: vi.fn(), activePerson: vi.fn(), keySender: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth", () => ({getViewer: server.getViewer, requireViewer: server.requireViewer}));
vi.mock("@/server/auth/access", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/server/auth/access")>(), inspectKey: server.inspectKey, activePerson: server.activePerson,
}));
vi.mock("@/server/auth/account", () => ({
  organizerContacts: server.organizerContacts, peopleOnDevice: server.peopleOnDevice, keySender: server.keySender,
}));
vi.mock("@/server/auth/families", () => ({signInFamily: server.signInFamily}));
vi.mock("@/server/auth/request", () => ({
  rememberedFamily: server.rememberedFamily, currentDeviceHash: server.currentDeviceHash, currentDeviceKind: server.currentDeviceKind,
}));
vi.mock("@/server/db/client", () => ({withFamily: (_: string, run: () => unknown) => run()}));
vi.mock("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: "auth" | "home" | "getIn" | `getIn.${keyof typeof en.getIn}`) =>
    createTranslator({locale: "en", messages: en, namespace}),
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
  server.requireViewer.mockResolvedValue({familyId: routeFamilyId, personId: "rosa", isOrganizer: false});
  server.rememberedFamily.mockResolvedValue("family");
  server.currentDeviceHash.mockResolvedValue("phone");
  server.currentDeviceKind.mockResolvedValue("iphone");
  server.inspectKey.mockResolvedValue(null);
  server.activePerson.mockResolvedValue({displayName: "Ana"});
  server.keySender.mockResolvedValue("Christian");
  server.organizerContacts.mockResolvedValue(familyOrganizers);
  server.peopleOnDevice.mockResolvedValue(["rosa"]);
  const names = [{id: "rosa", name: "Rosa"}, {id: "ana", name: "Ana"}];
  server.signInFamily.mockResolvedValue({name: "Martinez", names, helpNames: names, organizers: familyOrganizers});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function render(node: ReactNode, locale: "en" | "es" = "en") {
  const resolved = await resolveServerComponents(node);
  await act(async () => root.render(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : es} timeZone="America/Chicago">{resolved}</NextIntlClientProvider>,
  ));
}

async function resolveServerComponents(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolveServerComponents));
  if (!isValidElement<Record<string, unknown>>(node)) return node;
  if (typeof node.type === "function" && node.type.constructor.name === "AsyncFunction") {
    const component = node.type as (props: Record<string, unknown>) => Promise<ReactNode>;
    return resolveServerComponents(await component(node.props));
  }
  const props: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(node.props)) {
    if (isValidElement(value) || Array.isArray(value)) props[name] = await resolveServerComponents(value as ReactNode);
  }
  return cloneElement(node, props);
}

const link = (label: string) => [...container.querySelectorAll("button")].find((node) => node.textContent?.startsWith(label));

async function tap(label: string) {
  expect(link(label), label).toBeDefined();
  await act(async () => link(label)!.click());
}

const personAsker = {familyId: "family", personId: "rosa"};
const routeFamilyId = "11111111-1111-4111-8111-111111111111";
const routeKey = `${routeFamilyId}~${"x".repeat(43)}`;
const keyEntry = {id: "key", personId: "rosa", name: "Rosa", familyName: "Martinez", available: true, usedAt: null};
const familyOrganizers = [{personId: "christian", name: "Christian Martinez"}];

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
  await chooseName("Ana");
}

async function chooseName(name: string) {
  const choice = [...container.querySelectorAll<HTMLButtonElement>("dialog li button")].find((button) => button.textContent?.endsWith(name));
  expect(choice, name).toBeDefined();
  await act(async () => choice!.click());
}

async function submitCode(code = "BAD234") {
  await act(async () => {
    const field = container.querySelector<HTMLInputElement>('input[name="code"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, code);
    field.dispatchEvent(new Event("input", {bubbles: true}));
  });
  await act(async () => { container.querySelector("form")!.requestSubmit(); });
}

it("names the organizer by first name", async () => {
  expect(firstName("  Christian  Martinez ")).toBe("Christian");
  await render(<AskForHelp organizer="Christian Martinez" asker={personAsker} />);
  expect(link("Ask Christian for help")).toBeDefined();
  await render(<AskForHelp organizer="Christian" asker={personAsker} />, "es");
  expect(link("Pedirle ayuda a Christian")).toBeDefined();
});

it("shows nothing when the family has no organizer to ask", async () => {
  await render(<AskForHelp organizer="" asker={personAsker} />);
  expect(container.textContent).toBe("");
});

it("asks for the key's owner before joining, then says so in plain words", async () => {
  actions.forgotPin.mockResolvedValue({success: "resetRequested"});
  await render(<KeyWelcome familyId="family" value="ABC234" typed entry={keyEntry} sender="Christian" organizer="Christian" />);
  await tap("Ask Christian for help");
  expect(actions.forgotPin).toHaveBeenCalledExactlyOnceWith("family", "rosa");
  expect(actions.useKey).not.toHaveBeenCalled();
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

it.each([false, true])("can ask for the key's owner from each helper view (typed: %s)", async (typed) => {
  actions.forgotPin.mockResolvedValue({success: "resetRequested"});
  const entry = {personId: "rosa", name: "Rosa", familyName: "Martinez", available: true, usedAt: null, preview: "signed"};
  await render(<KeyWelcome familyId="family" value="token" typed={typed} entry={entry} sender="Christian" organizer="Christian Martinez" />);
  await tap("No, I'm helping Rosa");
  expect(link("Ask Christian for help")).toBeDefined();
  await tap(en.helping.hereTitle.replace("{name}", "Rosa"));
  expect(link("Ask Christian for help")).toBeDefined();
  await tap(en.auth.back);
  await tap(en.helping.noPhoneTitle.replace("{name}", "Rosa"));
  await tap("Ask Christian for help");
  expect(actions.forgotPin).toHaveBeenCalledExactlyOnceWith("family", "rosa");
  expect(actions.useKey).not.toHaveBeenCalled();
});

it.each(["unavailable", "tryLater", "connectionFailed"] as const)("keeps help available on code entry before and after %s", async (error) => {
  actions.previewCode.mockResolvedValue({error});
  actions.forgotPin.mockResolvedValue({success: "resetRequested"});
  await render(await SignInFlow({search: {family: routeFamilyId, join: "1"}}));
  expect(link("Ask Christian for help")).toBeDefined();
  await submitCode();
  expect(actions.previewCode).toHaveBeenCalledExactlyOnceWith(routeFamilyId, "BAD234");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(en.auth.feedback[error]);
  const {sheet} = prepareSheet();
  await tap("Ask Christian for help");
  expect(sheet.open).toBe(true);
  await chooseLastName();
  expect(actions.forgotPin).toHaveBeenCalledExactlyOnceWith(routeFamilyId, "ana");
  expect(actions.useKey).not.toHaveBeenCalled();
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Christian has been asked. Watch your chat.");
});

it("asks from code entry without checking or using a code", async () => {
  actions.forgotPin.mockResolvedValue({error: "tryLater"});
  await render(await SignInFlow({search: {family: routeFamilyId, join: "1"}}));
  prepareSheet();
  await tap("Ask Christian for help");
  await chooseLastName();
  expect(actions.forgotPin).toHaveBeenCalledExactlyOnceWith(routeFamilyId, "ana");
  expect(actions.previewCode).not.toHaveBeenCalled();
  expect(actions.useKey).not.toHaveBeenCalled();
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Christian was already asked today. Watch your chat.");
});

it("asks for the checked code's owner from its welcome screen", async () => {
  actions.previewCode.mockResolvedValue({key: {...keyEntry, preview: "signed"}});
  actions.forgotPin.mockResolvedValue({success: "resetRequested"});
  await render(await SignInFlow({search: {family: routeFamilyId, join: "1"}}));
  await submitCode();
  await tap("Ask Christian for help");
  expect(actions.forgotPin).toHaveBeenCalledExactlyOnceWith(routeFamilyId, "rosa");
  expect(actions.useKey).not.toHaveBeenCalled();
});

it.each([true, false])("asks from a paused family with remembered identity: %s", async (remembered) => {
  server.peopleOnDevice.mockResolvedValue(remembered ? ["rosa"] : []);
  actions.forgotPin.mockResolvedValue({success: "resetRequested"});
  await render(await SignInFlow({search: {family: routeFamilyId, safety: "1"}}));
  expect(container.querySelector("h1")?.textContent).toBe(en.getIn.paused.title);
  if (!remembered) prepareSheet();
  await tap("Ask Christian for help");
  if (!remembered) await chooseLastName();
  expect(actions.forgotPin).toHaveBeenCalledExactlyOnceWith(routeFamilyId, remembered ? "rosa" : "ana");
});

it.each(["home", "sign-in"] as const)("asks for the signed-in person from %s", async (screen) => {
  server.getViewer.mockResolvedValue({familyId: routeFamilyId, personId: "ana"});
  actions.forgotPin.mockResolvedValue({success: "resetRequested"});
  await render(screen === "home" ? await SignInScreen({}) : await SignInFlow({}));
  await tap("Ask Christian for help");
  expect(actions.forgotPin).toHaveBeenCalledExactlyOnceWith(routeFamilyId, "ana");
});

it.each([{}, {setup: "1"}, {welcome: "1"}])("keeps help on the Face ID offer and after enrollment failure (%j)", async (search) => {
  actions.beginFaceId.mockRejectedValue(new Error("Face ID unavailable"));
  actions.forgotPin.mockResolvedValue({success: "resetRequested"});
  await render(await FaceIdPage({searchParams: Promise.resolve(search)}));
  expect(link("Ask Christian for help")).toBeDefined();
  await tap(en.getIn.face.yes);
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(en.auth.faceUnavailable);
  await tap("Ask Christian for help");
  expect(actions.forgotPin).toHaveBeenCalledExactlyOnceWith(routeFamilyId, "rosa");
});

it.each(["missing", "unavailable", "already-yours", "forwarded"] as const)("offers help on the %s key branch", async (branch) => {
  const viewerFamilyId = branch === "forwarded" ? "22222222-2222-4222-8222-222222222222" : routeFamilyId;
  if (branch !== "missing") server.inspectKey.mockResolvedValue({...keyEntry, available: false,
    usedAt: branch === "already-yours" ? new Date("2026-01-01") : null});
  if (branch === "already-yours" || branch === "forwarded") {
    server.getViewer.mockResolvedValue({familyId: viewerFamilyId, personId: branch === "forwarded" ? "ana" : "rosa"});
  }
  actions.forgotPin.mockResolvedValue({success: "resetRequested"});
  await render(await KeyPage({params: Promise.resolve({key: routeKey})}));
  expect(actions.noticeUsedKeyLink).not.toHaveBeenCalled();
  await tap("Ask Christian for help");
  expect(actions.forgotPin).toHaveBeenCalledExactlyOnceWith(routeFamilyId, "rosa");
  expect(actions.useKey).not.toHaveBeenCalled();
});

it("records a used key opened while someone else is signed in", async () => {
  server.inspectKey.mockResolvedValue({...keyEntry, available: false, usedAt: new Date("2026-01-01")});
  server.getViewer.mockResolvedValue({familyId: routeFamilyId, personId: "ana"});
  await render(await KeyPage({params: Promise.resolve({key: routeKey})}));
  expect(actions.noticeUsedKeyLink).toHaveBeenCalledExactlyOnceWith(routeKey, expect.any(String));
  expect(actions.useKey).not.toHaveBeenCalled();
});

it("uses a remembered family for a malformed key", async () => {
  actions.forgotPin.mockResolvedValue({success: "resetRequested"});
  await render(await KeyPage({params: Promise.resolve({key: "bad-key"})}));
  await tap("Ask Christian for help");
  expect(actions.forgotPin).toHaveBeenCalledExactlyOnceWith("family", "rosa");
});

it.each(["sign-in", "paused", "key"] as const)("does not invent a help recipient on %s without a known family", async (screen) => {
  server.rememberedFamily.mockResolvedValue(null);
  await render(screen === "key" ? await KeyPage({params: Promise.resolve({key: "bad-key"})})
    : await SignInFlow({search: screen === "paused" ? {safety: "1"} : {}}));
  expect(link("Ask Christian for help")).toBeUndefined();
  expect(actions.forgotPin).not.toHaveBeenCalled();
});

it.each(["joined", "invited"] as const)("targets the inspected %s key owner instead of the remembered person", async (membership) => {
  const helpNames = [{id: "rosa", name: "Rosa"}, {id: "ana", name: "Ana"}];
  server.signInFamily.mockResolvedValue({name: "Martinez", helpNames, organizers: familyOrganizers,
    names: membership === "joined" ? helpNames : helpNames.filter(({id}) => id === "ana")});
  server.peopleOnDevice.mockResolvedValue(["ana"]);
  server.inspectKey.mockResolvedValue({...keyEntry, available: false});
  actions.forgotPin.mockResolvedValue({success: "resetRequested"});
  await render(await KeyPage({params: Promise.resolve({key: routeKey})}));
  await tap("Ask Christian for help");
  expect(actions.forgotPin).toHaveBeenCalledExactlyOnceWith(routeFamilyId, "rosa");
  expect(container.querySelector("dialog")).toBeNull();
  expect(actions.useKey).not.toHaveBeenCalled();
});

it("asks for a name when an explicit target is unavailable, without silently substituting the remembered person", async () => {
  server.peopleOnDevice.mockResolvedValue(["ana"]);
  actions.forgotPin.mockResolvedValue({success: "resetRequested"});
  await render(await SignInHelp({familyId: routeFamilyId, personId: "removed"}));
  const {sheet} = prepareSheet();
  await tap("Ask Christian for help");
  expect(sheet.open).toBe(true);
  expect(actions.forgotPin).not.toHaveBeenCalled();
  await chooseName("Rosa");
  expect(actions.forgotPin).toHaveBeenCalledExactlyOnceWith(routeFamilyId, "rosa");
});

it.each(["home", "picker", "code", "paused"] as const)("includes first-time members in %s help without offering PIN sign-in", async (screen) => {
  server.signInFamily.mockResolvedValue({name: "Martinez", names: [{id: "ana", name: "Ana"}], organizers: familyOrganizers,
    helpNames: [{id: "rosa", name: "Rosa"}, {id: "ana", name: "Ana"}]});
  server.peopleOnDevice.mockResolvedValue([]);
  actions.forgotPin.mockResolvedValue({success: "resetRequested"});
  actions.previewCode.mockResolvedValue({error: "unavailable"});
  await render(screen === "home" ? await SignInScreen({}) : await SignInFlow({search: {
    family: routeFamilyId, all: "1", ...(screen === "code" ? {join: "1"} : screen === "paused" ? {safety: "1"} : {person: "rosa"}),
  }}));
  expect([...container.querySelectorAll("a")].some((link) => link.getAttribute("href")?.includes("person=rosa"))).toBe(false);
  if (screen === "picker") expect(container.querySelector("h1")?.textContent).toBe(en.getIn.who.title);
  if (screen === "code") await submitCode();
  prepareSheet();
  await tap("Ask Christian for help");
  await chooseName("Rosa");
  expect(actions.forgotPin).toHaveBeenCalledExactlyOnceWith(screen === "home" ? "family" : routeFamilyId, "rosa");
  expect(actions.enterPin).not.toHaveBeenCalled();
});

for (const locale of ["en", "es"] as const) {
  it.each(["home", "welcome", "pin", "key", "used", "face"] as const)(`shows sole-organizer recovery on %s in ${locale}`, async (screen) => {
    const names = [{id: "christian", name: "Christian Martinez"}];
    server.signInFamily.mockResolvedValue({name: "Martinez", names, helpNames: names, organizers: familyOrganizers});
    server.peopleOnDevice.mockResolvedValue(["christian"]);
    server.requireViewer.mockResolvedValue({familyId: routeFamilyId, personId: "christian", isOrganizer: true});
    server.inspectKey.mockResolvedValue({...keyEntry, personId: "christian", name: "Christian Martinez",
      available: screen !== "used", usedAt: screen === "used" ? new Date("2026-01-01") : null});
    const node = screen === "home" ? await SignInScreen({})
      : screen === "face" ? await FaceIdPage({searchParams: Promise.resolve({})})
        : screen === "key" || screen === "used" ? await KeyPage({params: Promise.resolve({key: routeKey})})
          : await SignInFlow({search: {family: routeFamilyId, ...(screen === "pin" ? {person: "christian"} : {})}});
    await render(node, locale);
    expect(container.textContent).toContain((locale === "en" ? en : es).auth.feedback.organizerRecovery);
    expect([...container.querySelectorAll("button")].some((button) => /^(Ask |Pedirle ayuda)/.test(button.textContent ?? ""))).toBe(false);
    if (screen === "pin" || screen === "used") {
      if (screen === "used") prepareSheet();
      await tap((locale === "en" ? en : es).getIn.enter.forgot);
      expect(container.textContent).toContain((locale === "en" ? en : es).auth.feedback.organizerRecovery);
      expect([...container.querySelectorAll("button")].some((button) => /^(Ask |Pedirle)/.test(button.textContent ?? ""))).toBe(false);
    }
    expect(actions.forgotPin).not.toHaveBeenCalled();
  });
}

it("shows recovery after choosing the sole organizer without sending a request", async () => {
  await render(<OrganizerHelpProvider organizers={familyOrganizers}>
    <AskForHelp organizer="Christian Martinez" asker={{familyId: "family", names: [{id: "christian", name: "Christian Martinez"}]}} />
  </OrganizerHelpProvider>);
  prepareSheet();
  await tap("Ask Christian for help");
  await chooseName("Christian Martinez");
  expect(container.textContent).toContain(en.auth.feedback.organizerRecovery);
  expect(link("Ask Christian for help")).toBeUndefined();
  expect(actions.forgotPin).not.toHaveBeenCalled();
});

it.each(["en", "es"] as const)("asks the co-organizer by name in %s", async (locale) => {
  actions.forgotPin.mockResolvedValue({success: "resetRequested"});
  await render(<OrganizerHelpProvider organizers={[...familyOrganizers, {personId: "ana", name: "Ana Martinez"}]}>
    <AskForHelp organizer="Christian Martinez" asker={{familyId: "family", personId: "christian"}} />
  </OrganizerHelpProvider>, locale);
  await tap(locale === "en" ? "Ask Ana for help" : "Pedirle ayuda a Ana");
  expect(actions.forgotPin).toHaveBeenCalledExactlyOnceWith("family", "christian");
  expect(container.querySelector('[role="status"]')?.textContent).toBe(locale === "en"
    ? "Ana has been asked. Watch your chat." : "Ya le avisamos a Ana. Revisa tu chat.");
});

it("names the primary organizer for a member when a co-organizer is also available", async () => {
  actions.forgotPin.mockResolvedValue({success: "resetRequested"});
  await render(<OrganizerHelpProvider organizers={[...familyOrganizers, {personId: "ana", name: "Ana Martinez"}]}>
    <AskForHelp organizer="Christian Martinez" asker={{familyId: "family", personId: "rosa"}} />
  </OrganizerHelpProvider>);
  expect(link("Ask Ana for help")).toBeUndefined();
  await tap("Ask Christian for help");
  expect(actions.forgotPin).toHaveBeenCalledExactlyOnceWith("family", "rosa");
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Christian has been asked. Watch your chat.");
});

it("switches stale recipient information to recovery instead of claiming success", async () => {
  actions.forgotPin.mockResolvedValue({error: "organizerRecovery"});
  await render(<OrganizerHelpProvider organizers={[...familyOrganizers, {personId: "ana", name: "Ana"}]}>
    <AskForHelp organizer="Christian" asker={{familyId: "family", personId: "christian"}} />
  </OrganizerHelpProvider>);
  await tap("Ask Ana for help");
  expect(container.textContent).toContain(en.auth.feedback.organizerRecovery);
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(link("Ask Ana for help")).toBeUndefined();
});

it("keeps sole-organizer recovery truthful after PIN lockout", async () => {
  vi.useFakeTimers();
  actions.enterPin.mockResolvedValue({error: "pinLocked", minutes: 2});
  await render(<OrganizerHelpProvider organizers={familyOrganizers}>
    <SignInWithPin familyId="family" personId="christian" name="Christian" organizer="Christian" backHref="/sign-in" />
  </OrganizerHelpProvider>);
  for (const digit of "4268") await tap(digit);
  await act(async () => { vi.advanceTimersByTime(260); });
  expect(container.querySelector("h1")?.textContent).toBe(en.getIn.locked.title);
  expect(container.textContent).toContain(en.auth.feedback.organizerRecovery);
  expect([...container.querySelectorAll("button")].some((button) => button.textContent?.startsWith("Ask "))).toBe(false);
  expect(actions.forgotPin).not.toHaveBeenCalled();
});
