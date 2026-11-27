// @vitest-environment jsdom
import {act, type ReactNode} from "react";
import {createRoot, type Root} from "react-dom/client";
import {NextIntlClientProvider} from "next-intl";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import en from "../../messages/en.json";
import es from "../../messages/es.json";

// The client half of Your phones (U2) and the Face ID switch (U4): what a tap does and says.

const calls = vi.hoisted(() => ({
  signOutPhone: vi.fn(), faceIdOff: vi.fn(), beginFaceId: vi.fn(), finishFaceIdEnrollment: vi.fn(),
  startRegistration: vi.fn(), toast: vi.fn(), refresh: vi.fn(),
}));
vi.mock("../../src/app/[locale]/account/actions", () => ({
  signOutPhone: calls.signOutPhone, faceIdOff: calls.faceIdOff,
  reportEvent: vi.fn(), setLanguage: vi.fn(), signOut: vi.fn(),
}));
vi.mock("../../src/app/[locale]/sign-in/actions", () => ({
  beginFaceId: calls.beginFaceId, finishFaceIdEnrollment: calls.finishFaceIdEnrollment,
}));
vi.mock("@simplewebauthn/browser", () => ({startRegistration: calls.startRegistration, startAuthentication: vi.fn()}));
vi.mock("@/components/ui/toast", () => ({toast: calls.toast}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({href, children}: {href: string; children: ReactNode}) => <a href={href}>{children}</a>,
  useRouter: () => ({push: vi.fn(), replace: vi.fn(), refresh: calls.refresh}),
}));

const {FaceIdRow, PhoneRow} = await import("../../src/app/[locale]/account/rows");

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

function render(node: ReactNode, locale: "en" | "es" = "en") {
  return act(async () => root.render(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : es} timeZone="America/Chicago">
      <ul>{node}</ul>
    </NextIntlClientProvider>,
  ));
}

const button = (name: RegExp) => [...container.querySelectorAll("button")].find((element) => name.test(element.getAttribute("aria-label") ?? element.textContent ?? ""))!;

it("signs out only the tapped phone and says so", async () => {
  calls.signOutPhone.mockResolvedValue({success: "ipad"});
  await render(<PhoneRow sessionId="ipad-session" kind="ipad" title="iPad" sub="Last used Dec 3, 8:14 PM" lead={null} />);
  const signOut = button(/^Sign out the iPad, Last used Dec 3/);
  expect(signOut.textContent).toBe("Sign out");
  await act(async () => signOut.click());
  expect(calls.signOutPhone).toHaveBeenCalledExactlyOnceWith("ipad-session");
  expect(container.querySelector("li")?.hidden).toBe(true);
  expect(calls.toast).toHaveBeenCalledExactlyOnceWith("The iPad is signed out");
});

it("keeps the phone and says why when it couldn't be signed out", async () => {
  calls.signOutPhone.mockResolvedValue({error: "unavailable"});
  await render(<PhoneRow sessionId="gone" kind="computer" title="Computer" sub="Last used Dec 3" lead={null} />);
  await act(async () => button(/^Sign out the computer/).click());
  expect(container.querySelector("li")?.hidden).toBe(false);
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(en.auth.feedback.unavailable);
  expect(calls.toast).not.toHaveBeenCalled();
});

it("names the phone in Spanish", async () => {
  calls.signOutPhone.mockResolvedValue({success: "computer"});
  await render(<PhoneRow sessionId="pc" kind="computer" title="Computadora" sub="Último uso: 3 dic" lead={null} />, "es");
  await act(async () => button(/^Cerrar sesión en la computadora, Último uso/).click());
  expect(calls.toast).toHaveBeenCalledExactlyOnceWith("Se cerró la sesión en la computadora");
});

it("is a switch: off removes this phone's Face ID and keeps the PIN", async () => {
  calls.faceIdOff.mockResolvedValue({success: "faceOff", credentials: []});
  await render(<FaceIdRow on device="iPhone" />);
  const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!;
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  expect(toggle.getAttribute("aria-label")).toBe("Face ID");
  expect(container.textContent).toContain("On for this iPhone");
  await act(async () => toggle.click());
  expect(calls.faceIdOff).toHaveBeenCalledOnce();
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  expect(container.textContent).toContain("Off on this iPhone");
  expect(calls.toast).toHaveBeenCalledExactlyOnceWith("Face ID is off on this iPhone. Your PIN still works.");
  expect(calls.beginFaceId).not.toHaveBeenCalled();
});

it("stays on, and says why, while the PIN can't get them back in", async () => {
  calls.faceIdOff.mockResolvedValue({error: "faceOnlyWay"});
  await render(<FaceIdRow on device="iPhone" />);
  const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!;
  await act(async () => toggle.click());
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(en.auth.feedback.faceOnlyWay);
  expect(calls.toast).not.toHaveBeenCalled();
});

it("turning it on runs the usual Face ID setup", async () => {
  calls.beginFaceId.mockResolvedValue({user: {id: "me"}, challenge: "c"});
  calls.startRegistration.mockResolvedValue({id: "credential"});
  calls.finishFaceIdEnrollment.mockResolvedValue(true);
  await render(<FaceIdRow on={false} device="iPhone" />);
  const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!;
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  await act(async () => toggle.click());
  expect(calls.beginFaceId).toHaveBeenCalledExactlyOnceWith(true);
  expect(calls.finishFaceIdEnrollment).toHaveBeenCalledExactlyOnceWith({id: "credential"});
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  expect(calls.toast).toHaveBeenCalledExactlyOnceWith("Face ID is on for this iPhone");
  expect(calls.refresh).toHaveBeenCalledOnce();
  expect(calls.faceIdOff).not.toHaveBeenCalled();
});

it("goes back off when Face ID setup doesn't finish", async () => {
  calls.beginFaceId.mockResolvedValue({user: {id: "me"}, challenge: "c"});
  calls.startRegistration.mockRejectedValue(new Error("NotAllowedError"));
  await render(<FaceIdRow on={false} device="iPhone" />);
  const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!;
  await act(async () => toggle.click());
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(en.auth.faceUnavailable);
});
