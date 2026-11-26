// @vitest-environment jsdom
import {act, createElement} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {EnterCode} from "../../src/app/[locale]/sign-in/controls";

const actions = vi.hoisted(() => ({
  previewCode: vi.fn(), useKey: vi.fn(), beginFaceId: vi.fn(), finishFaceIdEnrollment: vi.fn(),
  finishFaceIdSignIn: vi.fn(), forgotPin: vi.fn(), reportUsedKey: vi.fn(),
}));
vi.mock("../../src/app/[locale]/sign-in/actions", () => actions);
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: {name?: string}) => values?.name ? `${key}:${values.name}` : key,
  useFormatter: () => ({dateTime: () => "date"}),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({href, children}: {href: string; children: string}) => createElement("a", {href}, children),
  useRouter: () => ({replace: vi.fn()}),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  actions.useKey.mockResolvedValue({error: "invalidPin"});
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function input(value: string) {
  await act(async () => {
    const field = container.querySelector<HTMLInputElement>('input[name="code"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", {bubbles: true}));
  });
}

it("discards an edited pending preview and submits the code and proof from the displayed result", async () => {
  const first = Promise.withResolvers<object>();
  const second = Promise.withResolvers<object>();
  actions.previewCode.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  await act(async () => root.render(createElement(EnterCode, {familyId: "family"})));
  await input("AAAAAA");
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true})); });
  await input("BBBBBB");
  await act(async () => first.resolve({key: {personId: "first", name: "First", familyName: "Family", available: true, usedAt: null, preview: "proof-A"}}));
  expect(container.textContent).not.toContain("isYourPhone:First");
  expect(container.querySelector<HTMLInputElement>('input[name="code"]')!.value).toBe("BBBBBB");
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true})); });
  await act(async () => second.resolve({key: {personId: "second", name: "Second", familyName: "Family", available: true, usedAt: null, preview: "proof-B"}}));
  expect(container.textContent).toContain("isYourPhone:Second");
  await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent === "yesMe:Second")!.click(); });
  await act(async () => {
    container.querySelector<HTMLInputElement>('input[name="pin"]')!.value = "4268";
    container.querySelector<HTMLInputElement>('input[name="confirmation"]')!.value = "4268";
    container.querySelector("form")!.requestSubmit();
  });
  expect(actions.useKey).toHaveBeenCalledWith("family", "BBBBBB", true, "proof-B", {}, expect.any(FormData));
});
