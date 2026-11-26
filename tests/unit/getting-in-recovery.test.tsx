// @vitest-environment jsdom
import {act, type ReactNode} from "react";
import {createRoot, type Root} from "react-dom/client";
import {NextIntlClientProvider} from "next-intl";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import en from "../../messages/en.json";
import {KeyAlreadyOpened, SignInWithPin} from "../../src/app/[locale]/sign-in/get-in";
import {EnterPin, MakePin} from "../../src/app/[locale]/sign-in/pin-screens";
import {AddStep, SizesStep} from "../../src/app/[locale]/welcome/steps";

const actions = vi.hoisted(() => ({
  previewCode: vi.fn(), useKey: vi.fn(), beginFaceId: vi.fn(), finishFaceIdEnrollment: vi.fn(),
  finishFaceIdSignIn: vi.fn(), forgotPin: vi.fn(), reportUsedKey: vi.fn(), enterPin: vi.fn(), openFamily: vi.fn(),
}));
const lists = vi.hoisted(() => ({previewItemLink: vi.fn(), saveProfileField: vi.fn(), saveItem: vi.fn()}));
const welcome = vi.hoisted(() => ({addFirstThing: vi.fn()}));
const router = vi.hoisted(() => ({push: vi.fn(), replace: vi.fn()}));
vi.mock("../../src/app/[locale]/sign-in/actions", () => actions);
vi.mock("../../src/app/[locale]/lists/actions", () => lists);
vi.mock("../../src/app/[locale]/welcome/actions", () => welcome);
vi.mock("@/i18n/navigation", () => ({
  Link: ({href, children}: {href: string; children: ReactNode}) => <a href={href}>{children}</a>,
  useRouter: () => router,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({matches: false, addEventListener() {}, removeEventListener() {}}));
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = vi.fn(() => "blob:photo");
    static revokeObjectURL = vi.fn();
  });
  lists.saveProfileField.mockResolvedValue({status: "saved"});
  welcome.addFirstThing.mockResolvedValue({error: "could-not-save"});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function render(node: ReactNode) {
  await act(async () => root.render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="America/Chicago">{node}</NextIntlClientProvider>,
  ));
}

function button(label: string) {
  const found = [...container.querySelectorAll("button")].find((node) => node.textContent === label || node.getAttribute("aria-label") === label);
  expect(found, label).toBeDefined();
  return found!;
}

async function click(label: string) {
  await act(async () => button(label).click());
}

async function type(digits: string) {
  for (const digit of digits) await click(digit);
}

async function advance(milliseconds: number) {
  await act(async () => { vi.advanceTimersByTime(milliseconds); });
}

it("submits only the corrected PIN after the settling delay", async () => {
  vi.useFakeTimers();
  const submit = vi.fn().mockResolvedValue({error: "invalidPin", triesLeft: 4});
  await render(<EnterPin title="PIN" lead="Enter" organizer="Rosa" onLocked={vi.fn()} submit={submit} />);
  await type("4267");
  await advance(100);
  await click(en.getIn.pin.delete);
  await click("8");
  await advance(160);
  expect(submit).not.toHaveBeenCalled();
  await advance(100);
  expect(submit).toHaveBeenCalledTimes(1);
  expect((submit.mock.calls[0][0] as FormData).get("pin")).toBe("4268");
});

it("cancels a pending sign-in when leaving the PIN screen", async () => {
  vi.useFakeTimers();
  const submit = vi.fn();
  await render(<EnterPin title="PIN" lead="Enter" organizer="Rosa" onLocked={vi.fn()} submit={submit} />);
  await type("4268");
  await render(<p>Another screen</p>);
  await advance(260);
  expect(submit).not.toHaveBeenCalled();
});

it("lets both PIN creation entries be corrected before checking them", async () => {
  vi.useFakeTimers();
  const save = vi.fn().mockResolvedValue(undefined);
  await render(<MakePin save={save} />);
  for (let entry = 0; entry < 2; entry++) {
    await type("4267");
    await advance(100);
    await click(en.getIn.pin.delete);
    await click("8");
    await advance(160);
    expect(save).not.toHaveBeenCalled();
    await advance(100);
    if (entry === 0) expect(container.querySelector("h1")?.textContent).toBe(en.getIn.pin.againTitle);
  }
  expect(save).toHaveBeenCalledExactlyOnceWith("4268");
});

it("cancels pending PIN creation when leaving confirmation", async () => {
  vi.useFakeTimers();
  const save = vi.fn();
  await render(<MakePin save={save} />);
  await type("4268");
  await advance(260);
  await type("4268");
  await render(<p>Another screen</p>);
  await advance(260);
  expect(save).not.toHaveBeenCalled();
});

it.each(["returning", "used-key"])("counts down a %s lock and restores PIN entry without reloading", async (entry) => {
  vi.useFakeTimers();
  actions.enterPin.mockResolvedValueOnce({error: "pinLocked", minutes: 2}).mockResolvedValue({error: "invalidPin", triesLeft: 4});
  await render(entry === "returning"
    ? <SignInWithPin familyId="family" personId="person" name="Ana" organizer="Rosa" backHref="/sign-in" />
    : <KeyAlreadyOpened familyId="family" value="key" typed={false} organizer="Rosa"
      entry={{personId: "person", name: "Ana", familyName: "Family", available: false, usedAt: "2030-01-01"}} />);
  await type("4268");
  await advance(260);
  expect(container.querySelector('[role="img"][aria-label="Try again in 2 minutes"]')).not.toBeNull();
  await advance(60_000);
  expect(container.querySelector('[role="img"][aria-label="Try again in 1 minute"]')).not.toBeNull();
  expect([...container.querySelectorAll("button")].some((node) => node.textContent === en.getIn.locked.retry)).toBe(false);
  vi.setSystemTime(Date.now() + 60_000);
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(container.textContent).toContain(en.getIn.locked.ready);
  await click(en.getIn.locked.retry);
  expect(container.querySelector("[data-keypad]")).not.toBeNull();
  await type("4268");
  await advance(260);
  expect(actions.enterPin).toHaveBeenCalledTimes(2);
});

it.each([
  ["eu", "", "38", "39"],
  ["us-kids", "", "1C", "2C"],
  ["uk", "7.5", "8", "8.5"],
])("steps through %s shoe sizes", async (system, initial, first, second) => {
  await render(<SizesStep ownerId="person" initial={{noClothes: false, sizes: {shoeSystem: system, shoes: initial}}} profileHref="/profile" />);
  await click(en.getIn.sizes.bigger);
  expect(lists.saveProfileField).toHaveBeenLastCalledWith("person", "shoes", first, "size");
  await click(en.getIn.sizes.bigger);
  expect(lists.saveProfileField).toHaveBeenLastCalledWith("person", "shoes", second, "size");
  await click(en.getIn.sizes.smaller);
  expect(lists.saveProfileField).toHaveBeenLastCalledWith("person", "shoes", first, "size");
});

async function selectPhoto(file: File) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", {configurable: true, value: [file]});
  await act(async () => { input.dispatchEvent(new Event("change", {bubbles: true})); });
}

it("prepares a large camera photo and submits the smaller file", async () => {
  const decoded = Promise.withResolvers<void>();
  vi.stubGlobal("Image", class {
    naturalWidth = 4000;
    naturalHeight = 3000;
    decode = () => decoded.promise;
  });
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({drawImage} as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, callback) {
    expect([this.width, this.height]).toEqual([1500, 1125]);
    callback(new Blob([new Uint8Array(100_000)], {type: "image/jpeg"}));
  });
  await render(<AddStep ownerId="person" />);
  await selectPhoto(new File([new Uint8Array(6_000_000)], "camera.jpg", {type: "image/jpeg"}));
  expect(button(en.getIn.add.add).disabled).toBe(true);
  expect(container.textContent).toContain(en.lists.preparingPhoto);
  await act(async () => decoded.resolve());
  expect(button(en.getIn.add.add).disabled).toBe(false);
  expect(drawImage).toHaveBeenCalledTimes(1);
  const title = container.querySelector<HTMLInputElement>('input[name="title"]')!;
  title.value = "A sweater";
  await act(async () => { container.querySelector("form")!.requestSubmit(); });
  const data = welcome.addFirstThing.mock.calls[0][1] as FormData;
  expect(data.get("kind")).toBe("photo");
  expect(data.get("title")).toBe("A sweater");
  expect(data.getAll("photo")).toHaveLength(1);
  expect(data.get("photo")).toMatchObject({name: "photo.jpg", type: "image/jpeg", size: 100_000});
  await render(<p>Another screen</p>);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:photo");
});

it("shows preparation failures without uploading the original", async () => {
  vi.stubGlobal("Image", class {decode = () => Promise.reject(new Error("unsupported image"));});
  await render(<AddStep ownerId="person" />);
  await selectPhoto(new File([new Uint8Array(6_000_000)], "camera.jpg", {type: "image/jpeg"}));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(en.getIn.add.failed);
  expect(button(en.getIn.add.add).disabled).toBe(true);
  expect(welcome.addFirstThing).not.toHaveBeenCalled();
  await click(en.getIn.hello.helperBack);
  container.querySelector<HTMLInputElement>('input[name="title"]')!.value = "A sweater";
  await act(async () => { container.querySelector("form")!.requestSubmit(); });
  const data = welcome.addFirstThing.mock.calls[0][1] as FormData;
  expect(data.get("kind")).toBe("note");
  expect(data.get("photo")).toBeNull();
});
