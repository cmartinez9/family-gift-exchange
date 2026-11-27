// @vitest-environment jsdom
import {act, type ReactNode} from "react";
import {createRoot, type Root} from "react-dom/client";
import {NextIntlClientProvider} from "next-intl";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import {AskForHelp, firstName} from "../../src/app/[locale]/sign-in/ask-for-help";
import {KeyWelcome, SignInWithPin} from "../../src/app/[locale]/sign-in/get-in";

const actions = vi.hoisted(() => ({
  askForHelpWithKey: vi.fn(), forgotPin: vi.fn(), useKey: vi.fn(), enterPin: vi.fn(), previewCode: vi.fn(),
  beginFaceId: vi.fn(), finishFaceIdEnrollment: vi.fn(), finishFaceIdSignIn: vi.fn(), reportUsedKey: vi.fn(), openFamily: vi.fn(),
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

const link = (label: string) => [...container.querySelectorAll("button")].find((node) => node.textContent === label);

async function tap(label: string) {
  expect(link(label), label).toBeDefined();
  await act(async () => link(label)!.click());
}

const keyAsker = {familyId: "family", key: {value: "token", typed: false, preview: null}};

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
