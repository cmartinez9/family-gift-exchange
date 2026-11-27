// @vitest-environment jsdom
import {act, type ReactNode} from "react";
import {createRoot, type Root} from "react-dom/client";
import {renderToStaticMarkup} from "react-dom/server";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {Avatar, initialOf} from "@/components/ui/avatar";
import {EmptyBlock, ErrorBlock, LoadingBlock} from "@/components/ui/blocks";
import {Button, IconButton, buttonClass} from "@/components/ui/button";
import {Card, ListRow, Rows} from "@/components/ui/card";
import {ChoiceChips, Chip} from "@/components/ui/chip";
import {Countdown} from "@/components/ui/countdown";
import {Switch, TextField, Tick} from "@/components/ui/inputs";
import {BudgetMeasure, ItemCard} from "@/components/ui/item-card";
import {FairIsleBand, KnitField} from "@/components/ui/knit/knit-svg";
import {KnitMotif} from "@/components/ui/knit/knit-motif";
import {StitchedText} from "@/components/ui/knit/stitched-text";
import {ModeBanner} from "@/components/ui/mode-banner";
import {ClaimCard} from "@/components/ui/motion/claim";
import {EdgeSwipeBack} from "@/components/ui/motion/edge-swipe";
import {HAPTIC_PATTERNS, haptic} from "@/components/ui/motion/haptic";
import {KnitIn} from "@/components/ui/motion/knit-in";
import {UnravelReveal, type RevealLabels} from "@/components/ui/motion/unravel-reveal";
import {BackRow, PageTitle} from "@/components/ui/page-header";
import {Pass} from "@/components/ui/pass";
import {PinPad, PinSlots} from "@/components/ui/pin";
import {StepBar} from "@/components/ui/step-bar";
import {TabBar, TabBarHost, TabRoot} from "@/components/ui/tab-bar";
import {ToastHost, dismissToast, toast} from "@/components/ui/toast";

const {push} = vi.hoisted(() => ({push: vi.fn()}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({href, children, transitionTypes, ...rest}: {href: string; children: ReactNode; transitionTypes?: string[]}) => (
    <a href={href} data-transition={transitionTypes?.join(" ")} {...rest}>{children}</a>
  ),
  useRouter: () => ({push}),
}));

const html = (node: ReactNode) => renderToStaticMarkup(<>{node}</>);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  push.mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.matchMedia = vi.fn().mockReturnValue({matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn()});
  // jsdom has no Web Animations API
  Element.prototype.animate ??= function animate() {
    return {cancel() {}, finish() {}, onfinish: null} as unknown as Animation;
  };
  Element.prototype.getAnimations ??= () => [];
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
  await act(async () => root.render(node));
}

describe("stitched lettering", () => {
  it("keeps the real word for screen readers and hides the stitches", () => {
    const markup = html(<StitchedText as="h1" text="Beto" cell={7.5} />);
    expect(markup).toContain('<span class="sr-only">Beto</span>');
    expect(markup).toMatch(/<svg aria-hidden="true"/);
    expect(markup).toContain('data-stitched="static"');
  });

  it("knits a word in stitch by stitch, bottom row first", () => {
    const markup = html(<StitchedText text="HI" cell={10} knit stepMs={7} />);
    expect(markup).toContain('data-stitched="knit"');
    expect(markup).toContain("--knit-step:7ms");
    expect(markup.match(/class="fge-st"/g)?.length).toBeGreaterThan(40);
  });

  it("falls back to heavy Rubik for letters not drawn yet", () => {
    const markup = html(<StitchedText text="José" cell={7.5} />);
    expect(markup).toContain('data-stitched="fallback"');
    expect(markup).toContain(">José<");
    expect(markup).not.toContain("<svg");
  });

  it("knits motifs, fields and bands as SVG, with patterns where they repeat", () => {
    expect(html(<KnitMotif name="gift" cell={4} label="A knitted gift" />)).toContain('role="img" aria-label="A knitted gift"');
    expect(html(<KnitField stitch="#E2DAD6" />)).toContain("<pattern");
    const band = html(<FairIsleBand kind="zig" cell={4.6} />);
    expect(band).toContain("<pattern");
    expect(band).toContain('aria-hidden="true"');
  });
});

describe("yarn blocks and items", () => {
  it("says what a card is with its tone", () => {
    for (const tone of ["info", "next", "mine", "taken"] as const) {
      expect(html(<Card tone={tone}>Card</Card>)).toContain(`data-tone="${tone}"`);
    }
    expect(html(<Card size="item">Item</Card>)).toContain('data-size="item"');
  });

  it("groups rows with a line between them", () => {
    const markup = html(<Card><Rows as="ul"><ListRow as="li" title="Ana" sub="6 things" /><ListRow as="li" title="Leo" /></Rows></Card>);
    expect(markup).toContain('class="fge-rows flex flex-col"');
    expect(markup.match(/<li/g)).toHaveLength(2);
  });

  it("shows a gift with its store, price and status", () => {
    const markup = html(<ItemCard tone="taken" titleAs="h2" picture={<span />} title="Pour-over coffee set" store="Target" price="$32.00"
      details={<p>Someone is getting this</p>} />);
    expect(markup).toContain('<h2 class="text-item-title">Pour-over coffee set</h2>');
    expect(markup).toContain("Target · ");
    expect(markup).toContain("$32.00");
    expect(markup).toContain('data-tone="taken"');
    expect(html(<ItemCard picture={<span />} title="Socks" tag />)).toContain("pr-[52px]");
  });

  it("measures a price against the budget, gold and worded when over", () => {
    const under = html(<BudgetMeasure price={27} budget={50} underLabel="of $50" overLabel="Over $50" />);
    expect(under).toContain('data-budget="under"');
    expect(under).toContain("of $50");
    const over = html(<BudgetMeasure price={79.99} budget={50} underLabel="of $50" overLabel="Over $50" />);
    expect(over).toContain('data-budget="over"');
    expect(over).toContain("Over $50");
    expect(over).toContain("bg-gold");
    expect(over).toContain("left:63px");
  });

  it("keeps your person on a pine pass that opens their page", () => {
    const markup = html(<Pass name="BETO" lead="You're giving to" onlyYou="Only you can see this" budget="$50" href="/person" openLabel="Open Beto's page" />);
    expect(markup).toContain('href="/person"');
    expect(markup).toContain('data-transition="fge-push"');
    expect(markup).toContain('data-tone="mine"');
    expect(markup).toContain('<span class="sr-only">BETO</span>');
    expect(markup).toContain("Open Beto&#x27;s page");
  });
});

describe("buttons, navigation and inputs", () => {
  it("has every button the design names", () => {
    expect(buttonClass("ground")).toContain("h-16");
    expect(buttonClass("outline")).toContain("border-white/60");
    expect(buttonClass("card")).toContain("h-[52px]");
    expect(buttonClass("small")).toContain("h-12");
    expect(buttonClass("smallSoft")).toContain("bg-[var(--track)]");
    expect(buttonClass("danger")).toContain("bg-danger");
    expect(html(<Button icon="plus">Add</Button>)).toContain('data-icon="plus"');
    expect(html(<IconButton icon="close" label="Close" />)).toContain('aria-label="Close"');
  });

  it("goes back with a back transition and names the parent", () => {
    const markup = html(<BackRow href="/family" parent="Family" backLabel="Back to" />);
    expect(markup).toContain('data-transition="fge-back"');
    expect(markup).toContain("Back to </span>Family");
    expect(html(<PageTitle title="My list" count="4 things" lead="Everyone can see it." />)).toContain("<h1");
  });

  it("marks the current tab", () => {
    const markup = html(<TabBar label="Tabs" active="list" items={[
      {key: "home", href: "/", label: "Home", icon: "home"}, {key: "list", href: "/lists", label: "My list", icon: "list"},
    ]} />);
    expect(markup).toContain('aria-label="Tabs"');
    expect(markup).toMatch(/href="\/lists"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/lists"/);
    expect(markup).toContain('data-transition="fge-tab"');
  });

  it("shows the shared tab bar only on tab roots", async () => {
    const tabs = {home: {label: "Home", href: "/"}, list: {label: "My list", href: "/lists"}, family: {label: "Family", href: "/family"}};
    await render(<TabBarHost label="Tabs" tabs={tabs} />);
    expect(container.querySelector("nav")).toBeNull();
    await render(<><TabBarHost label="Tabs" tabs={tabs} /><TabRoot active="family" hrefs={{list: "/lists/me"}} /></>);
    expect(container.querySelector("nav [aria-current='page']")?.textContent).toBe("Family");
    expect(container.querySelector("a[data-tab='list']")?.getAttribute("href")).toBe("/lists/me");
    expect(document.body.dataset.tabs).toBe("on");
    await render(<TabBarHost label="Tabs" tabs={tabs} />);
    expect(container.querySelector("nav")).toBeNull();
    expect(document.body.dataset.tabs).toBeUndefined();
  });

  it("picks chips in ink, as real radio buttons", async () => {
    const change = vi.fn();
    await render(<ChoiceChips legend="Tops" name="tops" value="M" onChange={change} options={[{value: "S", label: "S"}, {value: "M", label: "M"}]} />);
    const radios = container.querySelectorAll<HTMLInputElement>("input[type=radio]");
    expect(radios[1].checked).toBe(true);
    expect(radios[1].closest("label")?.className).toContain("bg-ink");
    await act(async () => radios[0].click());
    expect(change).toHaveBeenCalledWith("S");
    expect(html(<Chip pressed>Picked</Chip>)).toContain('aria-pressed="true"');
  });

  it("switches, ticks and labels fields", async () => {
    const change = vi.fn();
    await render(<Switch label="No clothes, please" checked={false} onCheckedChange={change} />);
    const button = container.querySelector("button")!;
    expect(button.getAttribute("role")).toBe("switch");
    expect(button.getAttribute("aria-checked")).toBe("false");
    await act(async () => button.click());
    expect(change).toHaveBeenCalledWith(true);
    expect(html(<Tick done label="Done" />)).toContain('aria-label="Done"');
    await render(<TextField label="What would you like?" hint="A few words is fine" />);
    const input = container.querySelector("input")!;
    expect(container.querySelector(`label[for="${input.id}"]`)?.textContent).toBe("What would you like?");
    expect(input.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("draws avatars as neutral initials", () => {
    expect(initialOf(" rosa")).toBe("R");
    const markup = html(<Avatar name="Ana" on="ground" />);
    expect(markup).toContain("bg-yarn-white");
    expect(markup).toContain('aria-hidden="true"');
  });

  it("shows one ink banner for every mode", () => {
    const markup = html(<ModeBanner icon="user" label="Mode" action={<button type="button">Done</button>}>You&apos;re helping Tito</ModeBanner>);
    expect(markup).toContain('role="region" aria-label="Mode"');
    expect(markup).toContain("bg-ink");
  });
});

describe("PIN, steps, countdown and blocks", () => {
  it("fills PIN slots and takes digits from the keypad and the keyboard", async () => {
    expect(html(<PinSlots filled={2} label="2 of 4" />).match(/data-filled="true"/g)).toHaveLength(2);
    const change = vi.fn();
    const complete = vi.fn();
    await render(<PinPad value="195" onChange={change} onComplete={complete} slotsLabel="3 of 4" deleteLabel="Delete" name="pin" />);
    expect(container.querySelector<HTMLInputElement>("input[name=pin]")?.value).toBe("195");
    const eight = [...container.querySelectorAll("button")].find((button) => button.textContent === "8")!;
    await act(async () => eight.click());
    expect(change).toHaveBeenCalledWith("1958");
    expect(complete).toHaveBeenCalledWith("1958");
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", {key: "Backspace"})));
    expect(change).toHaveBeenLastCalledWith("19");
  });

  it("knits the step bar's strips by state", async () => {
    sessionStorage.clear();
    await render(<StepBar id="test" step={2} total={4} progress="Step 2 of 4" name="Your person" />);
    const states = [...container.querySelectorAll(".fge-strip")].map((strip) => strip.getAttribute("data-state"));
    expect(states).toEqual(["done", "now", "todo", "todo"]);
    expect(container.textContent).toContain("Step 2 of 4");
    expect(container.textContent).toContain("Your person");
    expect(sessionStorage.getItem("fge-step-bar:test")).toBe("1");
  });

  it("counts down, and stitches TODAY on the day", () => {
    const days = html(<Countdown days={24} unit="days to gift day" line="Thursday, Dec 24" />);
    expect(days).toContain('data-countdown="24"');
    expect(days).toContain("days to gift day");
    const today = html(<Countdown days={0} unit="days to gift day" />);
    expect(today).toContain('<span class="sr-only">TODAY</span>');
    expect(today).not.toContain("days to gift day");
  });

  it("has empty, loading and error blocks that say what is happening", () => {
    expect(html(<EmptyBlock title="Add your first thing">A few words is enough.</EmptyBlock>)).toContain('data-tone="next"');
    const loading = html(<LoadingBlock title="Getting the picture">Saved.</LoadingBlock>);
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain('role="status"');
    expect(html(<ErrorBlock title="1958 looks like a year">Try 4 other numbers.</ErrorBlock>)).toContain('role="alert"');
  });

  it("makes new items knit in", () => {
    expect(html(<KnitIn as="ul"><li>One</li></KnitIn>)).toContain('class="fge-arrive"');
    expect(html(<KnitIn one>New</KnitIn>)).toContain("fge-arrive-one");
  });
});

describe("motion and feedback", () => {
  it.each([
    ["pointercancel", 160, 1000, false],
    ["pointercancel", 40, 20, false],
    ["pointerup", 160, 1000, true],
    ["pointerup", 40, 20, true],
    ["pointerup", 40, 1000, false],
  ] as const)("settles a %s back gesture of %ipx over %ims (navigate: %s)", async (endType, distance, elapsed, navigates) => {
    await render(<EdgeSwipeBack href="/family"><p>Your person</p></EdgeSwipeBack>);
    const page = container.querySelector<HTMLDivElement>("[data-edge-swipe]")!;
    const shade = page.previousElementSibling as HTMLDivElement;
    Object.defineProperty(page, "setPointerCapture", {value: vi.fn()});
    Object.defineProperty(page, "offsetWidth", {value: 390});
    const animations: Array<{onfinish: (() => void) | null}> = [];
    const animate = vi.fn(() => {
      const animation = {onfinish: null as (() => void) | null};
      animations.push(animation);
      return animation as unknown as Animation;
    });
    page.animate = animate;
    shade.animate = animate;
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    const pointer = (type: string, clientX: number) => page.dispatchEvent(new PointerEvent(type, {
      pointerId: 1, button: 0, clientX, clientY: 100, bubbles: true,
    }));

    pointer("pointerdown", 10);
    pointer("pointermove", 10 + distance);
    expect(page.style.transform).toBe(`translateX(${distance}px)`);
    expect(shade.style.display).toBe("block");
    clock.mockReturnValue(elapsed);
    pointer(endType, 10 + distance);
    expect(push).not.toHaveBeenCalled();
    expect(animations.length).toBeGreaterThan(0);
    animations.forEach((animation) => animation.onfinish?.());

    if (navigates) {
      expect(push).toHaveBeenCalledOnce();
      expect(push).toHaveBeenCalledWith("/family");
    } else {
      expect(push).not.toHaveBeenCalled();
      expect(page.style.transform).toBe("");
      expect(shade.style.display).toBe("none");
    }
  });

  it("vibrates where the phone can, and does nothing where it cannot", () => {
    const vibrate = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", {vibrate});
    expect(haptic("success")).toBe(true);
    expect(vibrate).toHaveBeenCalledWith([...(HAPTIC_PATTERNS.success as readonly number[])]);
    haptic("tick");
    expect(vibrate).toHaveBeenLastCalledWith(5);
    vi.stubGlobal("navigator", {});
    expect(haptic("firm")).toBe(false);
    vi.stubGlobal("navigator", {vibrate: () => { throw new Error("blocked"); }});
    expect(haptic("error")).toBe(false);
  });

  it("shows one toast, with Undo, and hides it after 2.6s or 5s", async () => {
    vi.useFakeTimers();
    const undo = vi.fn();
    await render(<ToastHost undoLabel="Undo" />);
    await act(async () => {
      toast({message: "Took off the crosswords", undo});
    });
    const pill = container.querySelector<HTMLElement>(".fge-toast")!;
    expect(pill.dataset.show).toBe("true");
    expect(container.querySelector("[role=status]")?.textContent).toContain("Took off the crosswords");
    await act(async () => container.querySelector<HTMLButtonElement>(".fge-toast button")!.click());
    expect(undo).toHaveBeenCalledOnce();
    expect(pill.dataset.show).toBe("false");

    await act(async () => {
      toast("Saved");
    });
    expect(pill.dataset.show).toBe("true");
    await act(async () => vi.advanceTimersByTime(2700));
    expect(pill.dataset.show).toBe("false");
    dismissToast();
  });

  it("shows a claim as it is on first paint, without motion", async () => {
    await render(<ClaimCard claimed base={<p>Base</p>} mine={<p>Mine</p>} />);
    expect(container.querySelector("[data-claimed]")?.getAttribute("data-claimed")).toBe("true");
    expect(container.querySelector<HTMLElement>("[data-claim-tag]")?.style.opacity).toBe("1");
    expect(container.querySelector("div[inert]")?.textContent).toBe("Base");
  });

  it("offers a hold, a tap path and a progress for the reveal", async () => {
    const labels: RevealLabels = {
      ready: "Your person is ready", readyHint: "Press and hold the gift.", holding: "Keep holding", holdingHint: "Coming undone.",
      holdLonger: "Hold a little longer.", letGo: "Let go any time.", watching: "Keep watching", watchingHint: "Knitting a name.",
      tapToOpen: "Or tap here to open it", gift: "The knitted gift", progress: "Unravelling", lead: "You're giving to", onlyYou: "Only you can see this",
    };
    await render(<UnravelReveal name="BETO" labels={labels} next={<button type="button">Next</button>} />);
    expect(container.querySelector("h1")?.textContent).toBe("Your person is ready");
    expect(container.querySelector("button[aria-label='The knitted gift']")).not.toBeNull();
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Or tap here to open it")).toBe(true);
    const progress = container.querySelector("[role=progressbar]")!;
    expect(progress.getAttribute("aria-label")).toBe("Unravelling");
    expect(progress.getAttribute("aria-valuenow")).toBe("0");
    expect(container.querySelectorAll(".fge-kr")).toHaveLength(16);
    expect(container.querySelector("[data-reveal-next]")?.hasAttribute("inert")).toBe(true);

    // reduced motion: the gift opens at once on a tap
    window.matchMedia = vi.fn().mockReturnValue({matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn()});
    const tap = [...container.querySelectorAll("button")].find((button) => button.textContent === "Or tap here to open it")!;
    await act(async () => tap.click());
    expect(container.querySelector("[data-reveal]")?.getAttribute("data-reveal")).toBe("revealed");
    expect(progress.getAttribute("aria-valuenow")).toBe("100");
    expect(container.querySelectorAll(".fge-nm[data-on='true']").length).toBeGreaterThan(0);
    expect(container.textContent).toContain("You're giving to BETO");
  });
});
