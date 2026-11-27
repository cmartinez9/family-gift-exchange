// @vitest-environment jsdom
import {act, createElement} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {CodeEntry} from "../../src/app/[locale]/sign-in/get-in";

const actions = vi.hoisted(() => ({
  previewCode: vi.fn(), useKey: vi.fn(), beginFaceId: vi.fn(), finishFaceIdEnrollment: vi.fn(),
  finishFaceIdSignIn: vi.fn(), forgotPin: vi.fn(), reportUsedKey: vi.fn(), enterPin: vi.fn(), openFamily: vi.fn(),
}));
vi.mock("../../src/app/[locale]/sign-in/actions", () => actions);
vi.mock("next-intl", () => ({
  useTranslations: () => Object.assign(
    (key: string, values?: {name?: string}) => values?.name ? `${key}:${values.name}` : key,
    {has: () => true},
  ),
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
  vi.stubGlobal("matchMedia", () => ({matches: true, addEventListener: () => {}, removeEventListener: () => {}}));
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
  await act(async () => root.render(createElement(CodeEntry, {familyId: "family", backHref: "/sign-in", sender: null, organizer: "Org", names: []})));
  await input("AAAAAA");
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true})); });
  await input("BBBBBB");
  await act(async () => first.resolve({key: {personId: "first", name: "First", familyName: "Family", available: true, usedAt: null, preview: "proof-A"}}));
  expect(container.textContent).not.toContain("helping:First");
  expect(container.querySelector<HTMLInputElement>('input[name="code"]')!.value).toBe("BBBBBB");
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true})); });
  await act(async () => second.resolve({key: {personId: "second", name: "Second", familyName: "Family", available: true, usedAt: null, preview: "proof-B"}}));
  expect(container.textContent).toContain("helping:Second");
  await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent === "yes")!.click(); });
  const type = async (digits: string) => {
    for (const digit of digits) {
      await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent === digit)!.click(); });
    }
    // the pad settles for a beat before it checks the four digits
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
  };
  await type("4268");
  expect(container.textContent).toContain("againTitle");
  await type("4268");
  expect(actions.useKey).toHaveBeenCalledWith("family", "BBBBBB", true, "proof-B", expect.any(String), {}, expect.any(FormData));
  const sent = actions.useKey.mock.calls[0][6] as FormData;
  expect([sent.get("pin"), sent.get("confirmation")]).toEqual(["4268", "4268"]);
});
